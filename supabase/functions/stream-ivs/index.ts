// Bandbox — Amazon IVS video broker (replaces the Cloudflare stream-live function).
// See docs/ivs-migration-plan.md. Spike-proven 2026-07-07.
//
// One IVS Real-Time STAGE per game. The phone publishes WHIP (sub-second, global
// endpoint); an external camera publishes RTMP via an ingest-configuration stream key.
// Recording is a server-side COMPOSITION of the stage -> S3 (HLS), bounded by
// StartComposition (game start) / StopComposition (game end) so the replay has NO
// pre-game footage. The exact anchor comes from the recording's recording-started.json.
//
// The broadcaster (maybe anonymous) authenticates with its private broadcast token;
// a viewer can finalize a public final game by gameId. Service role has RPC-only
// access to bpw, so every table touch goes through the stream_ivs_* security-definer RPCs.
//
// Deploy: supabase functions deploy stream-ivs --no-verify-jwt
// Secrets: IVS_ACCESS_KEY_ID, IVS_SECRET_ACCESS_KEY, IVS_REGION, IVS_S3_BUCKET,
//   IVS_ENCODER_ARN, IVS_STORAGE_ARN, (optional) IVS_REPLAY_BASE.
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const REGION = Deno.env.get('IVS_REGION') ?? 'us-east-1'
const S3_BUCKET = Deno.env.get('IVS_S3_BUCKET') ?? ''
const ENCODER_ARN = Deno.env.get('IVS_ENCODER_ARN') ?? ''
const STORAGE_ARN = Deno.env.get('IVS_STORAGE_ARN') ?? ''
const REPLAY_BASE = Deno.env.get('IVS_REPLAY_BASE') ?? '' // optional CloudFront base for replay VODs

const db = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: 'bpw' } })
const aws = new AwsClient({
  accessKeyId: Deno.env.get('IVS_ACCESS_KEY_ID') ?? '',
  secretAccessKey: Deno.env.get('IVS_SECRET_ACCESS_KEY') ?? '',
  region: REGION,
  service: 'ivs', // overridden per-host below via explicit service where needed
})

// IVS is a REST-JSON API: POST /OperationName with a JSON body. Real-time and
// low-latency live on different hosts (and SigV4 signing services).
const RT_HOST = `ivsrealtime.${REGION}.amazonaws.com` // stages, tokens, ingest, composition
const LL_HOST = `ivs.${REGION}.amazonaws.com` // channels, put-metadata
const GLOBAL_WHIP = 'https://global.whip.live-video.net' // phone WHIP publish endpoint

async function ivs(host: string, op: string, payload: Record<string, unknown>, service: string) {
  const res = await aws.fetch(`https://${host}/${op}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
    aws: { service },
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok) throw new Error((data?.message as string) ?? `IVS ${op} ${res.status}: ${text.slice(0, 200)}`)
  return data
}
const rt = (op: string, p: Record<string, unknown>) => ivs(RT_HOST, op, p, 'ivs')
const ll = (op: string, p: Record<string, unknown>) => ivs(LL_HOST, op, p, 'ivs')

// Signed S3 GET (finalize reads the recording's event JSON to confirm done + anchor).
async function s3GetJson(key: string): Promise<Record<string, unknown> | null> {
  const res = await aws.fetch(`https://${S3_BUCKET}.s3.${REGION}.amazonaws.com/${key}`, {
    method: 'GET',
    aws: { service: 's3' },
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`S3 GET ${key} -> ${res.status}`)
  return (await res.json().catch(() => null)) as Record<string, unknown> | null
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!ENCODER_ARN || !STORAGE_ARN || !S3_BUCKET) return json({ error: 'IVS not configured.' }, 500)

  let body: { token?: string; gameId?: string; action?: string; metadata?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body.' }, 400)
  }
  const { token, gameId, action = 'start' } = body

  // ---- viewer-token: a public viewer joins a phone game's stage over WebRTC (sub-second). No
  // broadcast token — resolve the stage by gameId and mint a SUBSCRIBE token. (Cap gate deferred;
  // the live_viewers infra is in place to enable per-game concurrent-viewer limits later.)
  if (action === 'viewer-token') {
    if (!gameId) return json({ error: 'Missing gameId.' }, 400)
    const { data: stageArn } = await db.rpc('stream_ivs_stage_by_game', { p_game_id: gameId })
    if (!stageArn) return json({ error: 'No stage for game.' }, 404)
    try {
      const tk = (await rt('CreateParticipantToken', {
        stageArn,
        capabilities: ['SUBSCRIBE'],
        userId: 'viewer',
        duration: 240,
      })) as { participantToken?: { token?: string } }
      return json({ token: tk.participantToken?.token ?? null }, 200)
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : 'token error' }, 502)
    }
  }

  // Resolve game + IVS ids. Broadcaster actions use the token; a viewer may finalize a
  // public final game by gameId.
  type G = {
    game_id?: string
    video_source?: string
    ivs_stage_arn?: string | null
    ivs_channel_arn?: string | null
    ivs_ingest_key?: string | null
    ivs_composition_arn?: string | null
  }
  let g: G | null = null
  if (token) {
    const { data, error } = await db.rpc('stream_ivs_lookup', { p_token: token })
    g = (data as G) ?? null
    if (error || !g?.game_id) return json({ error: 'Invalid broadcast token.' }, 403)
  } else if (gameId && action === 'finalize') {
    const { data } = await db.rpc('get_public_game', { p_game_id: gameId })
    const pub = (data ?? {}) as Record<string, unknown>
    g = {
      game_id: gameId,
      video_source: pub.video_source as string,
      ivs_stage_arn: null,
      ivs_composition_arn: null,
    }
  } else {
    return json({ error: 'Missing token.' }, 400)
  }
  const gameIdR = g!.game_id!

  try {
    // ---- game-start: begin the composite recording (StartComposition -> S3) ----
    if (action === 'game-start') {
      if (g!.ivs_composition_arn) return json({ ok: true, compositionArn: g!.ivs_composition_arn }, 200)
      const stageArn = g!.ivs_stage_arn
      if (!stageArn) return json({ error: 'No stage — call start first.' }, 409)
      // Always record to S3 (replay). Camera games ALSO composite to the low-latency channel
      // so viewers get live HLS + put-metadata scorebug sync. (Phone games view sub-second over
      // WebRTC — Build 3 — so they need no channel here.)
      const destinations: Record<string, unknown>[] = [
        { s3: { encoderConfigurationArns: [ENCODER_ARN], storageConfigurationArn: STORAGE_ARN } },
      ]
      if (g!.video_source === 'camera_rtmp' && g!.ivs_channel_arn) {
        destinations.push({ channel: { channelArn: g!.ivs_channel_arn, encoderConfigurationArn: ENCODER_ARN } })
      }
      type CompDest = { detail?: { s3?: { recordingPrefix?: string } } }
      type Comp = { composition?: { arn?: string; destinations?: CompDest[] } }
      const comp = (await rt('StartComposition', {
        stageArn,
        idempotencyToken: crypto.randomUUID(), // required by the REST API; our own arn-guard above prevents dupes
        destinations,
      })) as Comp
      const compArn = comp.composition?.arn ?? null
      // Find the S3 destination by its recordingPrefix — the destinations array order is NOT
      // guaranteed (the channel can be index 0). Fall back to GetComposition if the prefix isn't
      // populated in the immediate StartComposition response.
      const s3Prefix = (c: Comp) =>
        (c.composition?.destinations ?? []).find((d) => d.detail?.s3?.recordingPrefix)?.detail?.s3
          ?.recordingPrefix ?? null
      let prefix = s3Prefix(comp)
      if (!prefix && compArn) {
        const g2 = (await rt('GetComposition', { arn: compArn }).catch(() => ({}))) as Comp
        prefix = s3Prefix(g2)
      }
      await db.rpc('stream_ivs_set_composition', {
        p_token: token,
        p_composition_arn: compArn,
        p_recording_prefix: prefix,
      })
      return json({ ok: true, compositionArn: compArn, recordingPrefix: prefix }, 200)
    }

    // ---- game-end: stop recording + STOP THE CAMERA. ----
    if (action === 'game-end' || action === 'stop-input') {
      // 1) StopComposition finalizes the S3 recording and takes the live channel offline.
      if (g!.ivs_composition_arn) {
        await rt('StopComposition', { arn: g!.ivs_composition_arn }).catch(() => {})
      }
      // 2) Disconnect the camera's stage participant so its RTMP feed actually ends — StopComposition
      // alone leaves the camera publishing to the stage (mirrors the old Cloudflare stop-input).
      const stageArn = g!.ivs_stage_arn
      if (stageArn) {
        const sess = (await rt('ListStageSessions', { stageArn, maxResults: 1 }).catch(() => null)) as {
          stageSessions?: { sessionId?: string }[]
        } | null
        const sid = sess?.stageSessions?.[0]?.sessionId
        if (sid) {
          const parts = (await rt('ListParticipants', { stageArn, sessionId: sid }).catch(() => null)) as {
            participants?: { participantId?: string; published?: boolean }[]
          } | null
          for (const p of parts?.participants ?? []) {
            if (p.published && p.participantId) {
              await rt('DisconnectParticipant', {
                stageArn,
                participantId: p.participantId,
                reason: 'game ended',
              }).catch(() => {})
            }
          }
        }
      }
      return json({ ok: true }, 200)
    }

    // ---- put-metadata: scorer injects the scorebug/commentary cue (Build 2 channel path) ----
    if (action === 'put-metadata') {
      const channelArn = g!.ivs_channel_arn
      if (!channelArn) return json({ ok: false, note: 'no channel' }, 200)
      const md = typeof body.metadata === 'string' ? body.metadata : JSON.stringify(body.metadata ?? {})
      if (md.length > 1024) return json({ error: 'metadata >1KB' }, 400) // IVS limit
      await ll('PutMetadata', { channelArn, metadata: md })
      return json({ ok: true }, 200)
    }

    // ---- finalize: resolve the replay once the composite recording is written to S3 ----
    if (action === 'finalize') {
      const { data: pub } = await db.rpc('get_public_game', { p_game_id: gameIdR })
      const pg = (pub ?? {}) as { ivs_replay_url?: string | null }
      if (pg.ivs_replay_url) return json({ ready: true, replayUrl: pg.ivs_replay_url }, 200)

      // The recording prefix (S3 key) was stored at game-start. Resolve it by game_id so a viewer
      // (no broadcast token) can finalize a public final game.
      const { data: pfx } = await db.rpc('stream_ivs_prefix_by_game', { p_game_id: gameIdR })
      const prefix = (pfx as string | null) ?? null
      if (!prefix) return json({ ready: false, note: 'no recording prefix yet' }, 200)

      // recording-ended.json exists only once the composite is fully written.
      const ended = await s3GetJson(`${prefix}/events/recording-ended.json`)
      if (!ended) return json({ ready: false }, 200)
      const startedAt = (ended.recording_started_at as string) ?? null
      const replayUrl = REPLAY_BASE
        ? `${REPLAY_BASE}/${prefix}/media/hls/multivariant.m3u8`
        : null // Build 4 wires CloudFront; until then store the anchor + mark pending
      await db.rpc('stream_ivs_set_replay', {
        p_game_id: gameIdR,
        p_replay_url: replayUrl,
        p_started_at: startedAt,
      })
      return json(replayUrl ? { ready: true, replayUrl } : { ready: false, note: 'no replay base configured' }, 200)
    }

    // ---- start (default): create/reuse the stage, mint publish creds ----
    let stageArn = g!.ivs_stage_arn ?? null
    let endpoints: { whip?: string; rtmps?: string } = {}
    if (stageArn) {
      const s = (await rt('GetStage', { arn: stageArn })) as { stage?: { endpoints?: typeof endpoints } }
      endpoints = s.stage?.endpoints ?? {}
    } else {
      const s = (await rt('CreateStage', { name: `bandbox-${gameIdR}` })) as {
        stage?: { arn?: string; endpoints?: typeof endpoints }
      }
      stageArn = s.stage?.arn ?? null
      endpoints = s.stage?.endpoints ?? {}
      await db.rpc('stream_ivs_attach', {
        p_token: token,
        p_stage_arn: stageArn,
        p_ingest_key: null,
        p_channel_arn: null,
        p_playback_url: null,
      })
    }
    if (!stageArn) return json({ error: 'IVS did not return a stage.' }, 502)

    // Phone publishes via WHIP — mint a short-lived PUBLISH participant token.
    const tk = (await rt('CreateParticipantToken', {
      stageArn,
      capabilities: ['PUBLISH'],
      userId: 'broadcaster',
      duration: 240, // minutes
      attributes: { role: 'broadcaster' },
    })) as { participantToken?: { token?: string } }
    const whipToken = tk.participantToken?.token ?? null

    // Subscribe token so the setup screen can PREVIEW the stage feed (sub-second) before first
    // pitch — the camera/phone is already publishing to the stage, independent of the channel.
    const subTk = (await rt('CreateParticipantToken', {
      stageArn,
      capabilities: ['SUBSCRIBE'],
      userId: 'preview',
      duration: 240,
    })) as { participantToken?: { token?: string } }
    const subscribeToken = subTk.participantToken?.token ?? null

    // External camera publishes RTMP — create/reuse an ingest-configuration stream key, plus a
    // low-latency channel for live HLS viewing + put-metadata scorebug sync.
    let rtmp: { url: string; streamKey: string } | null = null
    let playbackUrl: string | null = null
    if (g!.video_source === 'camera_rtmp') {
      let ingestKey = g!.ivs_ingest_key ?? null
      if (!ingestKey) {
        const ic = (await rt('CreateIngestConfiguration', {
          name: `bandbox-${gameIdR}`,
          stageArn,
          ingestProtocol: 'RTMPS',
          userId: 'camera',
        })) as { ingestConfiguration?: { streamKey?: string } }
        ingestKey = ic.ingestConfiguration?.streamKey ?? null
        await db.rpc('stream_ivs_attach', {
          p_token: token,
          p_stage_arn: null,
          p_ingest_key: ingestKey,
          p_channel_arn: null,
          p_playback_url: null,
        })
      }
      if (ingestKey && endpoints.rtmps) rtmp = { url: endpoints.rtmps, streamKey: ingestKey }

      // Channel: composition target for live HLS. Created offline; goes live at game-start.
      let channelArn = g!.ivs_channel_arn ?? null
      if (!channelArn) {
        const ch = (await ll('CreateChannel', {
          name: `bandbox-${gameIdR}`,
          type: 'STANDARD',
          latencyMode: 'LOW',
        })) as { channel?: { arn?: string; playbackUrl?: string } }
        channelArn = ch.channel?.arn ?? null
        playbackUrl = ch.channel?.playbackUrl ?? null
        await db.rpc('stream_ivs_attach', {
          p_token: token,
          p_stage_arn: null,
          p_ingest_key: null,
          p_channel_arn: channelArn,
          p_playback_url: playbackUrl,
        })
      }
    }

    return json(
      {
        stageArn,
        whip: whipToken ? { url: GLOBAL_WHIP, token: whipToken } : null,
        rtmp,
        playbackUrl, // camera live HLS (viewer-safe); null for phone
        subscribeToken, // stage subscribe (sub-second preview / phone viewing)
      },
      200,
    )
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'IVS error.' }, 502)
  }
})

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

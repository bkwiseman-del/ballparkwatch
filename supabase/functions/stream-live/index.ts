// Bandbox — Cloudflare Stream live-input broker.
//
// The broadcaster's phone can't hold Cloudflare secrets, so it calls this with its
// private broadcast token. We create (or reuse) a Stream Live Input and hand back:
//   - whipUrl  (WebRTC ingest — secret, broadcaster only; never stored/returned to viewers)
//   - whepUrl  (WebRTC sub-second playback — viewer-safe)
//   - hlsUrl   (HLS fallback — viewer-safe)
// Stream auto-records every broadcast; `finalize` fetches that recording's VOD id for
// the replay. Free games use a short `deleteRecordingAfterDays` so storage stays ~free;
// paid games keep it (retention lever per the packaging plan).
//
// Deploy: supabase functions deploy stream-live --no-verify-jwt
//   (auth is the broadcast token we validate, not a JWT — the phone may be anon.)
// Secrets: CF_ACCOUNT_ID, CF_STREAM_TOKEN  (Cloudflare account id + Stream-scoped token).
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CF_ACCOUNT_ID = Deno.env.get('CF_ACCOUNT_ID') ?? ''
const CF_STREAM_TOKEN = Deno.env.get('CF_STREAM_TOKEN') ?? ''

const db = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: 'bpw' } })
const CF_API = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream`

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type LiveInput = {
  uid: string
  webRTC?: { url?: string }
  webRTCPlayback?: { url?: string }
  rtmps?: { url?: string; streamKey?: string }
  srt?: { url?: string; streamId?: string; passphrase?: string }
}

// Build the viewer-safe playback URLs from a live input. WHEP is returned by the API;
// HLS is the same customer subdomain + the input uid.
function playbackUrls(li: LiveInput): { whep: string; hls: string; code: string } {
  const whep = li.webRTCPlayback?.url ?? ''
  const u = new URL(whep)
  const code = u.hostname.split('.')[0] // e.g. "customer-abc123"
  const hls = `${u.origin}/${li.uid}/manifest/video.m3u8`
  return { whep, hls, code }
}

async function cf(path: string, init?: RequestInit) {
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${CF_STREAM_TOKEN}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body?.success === false) {
    throw new Error(body?.errors?.[0]?.message ?? `Cloudflare API error (${res.status})`)
  }
  return body.result
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!CF_ACCOUNT_ID || !CF_STREAM_TOKEN) return json({ error: 'Stream not configured.' }, 500)

  let body: {
    token?: string
    gameId?: string
    action?: string
    name?: string
    retentionDays?: number
    uploadLength?: number
    recordingUid?: string
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body.' }, 400)
  }
  const { token, gameId, action = 'start' } = body

  // Resolve the game + its live-input uid. Broadcaster actions authenticate with the
  // private token; a viewer may finalize a public final game by gameId (the recording
  // is already public via get_public_game, so no token needed to fetch its id).
  let resolvedGameId: string | null = null
  let inputUid: string | null = null
  if (token) {
    const { data: found, error } = await db.rpc('stream_lookup', { p_token: token })
    const g = found as { game_id?: string; cf_live_input_uid?: string | null } | null
    if (error || !g?.game_id) return json({ error: 'Invalid broadcast token.' }, 403)
    resolvedGameId = g.game_id
    inputUid = g.cf_live_input_uid ?? null
  } else if (gameId && action === 'finalize') {
    const { data: uid } = await db.rpc('stream_input_by_game', { p_game_id: gameId })
    resolvedGameId = gameId
    inputUid = (uid as string | null) ?? null
  } else {
    return json({ error: 'Missing token.' }, 400)
  }

  try {
    if (action === 'upload-init') {
      // Phone (WHIP) broadcasts aren't recorded by Cloudflare, so the server-side recorder
      // captures the feed and pushes the finished file here. Create a direct-creator tus
      // upload; the recorder PATCHes the bytes straight to the returned URL (no CF token
      // needed client-side), then calls action 'set-recording' with the uid.
      const uploadLength = Number(body.uploadLength)
      if (!Number.isFinite(uploadLength) || uploadLength <= 0) return json({ error: 'Bad uploadLength.' }, 400)
      const res = await fetch(`${CF_API}?direct_user=true`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${CF_STREAM_TOKEN}`,
          'Tus-Resumable': '1.0.0',
          'Upload-Length': String(uploadLength),
          'Upload-Metadata': `name ${btoa(`Bandbox ${resolvedGameId}`)}`,
        },
      })
      if (res.status !== 201) {
        const t = await res.text().catch(() => '')
        return json({ error: `Cloudflare tus create failed (${res.status}): ${t}` }, 502)
      }
      const uploadUrl = res.headers.get('Location')
      const uid = res.headers.get('stream-media-id')
      if (!uploadUrl || !uid) return json({ error: 'Cloudflare did not return an upload URL.' }, 502)
      return json({ uploadUrl, uid }, 200)
    }

    if (action === 'video-status') {
      // Diagnostic: why did Cloudflare reject/accept the uploaded VOD?
      const uid = String(body.recordingUid ?? '')
      if (!uid) return json({ error: 'Missing recordingUid.' }, 400)
      const v = (await cf(`/${uid}`)) as {
        readyToStream?: boolean
        status?: { state?: string; errorReasonText?: string; errorReasonCode?: string; pctComplete?: string }
        input?: { width?: number; height?: number }
        duration?: number
        size?: number
      }
      return json(
        {
          readyToStream: v.readyToStream,
          state: v.status?.state,
          errorReasonCode: v.status?.errorReasonCode,
          errorReasonText: v.status?.errorReasonText,
          pctComplete: v.status?.pctComplete,
          input: v.input,
          duration: v.duration,
          size: v.size,
        },
        200,
      )
    }

    if (action === 'set-recording') {
      if (!body.recordingUid) return json({ error: 'Missing recordingUid.' }, 400)
      await db.rpc('stream_set_recording', { p_token: token, p_recording_uid: String(body.recordingUid) })
      return json({ ok: true }, 200)
    }

    if (action === 'stop-input') {
      // End an EXTERNAL-camera (RTMP/SRT) broadcast server-side when the game ends. The app
      // can't stop the camera, and Cloudflare won't finalize the recording into a replay VOD
      // while the source keeps publishing — so DISABLE the live input, which ends the active
      // broadcast and rejects new ones. Recording mode stays 'automatic', so the VOD is kept
      // (it finalizes ~30-60s after the disconnect). Idempotent.
      if (!inputUid) return json({ ok: true, note: 'no input' }, 200)
      await cf(`/live_inputs/${inputUid}`, {
        method: 'PUT',
        body: JSON.stringify({
          meta: { name: `Bandbox ${resolvedGameId}` },
          recording: { mode: 'automatic' },
          enabled: false,
        }),
      })
      return json({ ok: true }, 200)
    }

    if (action === 'finalize') {
      // Resolve the replay VOD for this game. Ready ~60s after the stream ends. Works with the
      // broadcaster's token OR a viewer's gameId, so it never depends on the broadcaster staying
      // on-screen. For an external camera the raw VOD includes PRE-GAME footage a viewer could
      // scrub back into, so we CLIP it to game-start and serve the clip instead.
      if (!inputUid) return json({ ready: false }, 200)
      const setRec = (uid: string) =>
        token
          ? db.rpc('stream_set_recording', { p_token: token, p_recording_uid: uid })
          : db.rpc('stream_set_recording_by_game', { p_game_id: resolvedGameId, p_recording_uid: uid })

      const { data: g0 } = await db
        .from('games')
        .select('video_source, cf_recording_uid, video_config')
        .eq('id', resolvedGameId)
        .maybeSingle()
      const cfg = (g0?.video_config as Record<string, unknown> | null) ?? {}

      // Already resolved → idempotent; just report whether it's playable yet.
      if (g0?.cf_recording_uid) {
        const v = (await cf(`/${g0.cf_recording_uid}`).catch(() => null)) as { readyToStream?: boolean } | null
        return json(v?.readyToStream ? { ready: true, recordingUid: g0.cf_recording_uid } : { ready: false }, 200)
      }
      // A clip is already being processed → promote it once ready, and anchor the replay clock to
      // the clip's start (= game-start), so the scorebug + commentary sync to the clipped video.
      const pending = cfg.pending_clip_uid as string | undefined
      if (pending) {
        const v = (await cf(`/${pending}`).catch(() => null)) as { readyToStream?: boolean } | null
        if (!v?.readyToStream) return json({ ready: false, clipping: true }, 200)
        await setRec(pending)
        const anchor = cfg.pending_clip_anchor as string | undefined
        if (anchor) await db.from('games').update({ recording_started_at: anchor }).eq('id', resolvedGameId)
        return json({ ready: true, recordingUid: pending }, 200)
      }

      // Find the finalized raw recording.
      const videos = (await cf(`/live_inputs/${inputUid}/videos`)) as
        | { uid: string; readyToStream?: boolean; created?: string; duration?: number }[]
        | null
      const newest = (videos ?? []).slice().sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''))[0]
      if (!newest || !newest.readyToStream) return json({ ready: false }, 200)

      // External camera: clip out pre-game so it can't be scrubbed to. Offset = game-start minus
      // the recording's start (video.created ≈ when RTMP ingest began).
      if (g0?.video_source === 'camera_rtmp' && newest.duration && newest.created) {
        const { data: gs } = await db
          .from('game_events')
          .select('created_at')
          .eq('game_id', resolvedGameId)
          .eq('event_type', 'game_start')
          .order('seq')
          .limit(1)
          .maybeSingle()
        const gsMs = gs?.created_at ? new Date(gs.created_at as string).getTime() : NaN
        const offset = Number.isFinite(gsMs) ? (gsMs - new Date(newest.created).getTime()) / 1000 : 0
        if (offset > 3 && offset < newest.duration - 2) {
          const clip = (await cf(`/clip`, {
            method: 'POST',
            body: JSON.stringify({
              clippedFromVideoUID: newest.uid,
              startTimeSeconds: Math.floor(offset),
              endTimeSeconds: Math.floor(newest.duration),
            }),
          }).catch(() => null)) as { uid?: string } | null
          if (clip?.uid) {
            await db
              .from('games')
              .update({
                video_config: { ...cfg, pending_clip_uid: clip.uid, pending_clip_anchor: gs?.created_at ?? null },
              })
              .eq('id', resolvedGameId)
            return json({ ready: false, clipping: true }, 200) // promote it on a later poll when ready
          }
        }
      }

      // No clip needed (phone/whip, or no meaningful pre-game) — serve the raw VOD.
      await setRec(newest.uid)
      return json({ ready: true, recordingUid: newest.uid }, 200)
    }

    // action === 'start' — create or reuse the live input (token path only).
    let li: LiveInput | null = null
    if (inputUid) {
      // Reuse — but if the input was deleted (stale id), fall through and create fresh.
      try {
        li = (await cf(`/live_inputs/${inputUid}`)) as LiveInput
      } catch {
        li = null
      }
    }
    if (!li) {
      // retentionDays bounds storage cost. Cloudflare enforces a 30-day MINIMUM here,
      // so true 24h free-tier deletion needs a separate cleanup job (delete the VOD via
      // the API) — tracked separately. Default to the 30-day floor for now.
      const retentionDays = Math.max(30, Number.isFinite(body.retentionDays) ? (body.retentionDays as number) : 30)
      li = (await cf('/live_inputs', {
        method: 'POST',
        body: JSON.stringify({
          meta: { name: body.name ?? `Bandbox ${resolvedGameId}` },
          recording: { mode: 'automatic' },
          deleteRecordingAfterDays: retentionDays,
        }),
      })) as LiveInput
      const { whep, hls, code } = playbackUrls(li)
      await db.rpc('stream_attach', {
        p_token: token,
        p_uid: li.uid,
        p_code: code,
        p_whep: whep,
        p_hls: hls,
      })
    }
    // Anchor the recording clock server-side, reliably (doesn't depend on the client
    // firing on connect). Only sets it once; the replay maps events against this.
    await db.rpc('stream_mark_started', { p_token: token })

    const whipUrl = li.webRTC?.url ?? ''
    const { whep, hls } = playbackUrls(li)
    if (!whipUrl || !whep) return json({ error: 'Cloudflare did not return WebRTC URLs.' }, 502)
    // rtmps (and srt) are the ingest creds for an EXTERNAL camera/encoder (OBS, hardware
    // encoder). Same live input as the phone's WHIP — Cloudflare records RTMP ingest natively.
    return json(
      {
        liveInputUid: li.uid,
        whipUrl,
        whepUrl: whep,
        hlsUrl: hls,
        rtmps: li.rtmps ?? null,
        srt: li.srt ?? null,
      },
      200,
    )
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Stream error.' }, 502)
  }
})

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

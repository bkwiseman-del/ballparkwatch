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

  let body: { token?: string; gameId?: string; action?: string; name?: string; retentionDays?: number }
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
    if (action === 'finalize') {
      // Fetch the auto-recording VOD for this live input (ready ~60s after the stream
      // ends). Store the newest ready video as the replay. Works with the broadcaster's
      // token OR a viewer's gameId, so the replay never depends on the broadcaster
      // staying on-screen to poll.
      if (!inputUid) return json({ ready: false }, 200)
      const videos = (await cf(`/live_inputs/${inputUid}/videos`)) as
        | { uid: string; readyToStream?: boolean; created?: string }[]
        | null
      const newest = (videos ?? [])
        .slice()
        .sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''))[0]
      if (!newest) return json({ ready: false }, 200)
      if (token) await db.rpc('stream_set_recording', { p_token: token, p_recording_uid: newest.uid })
      else await db.rpc('stream_set_recording_by_game', { p_game_id: resolvedGameId, p_recording_uid: newest.uid })
      return json({ ready: !!newest.readyToStream, recordingUid: newest.uid }, 200)
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
    return json({ liveInputUid: li.uid, whipUrl, whepUrl: whep, hlsUrl: hls }, 200)
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

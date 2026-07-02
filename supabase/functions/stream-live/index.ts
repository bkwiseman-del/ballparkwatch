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

  let body: { token?: string; action?: string; name?: string; retentionDays?: number }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body.' }, 400)
  }
  const { token, action = 'start' } = body
  if (!token) return json({ error: 'Missing token.' }, 400)

  // Validate the broadcast token → game + any existing live input.
  const { data: found, error: lookErr } = await db.rpc('stream_lookup', { p_token: token })
  const game = found as { game_id?: string; cf_live_input_uid?: string | null } | null
  if (lookErr || !game?.game_id) return json({ error: 'Invalid broadcast token.' }, 403)

  try {
    if (action === 'finalize') {
      // Fetch the auto-recording VOD for this live input (ready ~60s after the stream
      // ends). Store the newest ready video as the replay; report not-ready so the
      // client can retry shortly.
      if (!game.cf_live_input_uid) return json({ ready: false }, 200)
      const videos = (await cf(`/live_inputs/${game.cf_live_input_uid}/videos`)) as
        | { uid: string; readyToStream?: boolean; created?: string }[]
        | null
      const newest = (videos ?? [])
        .slice()
        .sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''))[0]
      if (!newest) return json({ ready: false }, 200)
      await db.rpc('stream_set_recording', { p_token: token, p_recording_uid: newest.uid })
      return json({ ready: !!newest.readyToStream, recordingUid: newest.uid }, 200)
    }

    // action === 'start' — create or reuse the live input.
    let li: LiveInput
    if (game.cf_live_input_uid) {
      li = (await cf(`/live_inputs/${game.cf_live_input_uid}`)) as LiveInput
    } else {
      // retentionDays bounds storage cost. Cloudflare enforces a 30-day MINIMUM here,
      // so true 24h free-tier deletion needs a separate cleanup job (delete the VOD via
      // the API) — tracked separately. Default to the 30-day floor for now.
      const retentionDays = Math.max(30, Number.isFinite(body.retentionDays) ? (body.retentionDays as number) : 30)
      li = (await cf('/live_inputs', {
        method: 'POST',
        body: JSON.stringify({
          meta: { name: body.name ?? `Bandbox ${game.game_id}` },
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

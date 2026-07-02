// Bandbox — kick off the PAID server-side replay recording.
//
// Called by the broadcaster's phone once its WHIP publish connects (media is flowing).
// If the game is flagged record_replay, we tell the Railway recorder-manager to open a
// headless page that captures the live WHEP feed. The broadcaster's own grant token is
// reused by the recorder to upload + save (same auth as save_recording/sign-upload).
//
// Deploy: supabase functions deploy start-recording --no-verify-jwt
// Secrets: RECORDER_URL, RECORDER_SECRET (Railway service).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RECORDER_URL = (Deno.env.get('RECORDER_URL') ?? '').replace(/\/$/, '')
const RECORDER_SECRET = Deno.env.get('RECORDER_SECRET') ?? ''

const db = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: 'bpw' } })

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (p: unknown, s: number) =>
  new Response(JSON.stringify(p), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!RECORDER_URL || !RECORDER_SECRET) return json({ error: 'Recorder not configured' }, 500)

  let body: { token?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid body' }, 400)
  }
  const { token } = body
  if (!token) return json({ error: 'Missing token' }, 400)

  const { data: found, error } = await db.rpc('stream_lookup', { p_token: token })
  const game = found as { game_id?: string; record_replay?: boolean } | null
  if (error || !game?.game_id) return json({ error: 'Invalid token' }, 403)
  if (!game.record_replay) return json({ skipped: true, reason: 'replay recording not enabled for this game' }, 200)

  try {
    const res = await fetch(`${RECORDER_URL}/record`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${RECORDER_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: game.game_id, token }),
    })
    if (!res.ok) return json({ error: `recorder ${res.status}` }, 502)
    return json({ ok: true }, 200)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'recorder unreachable' }, 502)
  }
})

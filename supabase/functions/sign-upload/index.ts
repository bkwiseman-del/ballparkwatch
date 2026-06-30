// Bandbox — mint a scoped signed upload URL for a broadcast recording.
//
// The bpw-video bucket is NOT openly writable (see 20260630020000_broadcast_grants.sql).
// The filming phone (often anon) calls this with its broadcast token; we validate the
// token resolves to a game, require the path to be that game's recordings/ prefix, and
// return a one-shot signed upload URL. Keys live only here.
//
// Deploy: supabase functions deploy sign-upload --no-verify-jwt
// (auth is the broadcast token we validate below, not a JWT — the phone may be anon.)
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const BUCKET = 'bpw-video'

// schema 'bpw' so .rpc() resolves bpw.* functions; service role bypasses RLS.
const db = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: 'bpw' } })
const storage = createClient(SUPABASE_URL, SERVICE_KEY)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: { token?: string; path?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body.' }, 400)
  }
  const { token, path } = body
  if (!token || !path) return json({ error: 'Missing token/path.' }, 400)

  // Validate the broadcast token → game id (a live grant or the game's share_token).
  const { data: gameId, error } = await db.rpc('broadcast_game_id', { p_token: token })
  if (error || !gameId) return json({ error: 'Invalid broadcast token.' }, 403)

  // The path must live under this game's recordings/ prefix — no writing elsewhere.
  if (!path.startsWith(`recordings/${gameId}/`) || path.includes('..')) {
    return json({ error: 'Path not allowed for this game.' }, 403)
  }

  const { data: signed, error: signErr } = await storage.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: true })
  if (signErr || !signed) return json({ error: signErr?.message ?? 'Could not sign upload.' }, 500)

  // The client uploads with supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, blob).
  return json({ path: signed.path, token: signed.token }, 200)
})

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  })
}

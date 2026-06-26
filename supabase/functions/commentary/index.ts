// Ballpark Watch — AI voice commentary.
//
// Turns a play description into spoken commentary with ElevenLabs, caching the
// audio in Storage by (gameId, seq) so multiple viewers reuse one generation.
// Anon viewers call this (deploy with --no-verify-jwt). Keys live only here.
//
// Secrets: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID
// (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically.)

const ELEVEN_KEY = Deno.env.get('ELEVENLABS_API_KEY')
const VOICE_ID = Deno.env.get('ELEVENLABS_VOICE_ID')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const BUCKET = 'bpw-audio'
const MODEL = 'eleven_turbo_v2_5' // low-latency, good for live

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!ELEVEN_KEY || !VOICE_ID) return json({ error: 'Commentary is not configured.' }, 500)

  let body: { gameId?: string; seq?: number; text?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body.' }, 400)
  }
  const { gameId, seq, text } = body
  if (!gameId || seq == null || !text?.trim()) return json({ error: 'Missing gameId/seq/text.' }, 400)

  const path = `commentary/${gameId}/${seq}.mp3`
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`

  // Cache hit?
  try {
    const head = await fetch(publicUrl, { method: 'HEAD' })
    if (head.ok) return json({ url: publicUrl }, 200)
  } catch {
    /* fall through to generate */
  }

  // Generate TTS.
  let tts: Response
  try {
    tts = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVEN_KEY, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({
        text: text.trim().slice(0, 500),
        model_id: MODEL,
        voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.3 },
      }),
    })
  } catch (e) {
    return json({ error: `Could not reach the voice service: ${e}` }, 502)
  }
  if (!tts.ok) {
    console.error('elevenlabs error', tts.status, await tts.text().catch(() => ''))
    return json({ error: `Voice service error (${tts.status}).` }, 502)
  }
  const bytes = new Uint8Array(await tts.arrayBuffer())

  // Cache to Storage (best-effort; we still return the URL).
  try {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        'content-type': 'audio/mpeg',
        'x-upsert': 'true',
      },
      body: bytes,
    })
  } catch (e) {
    console.error('storage upload failed', e)
  }

  return json({ url: publicUrl }, 200)
})

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  })
}

// Ballpark Watch — AI voice commentary.
//
// Turns a play description into spoken commentary with ElevenLabs, caching the
// audio in Storage by (gameId, seq) so multiple viewers reuse one generation.
// Anon viewers call this (deploy with --no-verify-jwt). Keys live only here.
//
// Secrets: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID
// (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const ELEVEN_KEY = Deno.env.get('ELEVENLABS_API_KEY')
const VOICE_ID = Deno.env.get('ELEVENLABS_VOICE_ID')
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const BUCKET = 'bpw-audio'
const MODEL = 'eleven_turbo_v2_5' // low-latency TTS, good for live
const TEXT_MODEL = 'claude-haiku-4-5' // fast/cheap rewrites for high-volume lines

const sb = createClient(SUPABASE_URL, SERVICE_KEY)

// Turn a terse play / structured recap into natural broadcast speech. Pitches
// and info lines are already natural, so they pass through untouched.
async function announcerText(text: string, kind?: string): Promise<string> {
  // Only single play descriptions get a natural-language rewrite. Inning recaps
  // (kind 'summary') already carry exact, hard facts (runs, score, who's up) in a
  // natural sentence — sending them through the model only risks it mangling the
  // score/outs, so they pass through verbatim. Everything else is already natural.
  if (!ANTHROPIC_KEY || kind !== 'play') return text
  const rules =
    ' CRITICAL — restate ONLY what is in the input. "first", "second", "third" are BASES, never outs. ' +
    'Do NOT add or guess the number of outs, the count, or the score, and do NOT say the inning or half is over, the side is retired, "to end the inning", or "for the Nth out" — unless that exact information is already in the input. Never invent facts.'
  const system =
    'You are an upbeat youth-baseball play-by-play announcer. Rewrite this terse play into ONE natural, energetic spoken sentence (max ~18 words). Keep the facts (who did what, who scored). Positive in tone. Output only the sentence — no quotes, no emojis.' +
    rules
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: TEXT_MODEL,
        max_tokens: 150,
        system,
        messages: [{ role: 'user', content: text }],
      }),
    })
    if (!r.ok) return text
    const d = await r.json()
    const block = (d.content ?? []).find((b: { type: string }) => b.type === 'text')
    return (block?.text ?? '').trim() || text
  } catch {
    return text
  }
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!ELEVEN_KEY || !VOICE_ID) return json({ error: 'Commentary is not configured.' }, 500)

  let body: { gameId?: string; seq?: string | number; text?: string; kind?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body.' }, 400)
  }
  const { gameId, seq, text, kind } = body
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

  // Natural broadcast phrasing for plays/summaries.
  const speak = (await announcerText(text.trim(), kind)).slice(0, 600)

  // Generate TTS.
  let tts: Response
  try {
    tts = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVEN_KEY, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({
        text: speak,
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

  // Cache to Storage so all viewers reuse this one generation.
  const { error: upErr } = await sb.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: 'audio/mpeg', upsert: true })
  if (upErr) {
    console.error('storage upload failed', upErr.message)
    return json({ error: 'Could not store the clip.' }, 502)
  }

  return json({ url: publicUrl }, 200)
})

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  })
}

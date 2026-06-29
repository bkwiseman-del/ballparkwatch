// Bandbox — AI post-game recap.
//
// Takes a compact game summary (final score, line score, scoring plays, top
// hitters) and returns a short, warm recap for family. The Anthropic key lives
// only in this function's env. JWT verification stays ON (default) so only the
// signed-in owner spends our credits; the result is stored on the game and read
// by viewers without any further model calls.
//
// Deploy:  supabase functions deploy recap --project-ref <ref>

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const MODEL = 'claude-opus-4-8'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const RECAP_TOOL = {
  name: 'write_recap',
  description: 'Return the finished recap.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      headline: {
        type: 'string',
        description: 'A short, punchy headline (max ~70 chars), no final period.',
      },
      body: {
        type: 'string',
        description:
          'The recap: 2–3 short paragraphs of warm, family-friendly prose. Plain text, no markdown.',
      },
    },
    required: ['headline', 'body'],
  },
} as const

const SYSTEM =
  'You write short recaps of youth/amateur baseball and softball games for the ' +
  'players’ families. Tone: warm, upbeat, and specific — celebrate the kids by ' +
  'name for good plays, and frame the game positively for everyone regardless of ' +
  'the result (these are children). Ground every claim in the supplied data; never ' +
  'invent plays, names, or stats. Two to three short paragraphs, ~120–220 words. ' +
  'Mention the final score and a couple of the biggest moments and standout players.'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!ANTHROPIC_API_KEY) return json({ error: 'Recap is not configured (missing API key).' }, 500)

  let body: { summary?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body.' }, 400)
  }
  if (!body.summary) return json({ error: 'No game summary provided.' }, 400)

  let resp: Response
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        tools: [RECAP_TOOL],
        tool_choice: { type: 'tool', name: 'write_recap' },
        messages: [
          {
            role: 'user',
            content:
              'Write the recap from this game summary (JSON):\n\n' +
              JSON.stringify(body.summary),
          },
        ],
      }),
    })
  } catch (e) {
    return json({ error: `Could not reach the recap service: ${e}` }, 502)
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    console.error('anthropic error', resp.status, detail)
    return json({ error: `Recap service error (${resp.status}).` }, 502)
  }

  const data = await resp.json()
  const toolUse = (data.content ?? []).find((b: { type: string }) => b.type === 'tool_use')
  const out = toolUse?.input
  if (!out?.headline || !out?.body) {
    return json({ error: 'Could not generate a recap.' }, 422)
  }

  return json(
    {
      headline: String(out.headline).trim().slice(0, 120),
      body: String(out.body).trim().slice(0, 4000),
    },
    200,
  )
})

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  })
}

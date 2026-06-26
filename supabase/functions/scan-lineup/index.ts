// Ballpark Watch — AI lineup scan.
//
// Accepts a single image (a GameChanger/app screenshot, or a photo of a paper
// scorebook lineup) and returns a structured roster the user can review and
// edit before saving. The Anthropic key lives ONLY in this function's env —
// it never touches the browser.
//
// Auth: JWT verification is left ON (the default), so only a signed-in user
// can spend our Anthropic credits. The browser's supabase.functions.invoke
// forwards the user's bearer token automatically.
//
// Deploy:  supabase functions deploy scan-lineup --project-ref <ref>
// Secret:  supabase secrets set ANTHROPIC_API_KEY=... --project-ref <ref>

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const MODEL = 'claude-opus-4-8'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ALLOWED_MEDIA = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

// Strict tool: Claude must return exactly this shape (no prose, no guessing
// at fields it can't see — empty strings instead).
const LINEUP_TOOL = {
  name: 'report_lineup',
  description:
    'Report every player you can read from the lineup image, in the order ' +
    'they appear top to bottom.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      players: {
        type: 'array',
        description: 'One entry per player row, top to bottom.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: {
              type: 'string',
              description: 'Player full name as printed. Empty string if unreadable.',
            },
            number: {
              type: 'string',
              description: 'Jersey number as text (e.g. "7", "00"). Empty string if not shown.',
            },
            position: {
              type: 'string',
              description:
                'Fielding position abbreviation if shown (P, C, 1B, 2B, 3B, SS, LF, CF, RF, DH, EH). Empty string if not shown.',
            },
            bats: {
              type: 'string',
              enum: ['L', 'R', 'S', ''],
              description: 'Batting hand if shown: L, R, or S (switch). Empty string if not shown.',
            },
          },
          required: ['name', 'number', 'position', 'bats'],
        },
      },
    },
    required: ['players'],
  },
} as const

const PROMPT =
  'This image is a baseball/softball lineup — it may be a screenshot from an ' +
  'app like GameChanger, or a photo of a handwritten scorebook page. Read the ' +
  'roster and call report_lineup with one entry per player, preserving the ' +
  'order they appear. Transcribe names exactly as written. Only fill a field ' +
  'if you can actually read it; otherwise leave it as an empty string. Do not ' +
  'invent players or numbers.'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }
  if (!ANTHROPIC_API_KEY) {
    return json({ error: 'Lineup scan is not configured (missing API key).' }, 500)
  }

  let body: { image_base64?: string; media_type?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body.' }, 400)
  }

  const image_base64 = (body.image_base64 ?? '').replace(/^data:[^,]+,/, '')
  const media_type = body.media_type ?? 'image/jpeg'
  if (!image_base64) return json({ error: 'No image provided.' }, 400)
  if (!ALLOWED_MEDIA.has(media_type)) {
    return json({ error: `Unsupported image type: ${media_type}` }, 400)
  }

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
        max_tokens: 2048,
        tools: [LINEUP_TOOL],
        tool_choice: { type: 'tool', name: 'report_lineup' },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type, data: image_base64 },
              },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      }),
    })
  } catch (e) {
    return json({ error: `Could not reach the vision service: ${e}` }, 502)
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    console.error('anthropic error', resp.status, detail)
    return json({ error: `Vision service error (${resp.status}).` }, 502)
  }

  const data = await resp.json()
  const toolUse = (data.content ?? []).find(
    (b: { type: string }) => b.type === 'tool_use',
  )
  const players = toolUse?.input?.players
  if (!Array.isArray(players)) {
    return json({ error: 'Could not read a lineup from that image.' }, 422)
  }

  // Normalize: trim, clamp, drop blank rows.
  const cleaned = players
    .map((p: Record<string, unknown>) => ({
      name: String(p.name ?? '').trim().slice(0, 80),
      number: String(p.number ?? '').trim().slice(0, 4),
      position: String(p.position ?? '').trim().toUpperCase().slice(0, 3),
      bats: ['L', 'R', 'S'].includes(String(p.bats)) ? String(p.bats) : '',
    }))
    .filter((p) => p.name.length > 0)

  return json({ players: cleaned }, 200)
})

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  })
}

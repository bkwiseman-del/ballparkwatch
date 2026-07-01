// Bandbox — sponsor graphic/URL moderation.
//
// A sponsor banner is public and shown next to youth games, so we don't want to serve
// anything offensive. This runs a Claude vision check on the uploaded logo (+ the
// business name + click URL) and returns approve/reject for a family/kids audience.
// FAIL-CLOSED: the client only flips a sponsor to 'approved' on an explicit approve;
// anything else stays 'pending' for manual review. Anthropic key lives only here.
//
// Deploy: supabase functions deploy moderate-sponsor   (JWT verification ON)
// Secret: ANTHROPIC_API_KEY (already set for scan-lineup).

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const MODEL = 'claude-opus-4-8'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const ALLOWED_MEDIA = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

const TOOL = {
  name: 'report_moderation',
  description: 'Report whether this sponsor graphic is appropriate to show to youth-sports families.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      decision: { type: 'string', enum: ['approve', 'reject'], description: 'approve only if clearly family-appropriate' },
      reason: { type: 'string', description: 'Short reason (esp. when rejecting).' },
    },
    required: ['decision', 'reason'],
  },
} as const

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!ANTHROPIC_API_KEY) return json({ error: 'Moderation not configured (missing API key).' }, 500)

  let body: { image_base64?: string; media_type?: string; name?: string; url?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body.' }, 400)
  }
  const image_base64 = (body.image_base64 ?? '').replace(/^data:[^,]+,/, '')
  const media_type = body.media_type ?? 'image/jpeg'
  if (!image_base64) return json({ error: 'No image provided.' }, 400)
  if (!ALLOWED_MEDIA.has(media_type)) return json({ error: `Unsupported image type: ${media_type}` }, 400)

  const prompt =
    'This image is a SPONSOR logo/graphic that will be displayed on a public live-stream ' +
    'watch page for YOUTH (children’s) baseball and softball games — the audience is kids and ' +
    'their families. Business name: "' + (body.name ?? '(none)') + '". Link URL: "' + (body.url ?? '(none)') + '".\n\n' +
    'Approve ONLY if it is clearly appropriate for that audience: a legitimate business/brand ad ' +
    'with nothing sexual or nude, no profanity or slurs, no hate or violence, no weapons, and no ' +
    'promotion of alcohol, tobacco, vaping, cannabis, drugs, gambling/sportsbooks, or adult/dating ' +
    'services — and the URL/name look like a real business, not a scam, shock site, or malware. ' +
    'If anything is questionable or you are unsure, REJECT (fail closed). Call report_moderation.'

  let resp: Response
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'report_moderation' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type, data: image_base64 } },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    })
  } catch (e) {
    return json({ error: `Could not reach the moderation service: ${e}` }, 502)
  }
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    console.error('anthropic error', resp.status, detail)
    return json({ error: `Moderation service error (${resp.status}).` }, 502)
  }

  const data = await resp.json()
  const toolUse = (data.content ?? []).find((b: { type: string }) => b.type === 'tool_use')
  const decision = toolUse?.input?.decision === 'approve' ? 'approve' : 'reject'
  const reason = String(toolUse?.input?.reason ?? '').slice(0, 300)
  return json({ decision, reason }, 200)
})

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...cors, 'content-type': 'application/json' } })
}

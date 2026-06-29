// Bandbox — WebRTC ICE servers (STUN + TURN).
//
// Returns ICE servers for the phone broadcast. TURN relays make connections work
// across networks (broadcaster on LTE, viewer on home wifi) where plain STUN
// fails. Uses Twilio's Network Traversal Service to mint short-lived TURN creds.
// Falls back to public STUN if Twilio isn't configured, so it's always safe.
//
// Anon viewers/broadcasters call this (deploy with --no-verify-jwt).
// Secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN

const SID = Deno.env.get('TWILIO_ACCOUNT_SID')
const TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')

// STUN + free public TURN (Metered Open Relay) — works with no account, so even
// without Twilio configured we still relay across networks.
const STUN = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
]

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (!SID || !TOKEN) return json({ iceServers: STUN }, 200)

  try {
    const auth = btoa(`${SID}:${TOKEN}`)
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Tokens.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'Ttl=3600',
    })
    if (!resp.ok) {
      console.error('twilio nts error', resp.status, await resp.text().catch(() => ''))
      return json({ iceServers: STUN }, 200)
    }
    const data = await resp.json()
    const ice = (data.ice_servers ?? []).map(
      (s: { url?: string; urls?: string; username?: string; credential?: string }) => ({
        urls: s.urls ?? s.url,
        username: s.username,
        credential: s.credential,
      }),
    )
    return json({ iceServers: ice.length ? ice : STUN }, 200)
  } catch (e) {
    console.error('ice-servers error', e)
    return json({ iceServers: STUN }, 200)
  }
})

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  })
}

// Bandbox — send a web-push notification to a team's members.
//
// Called by the app after a staff action (new announcement, game going live,
// schedule change). Authorization is enforced against the DB: the caller must be
// team staff (is_team_staff, run as the caller). Targets are fetched with the service
// role via push_targets_for_team (never exposed to clients). Dead endpoints (404/410)
// are pruned.
//
// Deploy: supabase functions deploy send-push   (JWT verification ON — no anon)
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…).
// Auto-injected: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import webpush from 'npm:web-push@3.6.7'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:invites@bandbox.tv'

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Target = { endpoint: string; p256dh: string; auth: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!VAPID_PRIVATE) return json({ error: 'Push not configured.' }, 500)

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth) return json({ error: 'Not signed in.' }, 401)

  let body: { team_id?: string; title?: string; body?: string; url?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid body.' }, 400)
  }
  const { team_id, title } = body
  if (!team_id || !title) return json({ error: 'Missing team_id/title.' }, 400)

  // Caller-scoped: only team staff may notify a team.
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    db: { schema: 'bpw' },
    global: { headers: { Authorization: auth } },
  })
  const [{ data: staff }, { data: userRes }] = await Promise.all([
    asCaller.rpc('is_team_staff', { p_team_id: team_id }),
    asCaller.auth.getUser(),
  ])
  if (!staff) return json({ error: 'Not authorized for this team.' }, 403)
  const callerId = userRes.user?.id ?? null

  // Service role: fetch targets + prune dead ones.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: 'bpw' } })
  const { data: targets, error } = await admin.rpc('push_targets_for_team', {
    p_team_id: team_id,
    p_exclude: callerId,
  })
  if (error) return json({ error: error.message }, 500)

  const payload = JSON.stringify({ title, body: body.body ?? '', url: body.url ?? '/following' })
  let sent = 0
  const dead: string[] = []
  await Promise.all(
    ((targets ?? []) as Target[]).map(async (t) => {
      try {
        await webpush.sendNotification(
          { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
          payload,
        )
        sent++
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) dead.push(t.endpoint)
      }
    }),
  )
  if (dead.length) await admin.from('push_subscriptions').delete().in('endpoint', dead)

  return json({ sent, pruned: dead.length }, 200)
})

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  })
}

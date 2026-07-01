// Bandbox — email a team invite to a specific person.
//
// Invites are email-addressed now: a manager invites someone by email with a role
// (staff or 'family'), and we email them a one-shot join link. Authorization is NOT
// re-implemented here — we call bpw.create_team_invite() as the CALLER (their JWT is
// forwarded), and that SECURITY DEFINER function enforces can_manage_team(auth.uid()).
// If no email provider is configured the call still succeeds and returns the link so
// the manager can share it manually — email is an enhancement, not a hard dependency.
//
// Deploy: supabase functions deploy send-invite   (JWT verification ON — no anon)
// Auto-injected: SUPABASE_URL, SUPABASE_ANON_KEY. Optional secret: RESEND_API_KEY,
// INVITE_FROM_EMAIL (defaults to a bandbox.tv from-address).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM = Deno.env.get('INVITE_FROM_EMAIL') ?? 'Bandbox <invites@bandbox.tv>'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

type Body = { team_id?: string; email?: string; role?: string; team_name?: string; origin?: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth) return json({ error: 'You must be signed in.' }, 401)

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body.' }, 400)
  }
  const email = (body.email ?? '').trim()
  const role = body.role ?? ''
  if (!body.team_id || !email || !role) return json({ error: 'Missing team, email, or role.' }, 400)
  if (!EMAIL_RE.test(email)) return json({ error: 'That doesn’t look like an email address.' }, 400)

  // Caller-scoped client: create_team_invite() runs as the signed-in manager and
  // rejects anyone who can't manage this team.
  const db = createClient(SUPABASE_URL, ANON_KEY, {
    db: { schema: 'bpw' },
    global: { headers: { Authorization: auth } },
  })
  const { data: token, error } = await db.rpc('create_team_invite', {
    p_team_id: body.team_id,
    p_role: role,
    p_email: email,
    p_max_uses: 1, // email-addressed invites are single-use
  })
  if (error || !token) return json({ error: error?.message ?? 'Could not create the invite.' }, 403)

  const base = (body.origin || 'https://bandbox.tv').replace(/\/+$/, '')
  const link = `${base}/join/${token}`
  const teamName = body.team_name?.trim() || 'a team'

  let emailed = false
  let emailError: string | null = null
  if (RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: FROM,
          to: email,
          subject: role === 'family' ? `Follow ${teamName} on Bandbox` : `You're invited to help run ${teamName} on Bandbox`,
          html: inviteHtml(link, role, teamName),
        }),
      })
      emailed = res.ok
      if (!res.ok) emailError = `Email provider returned ${res.status}.`
    } catch (e) {
      emailError = e instanceof Error ? e.message : 'Email send failed.'
    }
  }

  return json({ token, link, emailed, emailError }, 200)
})

function inviteHtml(link: string, role: string, teamName: string): string {
  const lead =
    role === 'family'
      ? `You've been invited to follow <b>${escapeHtml(teamName)}</b> on Bandbox — live games, replays, schedule, and stats.`
      : `You've been invited to help run <b>${escapeHtml(teamName)}</b> on Bandbox as a ${escapeHtml(role)}.`
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#14213d">
    <h2 style="margin:0 0 8px">Bandbox</h2>
    <p style="font-size:15px;line-height:1.5">${lead}</p>
    <p style="margin:24px 0">
      <a href="${link}" style="background:#c8a04a;color:#14213d;text-decoration:none;padding:12px 20px;font-weight:bold;display:inline-block">Accept invite &#9656;</a>
    </p>
    <p style="font-size:12px;color:#6b7280">Or paste this link into your browser:<br>${link}</p>
  </div>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  })
}

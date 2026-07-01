import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Team } from '@/lib/types'

// Team roles. 'owner' is set at team creation and isn't assignable here.
type Role = 'owner' | 'admin' | 'scorer' | 'broadcaster' | 'family'
type Member = { user_id: string; email: string; role: Role; status: string; is_self: boolean }
type Invite = { id: string; email: string; role: Role; token: string; created_at: string }

// Staff run the team; family follow it. Split so inviting a parent can't be
// confused with handing someone scoring/broadcast powers.
const STAFF: { value: Exclude<Role, 'owner' | 'family'>; label: string; hint: string }[] = [
  { value: 'admin', label: 'Admin', hint: 'Coach, roster, schedule, members' },
  { value: 'scorer', label: 'Scorer', hint: 'Score games' },
  { value: 'broadcaster', label: 'Broadcaster', hint: 'Film / stream only' },
]
const ASSIGNABLE: Role[] = ['admin', 'scorer', 'broadcaster', 'family']
const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  scorer: 'Scorer',
  broadcaster: 'Broadcaster',
  family: 'Family',
}

// Manage who can run OR follow a team: list members + open invites, change roles,
// remove people, and email an invite. Owner/admin edit; everyone else views.
export function TeamMembers({ team }: { team: Team }) {
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<'staff' | 'family'>('family')
  const [staffRole, setStaffRole] = useState<Exclude<Role, 'owner' | 'family'>>('scorer')
  const [inviteEmail, setInviteEmail] = useState('')
  const [sent, setSent] = useState<{ link: string; emailed: boolean; email: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    supabase.rpc('team_members_list', { p_team_id: team.id }).then(({ data, error }) => {
      if (error) return setError(error.message)
      setMembers((data ?? []) as Member[])
    })
    supabase.rpc('team_invites_list', { p_team_id: team.id }).then(({ data }) => {
      setInvites((data ?? []) as Invite[])
    })
  }, [team.id])
  useEffect(load, [load])

  const me = members.find((m) => m.is_self)
  const canManage = me?.role === 'owner' || me?.role === 'admin'
  const staff = members.filter((m) => m.role !== 'family')
  const family = members.filter((m) => m.role === 'family')

  async function sendInvite() {
    const email = inviteEmail.trim()
    if (!email) return setError('An email is required to invite someone.')
    setBusy(true)
    setError(null)
    setSent(null)
    setCopied(false)
    const role: Role = kind === 'family' ? 'family' : staffRole
    const { data, error } = await supabase.functions.invoke('send-invite', {
      body: { team_id: team.id, email, role, team_name: team.name, origin: window.location.origin },
    })
    setBusy(false)
    if (error) {
      // Surface the edge function's JSON error if present.
      let msg = error.message
      const ctx = (error as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        try {
          const b = await ctx.json()
          if (b?.error) msg = b.error
        } catch {
          /* keep generic */
        }
      }
      return setError(msg)
    }
    setSent({ link: data.link, emailed: !!data.emailed, email })
    setInviteEmail('')
    load()
  }

  async function copyLink() {
    if (!sent) return
    try {
      await navigator.clipboard.writeText(sent.link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — link is shown for manual copy */
    }
  }

  async function changeRole(m: Member, role: Role) {
    const { error } = await supabase
      .from('team_members')
      .update({ role })
      .eq('team_id', team.id)
      .eq('user_id', m.user_id)
    if (error) setError(error.message)
    else load()
  }

  async function remove(m: Member) {
    if (!window.confirm(`Remove ${m.email} from ${team.name}?`)) return
    const { error } = await supabase
      .from('team_members')
      .delete()
      .eq('team_id', team.id)
      .eq('user_id', m.user_id)
    if (error) setError(error.message)
    else load()
  }

  async function revokeInvite(inv: Invite) {
    if (!window.confirm(`Revoke the invite for ${inv.email}?`)) return
    const { error } = await supabase.rpc('revoke_team_invite', { p_invite_id: inv.id })
    if (error) setError(error.message)
    else load()
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      {error && (
        <p className="border-2 border-barn-red bg-barn-red/10 px-3 py-2 font-data text-sm text-barn-red">{error}</p>
      )}

      {/* Invite */}
      {canManage && (
        <div className="border-2 border-ink bg-cream-off p-3">
          <p className="mb-2 font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">
            Invite someone by email
          </p>

          {/* Staff vs family */}
          <div className="mb-2 grid grid-cols-2 gap-1.5">
            {(['family', 'staff'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`border-2 py-2 font-display text-sm ${
                  kind === k ? 'border-gold bg-board-green text-cream' : 'border-ink bg-white text-ink'
                }`}
              >
                {k === 'family' ? 'Family / follower' : 'Team staff'}
              </button>
            ))}
          </div>

          {kind === 'staff' ? (
            <div className="mb-2 grid grid-cols-3 gap-1.5">
              {STAFF.map((r) => {
                const sel = staffRole === r.value
                return (
                  <button
                    key={r.value}
                    onClick={() => setStaffRole(r.value)}
                    className={`flex flex-col items-start border-2 p-2 text-left ${
                      sel ? 'border-gold bg-board-green text-cream' : 'border-ink bg-white text-ink'
                    }`}
                  >
                    <span className="font-display text-sm">{r.label}</span>
                    <span
                      className={`font-athletic text-[10px] uppercase tracking-wide ${
                        sel ? 'text-muted-green' : 'text-muted-tan'
                      }`}
                    >
                      {r.hint}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="mb-2 font-data text-xs text-muted-tan">
              Family get the full, private view — live video, replays, schedule and stats — and their own
              following app. They can’t score or change anything.
            </p>
          )}

          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendInvite()}
            placeholder="their@email.com"
            className="mb-2 w-full appearance-none rounded-none border-2 border-ink bg-white px-3 py-2 font-data text-sm outline-none focus:border-board-green"
          />
          <button
            onClick={sendInvite}
            disabled={busy || !inviteEmail.trim()}
            className="w-full bg-gold py-2.5 font-display text-ink disabled:opacity-60"
          >
            {busy ? 'Sending…' : 'Send invite ▸'}
          </button>

          {sent && (
            <div className="mt-3 border-2 border-board-green bg-white p-2.5">
              <p className="mb-1 font-athletic text-[10px] font-semibold uppercase tracking-wide text-muted-tan">
                {sent.emailed ? `Invite emailed to ${sent.email} ✓` : 'Email isn’t set up yet — send them this link'}
              </p>
              <p className="break-all font-data text-xs text-ink">{sent.link}</p>
              <button
                onClick={copyLink}
                className="mt-2 border-2 border-ink px-3 py-1.5 font-athletic text-xs font-bold uppercase tracking-wide text-ink"
              >
                {copied ? 'Copied ✓' : 'Copy link'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Pending invites */}
      {canManage && invites.length > 0 && (
        <div>
          <p className="mb-1.5 font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">
            Waiting on ({invites.length})
          </p>
          <ul className="flex flex-col border-2 border-ink">
            {invites.map((inv, i) => (
              <li
                key={inv.id}
                className={`flex items-center gap-3 bg-white px-3 py-2 ${i > 0 ? 'border-t border-ink/12' : ''}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-data text-sm text-ink">{inv.email}</p>
                  <p className="font-athletic text-[10px] uppercase tracking-wide text-muted-tan">
                    {ROLE_LABEL[inv.role]} · invited
                  </p>
                </div>
                <button
                  onClick={() => revokeInvite(inv)}
                  className="font-athletic text-xs font-bold uppercase tracking-wide text-ink/40 hover:text-barn-red"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <MemberList
        heading="Staff"
        rows={staff}
        canManage={canManage}
        onRole={changeRole}
        onRemove={remove}
      />
      <MemberList
        heading={`Family (${family.length})`}
        rows={family}
        canManage={canManage}
        onRole={changeRole}
        onRemove={remove}
        emptyHint="No family yet — invite a parent above."
      />
    </div>
  )
}

function MemberList({
  heading,
  rows,
  canManage,
  onRole,
  onRemove,
  emptyHint,
}: {
  heading: string
  rows: Member[]
  canManage: boolean
  onRole: (m: Member, role: Role) => void
  onRemove: (m: Member) => void
  emptyHint?: string
}) {
  return (
    <div>
      <p className="mb-1.5 font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">{heading}</p>
      <ul className="flex flex-col border-2 border-ink">
        {rows.map((m, i) => (
          <li
            key={m.user_id}
            className={`flex items-center gap-3 bg-cream-off px-3 py-2.5 ${i > 0 ? 'border-t border-ink/12' : ''}`}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-data text-sm text-ink">
                {m.email}
                {m.is_self && <span className="text-muted-tan"> (you)</span>}
              </p>
            </div>
            {m.role === 'owner' || !canManage || m.is_self ? (
              <span className="font-athletic text-xs font-bold uppercase tracking-wide text-muted-tan">
                {ROLE_LABEL[m.role]}
              </span>
            ) : (
              <>
                <select
                  value={m.role}
                  onChange={(e) => onRole(m, e.target.value as Role)}
                  className="appearance-none rounded-none border-2 border-ink bg-white px-2 py-1 font-athletic text-xs font-bold uppercase tracking-wide outline-none focus:border-board-green"
                >
                  {ASSIGNABLE.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => onRemove(m)}
                  title={`Remove ${m.email}`}
                  className="font-athletic text-xs font-bold uppercase tracking-wide text-ink/40 hover:text-barn-red"
                >
                  Remove
                </button>
              </>
            )}
          </li>
        ))}
        {rows.length === 0 && (
          <li className="px-3 py-3 font-data text-sm text-muted-tan">{emptyHint ?? 'Loading…'}</li>
        )}
      </ul>
    </div>
  )
}

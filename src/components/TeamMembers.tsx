import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Team } from '@/lib/types'

// Team roles. 'owner' is set at team creation and isn't assignable here.
type Role = 'owner' | 'admin' | 'scorer' | 'broadcaster'
type Member = { user_id: string; email: string; role: Role; status: string; is_self: boolean }

const ASSIGNABLE: { value: Exclude<Role, 'owner'>; label: string; hint: string }[] = [
  { value: 'admin', label: 'Admin', hint: 'Roster, schedule, members' },
  { value: 'scorer', label: 'Scorer', hint: 'Score games' },
  { value: 'broadcaster', label: 'Broadcaster', hint: 'Film / stream only' },
]

// Manage who can help run a team: list members, change roles, and mint an invite
// link (delegation is free — plan §9). Owner/admin can edit; everyone else views.
export function TeamMembers({ team }: { team: Team }) {
  const [members, setMembers] = useState<Member[]>([])
  const [error, setError] = useState<string | null>(null)
  const [inviteRole, setInviteRole] = useState<Exclude<Role, 'owner'>>('scorer')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    supabase.rpc('team_members_list', { p_team_id: team.id }).then(({ data, error }) => {
      if (error) return setError(error.message)
      setMembers((data ?? []) as Member[])
    })
  }, [team.id])
  useEffect(load, [load])

  const me = members.find((m) => m.is_self)
  const canManage = me?.role === 'owner' || me?.role === 'admin'

  async function createInvite() {
    setBusy(true)
    setError(null)
    setInviteLink(null)
    setCopied(false)
    const { data, error } = await supabase.rpc('create_team_invite', {
      p_team_id: team.id,
      p_role: inviteRole,
      p_email: inviteEmail.trim() || null,
    })
    setBusy(false)
    if (error) return setError(error.message)
    setInviteLink(`${window.location.origin}/join/${data}`)
  }

  async function copyLink() {
    if (!inviteLink) return
    try {
      await navigator.clipboard.writeText(inviteLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — the link is shown for manual copy */
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

  return (
    <div className="mx-auto max-w-lg">
      {error && (
        <p className="mb-3 border-2 border-barn-red bg-barn-red/10 px-3 py-2 font-data text-sm text-barn-red">
          {error}
        </p>
      )}

      <div>
        {/* Member list */}
        <ul className="flex flex-col border-2 border-ink">
            {members.map((m, i) => (
              <li
                key={m.user_id}
                className={`flex items-center gap-3 bg-cream-off px-3 py-2.5 ${
                  i > 0 ? 'border-t border-ink/12' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-data text-sm text-ink">
                    {m.email}
                    {m.is_self && <span className="text-muted-tan"> (you)</span>}
                  </p>
                </div>
                {m.role === 'owner' || !canManage || m.is_self ? (
                  <span className="font-athletic text-xs font-bold uppercase tracking-wide text-muted-tan">
                    {m.role}
                  </span>
                ) : (
                  <>
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m, e.target.value as Role)}
                      className="rounded-none border-2 border-ink bg-white px-2 py-1 font-athletic text-xs font-bold uppercase tracking-wide outline-none focus:border-board-green"
                    >
                      {ASSIGNABLE.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => remove(m)}
                      title={`Remove ${m.email}`}
                      className="font-athletic text-xs font-bold uppercase tracking-wide text-ink/40 hover:text-barn-red"
                    >
                      Remove
                    </button>
                  </>
                )}
              </li>
            ))}
            {members.length === 0 && (
              <li className="px-3 py-3 font-data text-sm text-muted-tan">Loading…</li>
            )}
          </ul>

          {/* Invite */}
          {canManage && (
            <div className="mt-4 border-2 border-ink bg-cream-off p-3">
              <p className="mb-2 font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">
                Invite someone
              </p>
              <div className="mb-2 grid grid-cols-3 gap-1.5">
                {ASSIGNABLE.map((r) => {
                  const sel = inviteRole === r.value
                  return (
                    <button
                      key={r.value}
                      onClick={() => setInviteRole(r.value)}
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
              <input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="Email to lock the invite to (optional)"
                className="mb-2 w-full border-2 border-ink bg-white px-3 py-2 font-data text-sm outline-none focus:border-board-green"
              />
              <button
                onClick={createInvite}
                disabled={busy}
                className="w-full bg-gold py-2.5 font-display text-ink disabled:opacity-60"
              >
                {busy ? '…' : 'Create invite link ▸'}
              </button>

              {inviteLink && (
                <div className="mt-3 border-2 border-board-green bg-white p-2.5">
                  <p className="mb-1 font-athletic text-[10px] font-semibold uppercase tracking-wide text-muted-tan">
                    Share this link {inviteEmail.trim() ? `with ${inviteEmail.trim()}` : '(anyone with it can join)'}
                  </p>
                  <p className="break-all font-data text-xs text-ink">{inviteLink}</p>
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
        </div>
      </div>
  )
}

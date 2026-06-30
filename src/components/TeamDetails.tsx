import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthProvider'
import type { Season, Team, TeamDiscovery, TeamSport } from '@/lib/types'

const AGE_GROUPS = ['6U', '7U', '8U', '9U', '10U', '11U', '12U', '13U', '14U', 'HS-JV', 'HS-V', 'Adult']
const LEVELS = ['', 'rec', 'travel', 'school', 'league']
// Each option spells out EXACTLY what it exposes — this is minors' data, so it must be
// a deliberate choice, not a vague toggle (plan §4).
const DISCOVERY: { value: TeamDiscovery; label: string; hint: string }[] = [
  { value: 'private', label: 'Private', hint: 'Only you and team members. Nothing is public.' },
  {
    value: 'discoverable',
    label: 'Discoverable',
    hint: 'A public, searchable page: schedule, scores, season stats, and roster (shown as first name + last initial). No video.',
  },
  {
    value: 'public',
    label: 'Public',
    hint: 'Everything in Discoverable, plus published game video replays.',
  },
]

// The exact thing the admin is attesting to, by level.
function attestation(d: TeamDiscovery): string {
  const base =
    "I confirm I have permission from the players' families to make this team's schedule, scores, season stats, and roster (first name + last initial) publicly visible and searchable"
  return d === 'public' ? `${base}, and to publish game video replays.` : `${base}.`
}

// Edit a team's durable identity + discovery metadata (plan §2/§8). The structured
// fields (state, season, age group, sport) are what the directory filters and the
// public team page need.
export function TeamDetails({ team, onClose, onSaved }: { team: Team; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth()
  const [seasons, setSeasons] = useState<Season[]>([])
  // Pre-checked only if the team is already public (consent previously given); a move
  // OUT of private starts unchecked so it's a deliberate act.
  const [confirmed, setConfirmed] = useState(team.discovery !== 'private')
  const [sport, setSport] = useState<TeamSport>(team.sport ?? 'baseball')
  const [city, setCity] = useState(team.city ?? '')
  const [state, setState] = useState(team.state ?? '')
  const [ageGroup, setAgeGroup] = useState(team.age_group ?? '')
  const [level, setLevel] = useState(team.level ?? '')
  const [birthYear, setBirthYear] = useState(team.birth_year ? String(team.birth_year) : '')
  const [seasonId, setSeasonId] = useState(team.season_id ?? '')
  const [discovery, setDiscovery] = useState<TeamDiscovery>(team.discovery ?? 'private')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('seasons')
      .select('*')
      .order('year', { ascending: false })
      .order('term')
      .then(({ data }) => setSeasons((data ?? []) as Season[]))
  }, [])

  async function save() {
    // Going public is gated on a deliberate consent attestation (plan §4).
    if (discovery !== 'private' && !confirmed) {
      return setErr('Please confirm you have family permission before making this team visible.')
    }
    setBusy(true)
    setErr(null)
    const by = birthYear.trim() ? Number(birthYear.trim()) : null
    const patch: Record<string, unknown> = {
      sport,
      city: city.trim() || null,
      state: state.trim().toUpperCase() || null,
      age_group: ageGroup || null,
      level: level || null,
      birth_year: by && by > 1900 && by < 2100 ? by : null,
      season_id: seasonId || null,
      discovery,
    }
    // Stamp the attestation (who/when) as the audit trail when public/discoverable.
    if (discovery !== 'private') {
      patch.consent_ack_at = new Date().toISOString()
      patch.consent_ack_by = user?.id ?? null
    }
    const { error } = await supabase.from('teams').update(patch).eq('id', team.id)
    setBusy(false)
    if (error) return setErr(error.message)
    onSaved()
    onClose()
  }

  const input = 'w-full border-2 border-ink bg-white px-3 py-2 font-data outline-none focus:border-board-green'
  const labelCls = 'mb-1 block font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan'

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col border-t-2 border-gold bg-cream text-ink sm:border-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between bg-ink px-4 py-2.5">
          <span className="font-display text-lg text-cream">{team.name} · Details</span>
          <button onClick={onClose} className="font-athletic text-cream">
            Done
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {err && <p className="border-2 border-barn-red bg-barn-red/10 px-3 py-2 font-data text-sm text-barn-red">{err}</p>}

          {/* Sport */}
          <div>
            <span className={labelCls}>Sport</span>
            <div className="flex gap-2">
              {(['baseball', 'softball'] as TeamSport[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setSport(s)}
                  className={`flex-1 border-2 py-2 font-display capitalize ${
                    sport === s ? 'border-gold bg-board-green text-cream' : 'border-ink bg-white text-ink'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* City / State */}
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <label>
              <span className={labelCls}>City</span>
              <input className={input} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Greenfield" />
            </label>
            <label>
              <span className={labelCls}>State</span>
              <input
                className={`${input} uppercase`}
                value={state}
                maxLength={2}
                onChange={(e) => setState(e.target.value.toUpperCase())}
                placeholder="IN"
              />
            </label>
          </div>

          {/* Age group / Level */}
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className={labelCls}>Age group</span>
              <select className={input} value={ageGroup} onChange={(e) => setAgeGroup(e.target.value)}>
                <option value="">—</option>
                {AGE_GROUPS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={labelCls}>Level</span>
              <select className={input} value={level} onChange={(e) => setLevel(e.target.value)}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l ? l[0].toUpperCase() + l.slice(1) : '—'}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Season / Birth year */}
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className={labelCls}>Season</span>
              <select className={input} value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
                <option value="">—</option>
                {seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={labelCls}>Birth year (travel)</span>
              <input
                className={input}
                value={birthYear}
                onChange={(e) => setBirthYear(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                placeholder="2014"
                inputMode="numeric"
              />
            </label>
          </div>

          {/* Discovery + consent gate */}
          <div>
            <span className={labelCls}>Visibility</span>
            <div className="flex flex-col gap-1.5">
              {DISCOVERY.map((d) => (
                <button
                  key={d.value}
                  onClick={() => setDiscovery(d.value)}
                  className={`flex flex-col items-start gap-0.5 border-2 px-3 py-2 text-left ${
                    discovery === d.value ? 'border-gold bg-board-green text-cream' : 'border-ink bg-white text-ink'
                  }`}
                >
                  <span className="font-display">{d.label}</span>
                  <span className={`font-data text-xs ${discovery === d.value ? 'text-muted-green' : 'text-muted-tan'}`}>
                    {d.hint}
                  </span>
                </button>
              ))}
            </div>

            {discovery !== 'private' && (
              <label className="mt-3 flex items-start gap-2.5 border-2 border-barn-red bg-barn-red/5 p-3">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-barn-red"
                />
                <span className="font-data text-xs leading-snug text-ink">{attestation(discovery)}</span>
              </label>
            )}

            <p className="mt-2 font-data text-[11px] text-muted-tan">
              {discovery === 'private'
                ? 'Nothing about this team is published.'
                : `This team will be published at ${window.location.host}/t/${team.slug ?? ''}.`}
            </p>
          </div>
        </div>

        <div className="flex gap-2 border-t-2 border-ink bg-cream-off p-4">
          <button onClick={save} disabled={busy} className="flex-1 bg-gold py-3 font-display text-ink disabled:opacity-60">
            {busy ? 'Saving…' : 'Save details'}
          </button>
          <button onClick={onClose} className="border-2 border-ink px-4 py-3 font-display text-ink">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

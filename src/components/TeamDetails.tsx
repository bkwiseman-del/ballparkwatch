import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Season, Team, TeamDiscovery, TeamSport } from '@/lib/types'

const AGE_GROUPS = ['6U', '7U', '8U', '9U', '10U', '11U', '12U', '13U', '14U', 'HS-JV', 'HS-V', 'Adult']
const LEVELS = ['', 'rec', 'travel', 'school', 'league']
const DISCOVERY: { value: TeamDiscovery; label: string; hint: string }[] = [
  { value: 'private', label: 'Private', hint: 'Only you and team members' },
  { value: 'discoverable', label: 'Discoverable', hint: 'Public stats page, names-down' },
  { value: 'public', label: 'Public', hint: 'Stats + video/replays public' },
]

// Edit a team's durable identity + discovery metadata (plan §2/§8). The structured
// fields (state, season, age group, sport) are what the directory filters and the
// public team page need.
export function TeamDetails({ team, onClose, onSaved }: { team: Team; onClose: () => void; onSaved: () => void }) {
  const [seasons, setSeasons] = useState<Season[]>([])
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
    setBusy(true)
    setErr(null)
    const by = birthYear.trim() ? Number(birthYear.trim()) : null
    const { error } = await supabase
      .from('teams')
      .update({
        sport,
        city: city.trim() || null,
        state: state.trim().toUpperCase() || null,
        age_group: ageGroup || null,
        level: level || null,
        birth_year: by && by > 1900 && by < 2100 ? by : null,
        season_id: seasonId || null,
        discovery,
      })
      .eq('id', team.id)
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

          {/* Discovery */}
          <div>
            <span className={labelCls}>Visibility</span>
            <div className="flex flex-col gap-1.5">
              {DISCOVERY.map((d) => (
                <button
                  key={d.value}
                  onClick={() => setDiscovery(d.value)}
                  className={`flex items-center justify-between border-2 px-3 py-2 text-left ${
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
            <p className="mt-1 font-data text-[11px] text-muted-tan">
              Public surfaces aren't live yet — this is saved for when the team page and directory ship.
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

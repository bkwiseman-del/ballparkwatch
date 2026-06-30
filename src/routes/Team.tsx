import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { BrandLogo } from '@/components/Logo'

type Game = {
  id: string
  when: string | null
  status: string
  home: boolean
  opponent: string
  my_score: number | null
  opp_score: number | null
  replay: boolean
}
type PublicTeam = {
  name: string
  city: string | null
  state: string | null
  sport: string
  age_group: string | null
  discovery: string
  season: string | null
  roster: { name: string; number: string | null }[]
  record: { gp: number; w: number; l: number; t: number; rf: number; ra: number }
  games: Game[]
}

// Public team page — the durable team's profile (plan §8). No account; visibility is
// gated server-side (private teams return null). Names are already down (server-side).
export default function Team() {
  const { slug } = useParams()
  const [team, setTeam] = useState<PublicTeam | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'missing'>('loading')

  useEffect(() => {
    const prev = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#F4ECD8'
    return () => {
      document.body.style.backgroundColor = prev
    }
  }, [])

  useEffect(() => {
    if (!slug) return
    supabase.rpc('get_public_team', { p_slug: slug }).then(({ data, error }) => {
      if (error || !data) return setState('missing')
      setTeam(data as PublicTeam)
      setState('ok')
    })
  }, [slug])

  if (state === 'loading') return <Shell><p className="font-data text-muted-tan">Loading…</p></Shell>
  if (state === 'missing' || !team)
    return (
      <Shell>
        <p className="font-display text-2xl text-ink">Team not found</p>
        <p className="mt-1 font-data text-sm text-muted-tan">This team is private or the link is wrong.</p>
      </Shell>
    )

  const rec = team.record
  const sub = [team.age_group, cap(team.sport), [team.city, team.state].filter(Boolean).join(', '), team.season]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="min-h-full bg-cream text-ink">
      <header className="flex items-center justify-between border-b-2 border-gold bg-ink px-4 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))]">
        <BrandLogo className="h-7 w-auto" />
        <Link to="/" className="font-athletic text-sm uppercase tracking-wide text-gold">
          Bandbox
        </Link>
      </header>

      <div className="mx-auto max-w-2xl px-4 pb-16 pt-6">
        {/* Team identity */}
        <h1 className="font-display text-3xl leading-tight text-ink">{team.name}</h1>
        {sub && <p className="mt-1 font-athletic text-sm uppercase tracking-wide text-muted-tan">{sub}</p>}

        {/* Record */}
        <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-2 border-2 border-ink bg-cream-off px-4 py-3">
          <Stat label="Record" value={rec.gp ? `${rec.w}-${rec.l}${rec.t ? `-${rec.t}` : ''}` : '—'} big />
          <Stat label="Runs for" value={String(rec.rf)} />
          <Stat label="Runs against" value={String(rec.ra)} />
          <Stat label="Diff" value={rec.gp ? signed(rec.rf - rec.ra) : '—'} />
        </div>

        {/* Results */}
        <Section title="Games">
          {team.games.length === 0 ? (
            <Empty>No games yet.</Empty>
          ) : (
            <ul className="flex flex-col border-2 border-ink">
              {team.games.map((g, i) => (
                <li key={g.id} className={`flex items-center gap-2 bg-cream-off px-3 py-2.5 ${i > 0 ? 'border-t border-ink/12' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-base">
                      <span className="text-muted-tan">{g.home ? 'vs' : 'at'}</span> {g.opponent}
                    </p>
                    <p className="font-athletic text-[11px] uppercase tracking-wide text-muted-tan">
                      {g.when ? when(g.when) : g.status}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {g.status === 'final' && g.my_score != null ? (
                      <Result my={g.my_score} opp={g.opp_score ?? 0} />
                    ) : (
                      <span className="font-athletic text-xs uppercase tracking-wide text-muted-tan">{g.status}</span>
                    )}
                    {g.status === 'final' && (
                      <Link
                        to={`/watch/${g.id}`}
                        className="border-2 border-ink px-2.5 py-1.5 font-athletic text-xs font-bold uppercase tracking-wide text-ink hover:bg-ink hover:text-cream"
                      >
                        {g.replay ? 'Replay' : 'Recap'}
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Roster */}
        <Section title="Roster">
          {team.roster.length === 0 ? (
            <Empty>No roster posted.</Empty>
          ) : (
            <ul className="grid grid-cols-2 gap-x-4 border-2 border-ink bg-cream-off p-3 sm:grid-cols-3">
              {team.roster.map((p, i) => (
                <li key={i} className="flex items-baseline gap-2 py-1">
                  <span className="w-6 text-right font-athletic text-base font-bold text-barn-red">{p.number ?? '—'}</span>
                  <span className="font-display text-sm">{p.name}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <p className="mt-8 text-center font-athletic text-[11px] uppercase tracking-[.16em] text-muted-tan">
          Player names shown as first name + last initial
        </p>
      </div>
    </div>
  )
}

function Result({ my, opp }: { my: number; opp: number }) {
  const wl = my > opp ? 'W' : my < opp ? 'L' : 'T'
  const color = my > opp ? 'text-board-green' : my < opp ? 'text-barn-red' : 'text-muted-tan'
  return (
    <span className={`shrink-0 font-display text-base tabular ${color}`}>
      {wl} {my}-{opp}
    </span>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-cream p-6 text-center">{children}</div>
  )
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="mb-2 font-athletic text-xs font-semibold uppercase tracking-[.16em] text-barn-red">{title}</h2>
      {children}
    </section>
  )
}
function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <div className="font-athletic text-[10px] font-semibold uppercase tracking-[.14em] text-muted-tan">{label}</div>
      <div className={`font-display ${big ? 'text-3xl' : 'text-xl'} text-ink`}>{value}</div>
    </div>
  )
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="border-2 border-dashed border-ink/30 px-4 py-3 font-data text-sm text-muted-tan">{children}</p>
}
function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}
function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n)
}
function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

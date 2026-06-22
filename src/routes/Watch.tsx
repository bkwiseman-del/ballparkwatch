import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { ScorePanel } from '@/components/ScorePanel'
import { FieldDiamond } from '@/components/FieldDiamond'
import { HeaderWordmark } from '@/components/Logo'
import { resolveCode } from '@/lib/scoreboard'
import { INITIAL_LIVE, occupancy, type GameEventRow, type LiveGame } from '@/lib/engine'
import {
  buildPlayByPlay,
  computeBattingLines,
  computeBoxScore,
  formatAvg,
  pitchCounts,
  type BattingLine,
  type PlayKind,
} from '@/lib/stats'
import { gameChannelName } from '@/lib/realtime'

type PublicGame = {
  id: string
  status: 'scheduled' | 'live' | 'final'
  video_source: string
  away: { name: string; code: string | null }
  home: { name: string; code: string | null }
  snapshot: Partial<LiveGame>
  lineups?: { away: LineupSlot[]; home: LineupSlot[] }
}

type LineupSlot = { name: string; jersey: string | null; pos: string | null }

type ViewerEvent = GameEventRow & { batter_name: string | null }

type Tab = 'field' | 'plays' | 'box' | 'stats'

export default function Watch() {
  const { gameId } = useParams()
  const [info, setInfo] = useState<PublicGame | null>(null)
  const [live, setLive] = useState<LiveGame>(INITIAL_LIVE)
  const [events, setEvents] = useState<ViewerEvent[]>([])
  const [tab, setTab] = useState<Tab>('field')
  const [error, setError] = useState<string | null>(null)
  const loadingEvents = useRef(false)

  const loadEvents = useCallback(async () => {
    if (!gameId || loadingEvents.current) return
    loadingEvents.current = true
    const { data, error } = await supabase.rpc('get_public_events', { p_game_id: gameId })
    loadingEvents.current = false
    if (!error && data) setEvents(data as ViewerEvent[])
  }, [gameId])

  useEffect(() => {
    if (!gameId) return
    let cancelled = false

    supabase.rpc('get_public_game', { p_game_id: gameId }).then(({ data, error }) => {
      if (cancelled) return
      if (error) return setError(error.message)
      if (!data) return setError('Game not found')
      const g = data as PublicGame
      setInfo(g)
      setLive({ ...INITIAL_LIVE, ...(g.snapshot ?? {}) })
    })
    loadEvents()

    const ch = supabase.channel(gameChannelName(gameId))
    ch.on('broadcast', { event: 'state' }, ({ payload }) => {
      setLive({ ...INITIAL_LIVE, ...(payload as LiveGame) })
      loadEvents() // refresh plays/box when the operator scores
    }).subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(ch)
    }
  }, [gameId, loadEvents])

  if (error) return <Center>{error}</Center>
  if (!info) return <Center>Loading…</Center>

  const board = {
    away: { code: resolveCode(info.away.code, info.away.name), name: info.away.name, score: live.awayScore },
    home: { code: resolveCode(info.home.code, info.home.name), name: info.home.name, score: live.homeScore },
    inning: live.inning,
    half: live.half,
    balls: live.balls,
    strikes: live.strikes,
    outs: live.outs,
    runners: occupancy(live.bases),
  }

  // Between half-innings: the scorer is at its between-innings screen (3 outs).
  const between = info.status === 'live' && (live.outs ?? 0) >= 3

  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col bg-night-green text-cream">
      {/* branded header */}
      <header className="flex items-center justify-between border-b-2 border-gold bg-ink px-3 py-2.5">
        <HeaderWordmark />
        {info.status === 'live' ? (
          <span className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-barn-red" />
            <span className="font-athletic text-sm font-semibold tracking-[.18em] text-barn-red">LIVE</span>
          </span>
        ) : (
          <span className="font-athletic text-sm tracking-[.18em] text-muted-green">
            {info.status === 'final' ? 'FINAL' : 'STARTING SOON'}
          </span>
        )}
      </header>

      {/* score panel — full width */}
      <ScorePanel state={board} />

      {/* batter / pitcher strip (hidden between innings) */}
      {info.status === 'live' && !between && <BatterPitcherStrip info={info} live={live} events={events} />}

      {/* tab bar */}
      <div className="flex border-y-2 border-gold bg-[#122019]">
        {(['field', 'plays', 'box', 'stats'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="relative flex-1 py-3 font-athletic text-xs font-semibold uppercase tracking-[.08em]"
          >
            <span className={tab === t ? 'text-cream' : 'text-muted-green'}>{t}</span>
            {tab === t && (
              <span className="absolute bottom-0 left-1/2 h-[3px] w-[30px] -translate-x-1/2 bg-gold" />
            )}
          </button>
        ))}
      </div>

      {/* content */}
      <div className="flex-1 p-4">
        {tab === 'field' && (between ? <Standby info={info} live={live} /> : <FieldTab info={info} live={live} events={events} />)}
        {tab === 'plays' && <PlaysTab events={events} />}
        {tab === 'box' && <BoxTab board={board} events={events} />}
        {tab === 'stats' && <StatsTab board={board} events={events} />}
      </div>
    </div>
  )
}

function BatterPitcherStrip({
  info,
  live,
  events,
}: {
  info: PublicGame
  live: LiveGame
  events: ViewerEvent[]
}) {
  const lineups = info.lineups
  if (!lineups) return null
  const battingKey = live.half === 'top' ? 'away' : 'home'
  const fieldingKey = live.half === 'top' ? 'home' : 'away'
  const order = lineups[battingKey]
  const idx = battingKey === 'away' ? live.awayBatterIdx : live.homeBatterIdx
  const batter = order.length ? order[idx % order.length] : null
  const onDeck = order.length ? order[(idx + 1) % order.length] : null
  const pitcher = lineups[fieldingKey].find((p) => p.pos === 'P') ?? null
  const pc = pitchCounts(events)
  const pitches = fieldingKey === 'home' ? pc.home : pc.away
  if (!batter && !pitcher) return null

  return (
    <div className="flex border-b-2 border-ink bg-cream text-ink">
      <div className="flex-1 border-r border-ink/20 px-3 py-2">
        <p className="font-athletic text-[10px] font-semibold uppercase tracking-[.14em] text-barn-red">At Bat</p>
        {batter ? (
          <>
            <p className="font-display text-base leading-tight">
              <span className="text-barn-red">{batter.jersey ?? '—'}</span> {batter.name}
            </p>
            {onDeck && (
              <p className="font-data text-[11px] text-muted-tan">
                On deck: {onDeck.jersey ? `${onDeck.jersey} ` : ''}
                {onDeck.name}
              </p>
            )}
          </>
        ) : (
          <p className="font-data text-sm text-muted-tan">—</p>
        )}
      </div>
      <div className="flex-1 px-3 py-2 text-right">
        <p className="font-athletic text-[10px] font-semibold uppercase tracking-[.14em] text-muted-tan">Pitching</p>
        {pitcher ? (
          <>
            <p className="font-display text-base leading-tight">
              <span className="text-barn-red">{pitcher.jersey ?? '—'}</span> {pitcher.name}
            </p>
            <p className="font-data text-[11px] text-muted-tan">{pitches} pitches</p>
          </>
        ) : (
          <p className="font-data text-sm text-muted-tan">—</p>
        )}
      </div>
    </div>
  )
}

function Standby({ info, live }: { info: PublicGame; live: LiveGame }) {
  const nextTop = live.half === 'bottom'
  const order = info.lineups?.[nextTop ? 'away' : 'home'] ?? []
  const idx = (nextTop ? live.awayBatterIdx : live.homeBatterIdx) % (order.length || 1)
  const due = order.length ? [0, 1, 2].map((i) => order[(idx + i) % order.length]) : []
  const label = live.half === 'top' ? 'Middle' : 'End'
  return (
    <div className="flex flex-col items-center gap-5 py-12 text-center">
      <StitchedBall />
      <p className="font-display text-3xl leading-tight text-cream">
        {label}
        <br />
        of the {ordinalNum(live.inning)}
      </p>
      <p className="font-athletic text-sm uppercase tracking-[.12em] text-muted-green">
        {info.away.code ?? 'AWY'} {live.awayScore} · {info.home.code ?? 'HOM'} {live.homeScore}
      </p>
      {due.length > 0 && (
        <div className="w-full max-w-xs border-t border-gold/30 pt-4">
          <p className="mb-1 font-athletic text-[10px] uppercase tracking-[.16em] text-muted-green">Due up</p>
          <p className="font-data text-sm text-cream">
            {due.map((p) => `${p.jersey ?? ''} ${p.name.split(' ').pop()}`).join(' · ')}
          </p>
        </div>
      )}
    </div>
  )
}

function StitchedBall() {
  return (
    <svg width="56" height="56" viewBox="0 0 100 100" aria-hidden>
      <circle cx="50" cy="50" r="36" fill="none" stroke="#C9A14A" strokeWidth="5" />
      <path d="M34 26 q12 24 0 48" fill="none" stroke="#A6342E" strokeWidth="4" strokeDasharray="2.5 5" strokeLinecap="round" />
      <path d="M66 26 q-12 24 0 48" fill="none" stroke="#A6342E" strokeWidth="4" strokeDasharray="2.5 5" strokeLinecap="round" />
    </svg>
  )
}

function ordinalNum(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/* ---------------------------------------------------------------- tabs */

function nameMap(events: ViewerEvent[]) {
  const m = new Map<string, string>()
  for (const e of events) if (e.batter_id && e.batter_name) m.set(e.batter_id, e.batter_name)
  return m
}

function FieldTab({ info, live, events }: { info: PublicGame; live: LiveGame; events: ViewerEvent[] }) {
  const map = nameMap(events)
  const plays = buildPlayByPlay(events, (id) => (id ? map.get(id) ?? null : null))
  const latest = plays[0]

  // last name for runner chips
  const runnerName = (id: string) => {
    const n = map.get(id)
    return n ? (n.trim().split(/\s+/).pop() ?? n) : null
  }

  // defense + current batter from the lineups
  const fieldingKey = live.half === 'top' ? 'home' : 'away'
  const battingKey = live.half === 'top' ? 'away' : 'home'
  const fielders = (info.lineups?.[fieldingKey] ?? []).map((p) => ({ pos: p.pos, name: p.name }))
  const order = info.lineups?.[battingKey] ?? []
  const idx = battingKey === 'away' ? live.awayBatterIdx : live.homeBatterIdx
  const batter = order.length ? order[idx % order.length] : null
  const batterLabel = batter ? (batter.name.trim().split(/\s+/).pop() ?? batter.name).toUpperCase() : null

  return (
    <div>
      {latest && (
        <div className="mb-3 bg-barn-red px-3 py-2 font-athletic text-sm font-semibold uppercase tracking-wide text-cream">
          ▸ {latest.text}
        </div>
      )}
      <div className="border-2 border-gold">
        <FieldDiamond
          bases={live.bases}
          nameOf={runnerName}
          fielders={fielders}
          batterLabel={batterLabel}
          className="block w-full"
        />
      </div>
    </div>
  )
}

const KIND_COLOR: Record<PlayKind, string> = {
  scoring: 'text-barn-red',
  out: 'text-board-green',
  hit: 'text-gold',
  neutral: 'text-muted-green',
}

function PlaysTab({ events }: { events: ViewerEvent[] }) {
  const map = nameMap(events)
  const plays = buildPlayByPlay(events, (id) => (id ? map.get(id) ?? null : null))
  if (plays.length === 0) return <Empty>No plays yet.</Empty>
  return (
    <ul className="flex flex-col divide-y divide-cream/10">
      {plays.map((p) => (
        <li key={p.seq} className="flex gap-3 py-2.5">
          <span className={`w-12 shrink-0 font-athletic text-xs font-semibold uppercase ${KIND_COLOR[p.kind]}`}>
            {p.half === 'top' ? '▲' : '▼'}
            {p.inning}
          </span>
          <span className="font-data text-[13px] text-cream">{p.text}</span>
        </li>
      ))}
    </ul>
  )
}

function BoxTab({
  board,
  events,
}: {
  board: { away: { code: string; name?: string }; home: { code: string; name?: string } }
  events: ViewerEvent[]
}) {
  const box = computeBoxScore(events)
  const map = nameMap(events)
  const bats = computeBattingLines(events, (id) => map.get(id) ?? null)
  const innings = Array.from({ length: box.innings }, (_, i) => i + 1)
  const Row = ({ code, t, accent }: { code: string; t: typeof box.away; accent?: boolean }) => (
    <tr>
      <td className={`py-2 pr-3 font-display text-base ${accent ? 'text-gold' : 'text-cream'}`}>{code}</td>
      {innings.map((n) => (
        <td key={n} className="px-1 py-2 text-center font-athletic tabular text-cream/90">
          {t.runsByInning[n - 1] ?? 0}
        </td>
      ))}
      <td className="px-2 py-2 text-center font-athletic font-bold tabular text-cream">{t.r}</td>
      <td className="px-2 py-2 text-center font-athletic tabular text-muted-green">{t.h}</td>
      <td className="px-2 py-2 text-center font-athletic tabular text-muted-green">{t.e}</td>
    </tr>
  )
  return (
    <div className="flex flex-col gap-5">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-cream/20 font-athletic text-xs text-muted-green">
            <th className="py-2 text-left"></th>
            {innings.map((n) => (
              <th key={n} className="px-1 py-2 text-center font-normal">
                {n}
              </th>
            ))}
            <th className="px-2 py-2 text-center">R</th>
            <th className="px-2 py-2 text-center">H</th>
            <th className="px-2 py-2 text-center">E</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-cream/10">
          <Row code={board.away.code} t={box.away} />
          <Row code={board.home.code} t={box.home} accent />
        </tbody>
      </table>

      <BattingTable title={board.away.name ?? board.away.code} lines={bats.away} />
      <BattingTable title={board.home.name ?? board.home.code} lines={bats.home} accent />
    </div>
  )
}

function BattingTable({
  title,
  lines,
  accent = false,
}: {
  title: string
  lines: BattingLine[]
  accent?: boolean
}) {
  if (lines.length === 0) return null
  // Keep batters in first-appearance order isn't available here; sort by AB desc
  // then hits desc as a reasonable batting summary.
  const sorted = lines.slice().sort((a, b) => b.ab - a.ab || b.h - a.h)
  return (
    <div>
      <h3 className={`mb-1.5 font-display text-base ${accent ? 'text-gold' : 'text-cream'}`}>{title}</h3>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-cream/20 font-athletic text-[11px] text-muted-green">
            <th className="py-1.5 text-left font-normal">Batter</th>
            {['AB', 'H', '2B', '3B', 'HR', 'BB', 'K', 'AVG'].map((h) => (
              <th key={h} className="px-1.5 py-1.5 text-center font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-cream/10">
          {sorted.map((l) => (
            <tr key={l.playerId} className="font-data text-[13px]">
              <td className="py-1.5 pr-2 text-cream">{l.name}</td>
              <Num n={l.ab} />
              <Num n={l.h} bold />
              <Num n={l.doubles} />
              <Num n={l.triples} />
              <Num n={l.hr} />
              <Num n={l.bb} />
              <Num n={l.k} />
              <td className="px-1.5 py-1.5 text-center tabular text-muted-green">{formatAvg(l.avg)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Num({ n, bold = false }: { n: number; bold?: boolean }) {
  return (
    <td className={`px-1.5 py-1.5 text-center tabular ${bold ? 'font-bold text-cream' : 'text-cream/85'}`}>
      {n}
    </td>
  )
}

function StatsTab({
  board,
  events,
}: {
  board: { away: { code: string; name?: string }; home: { code: string; name?: string } }
  events: ViewerEvent[]
}) {
  const box = computeBoxScore(events)
  // simple hit leaders from the log
  const map = nameMap(events)
  const hits = new Map<string, number>()
  for (const e of events) {
    if (['single', 'double', 'triple', 'home_run'].includes(e.event_type) && e.batter_id) {
      hits.set(e.batter_id, (hits.get(e.batter_id) ?? 0) + 1)
    }
  }
  const leaders = [...hits.entries()]
    .map(([id, h]) => ({ name: map.get(id) ?? '—', h }))
    .sort((a, b) => b.h - a.h)
    .slice(0, 5)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="mb-2 font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-green">
          Team totals
        </h3>
        <div className="grid grid-cols-3 gap-px bg-cream/15 font-data text-sm">
          {['', board.away.code, board.home.code].map((c, i) => (
            <div key={i} className="bg-night-green px-2 py-1.5 text-center font-athletic font-semibold text-muted-green">
              {c}
            </div>
          ))}
          {(
            [
              ['Runs', box.away.r, box.home.r],
              ['Hits', box.away.h, box.home.h],
              ['Errors', box.away.e, box.home.e],
            ] as const
          ).map(([label, a, h]) => (
            <Stat3 key={label} label={label} a={a} h={h} />
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-green">
          Hit leaders
        </h3>
        {leaders.length === 0 ? (
          <Empty>No hits yet.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-cream/10">
            {leaders.map((l, i) => (
              <li key={i} className="flex items-center justify-between py-2">
                <span className="font-display text-sm text-cream">{l.name}</span>
                <span className="font-athletic tabular text-gold">{l.h} H</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function Stat3({ label, a, h }: { label: string; a: number; h: number }) {
  return (
    <>
      <div className="bg-night-green px-2 py-1.5 text-muted-green">{label}</div>
      <div className="bg-night-green px-2 py-1.5 text-center tabular text-cream">{a}</div>
      <div className="bg-night-green px-2 py-1.5 text-center tabular text-cream">{h}</div>
    </>
  )
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-night-green p-6 text-center font-athletic text-muted-green">
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 font-data text-sm text-muted-green">{children}</p>
}

import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useScorer } from '@/hooks/useScorer'
import { Scorebug } from '@/components/Scorebug'
import { FieldDiamond, type BaseName } from '@/components/FieldDiamond'
import { resolveCode } from '@/lib/scoreboard'
import { computeBattingLines } from '@/lib/stats'
import {
  EVENT_LABELS,
  occupancy,
  type Dest,
  type EventType,
  type LiveGame,
  type Resolution,
} from '@/lib/engine'
import type { Player, Team } from '@/lib/types'

export default function Score() {
  const { gameId } = useParams()
  const s = useScorer(gameId)
  const { game, teams, live, events, loading, error, act, undo } = s
  const [strikePopup, setStrikePopup] = useState(false)
  const [inPlay, setInPlay] = useState(false)

  if (loading) return <Centered>Loading game…</Centered>
  if (error && !game) return <Centered>{error}</Centered>

  const lastLabel = events.length ? EVENT_LABELS[events.at(-1)!.event_type] : null
  const board = toBoard(live, teams)
  const halfOver = live.outs >= 3
  const notStarted = live.status === 'scheduled'
  const isFinal = live.status === 'final'
  const playing = !notStarted && !isFinal && !halfOver

  const nameOf = (id: string) => shortName(s.playersById.get(id))

  // BALL on 3 balls = walk; STRIKE on 2 strikes = strikeout (keeps stats clean).
  const onBall = () => (live.balls >= 3 ? act('walk') : act('pitch_ball'))
  const onStrikeKind = (kind: string) => {
    setStrikePopup(false)
    if (live.strikes >= 2) act('strikeout', { kind })
    else act('pitch_strike', { kind })
  }

  const advanceRunner = (base: BaseName, id: string) => {
    const from = base === 'first' ? 1 : base === 'second' ? 2 : 3
    act('runner_advance', { runner: id, to: (from + 1) as Dest })
  }

  return (
    <div className="mx-auto flex min-h-full max-w-[430px] flex-col bg-night-green text-cream">
      <header className="flex items-center justify-between border-b-2 border-gold bg-ink px-3 py-2">
        <Link to="/setup" className="font-athletic text-sm uppercase tracking-wide text-gold">
          ← Setup
        </Link>
        <span className="font-athletic text-xs uppercase tracking-[.16em] text-muted-green">Scorer</span>
        <Link to={`/watch/${gameId}`} target="_blank" className="font-athletic text-sm uppercase tracking-wide text-gold">
          Watch ↗
        </Link>
      </header>

      <div className="flex justify-center bg-night-green px-3 py-3">
        <Scorebug state={board} variant="dark" />
      </div>

      {error && <p className="bg-barn-red/15 px-3 py-1 font-data text-xs text-barn-red">{error}</p>}

      {/* batter / pitcher strip */}
      {playing && <BatterPitcherStrip scorer={s} gameId={gameId} />}

      {/* live field */}
      {playing && (
        <div className="bg-board-green">
          <div className="flex items-center justify-between bg-field-green px-3 py-1.5">
            <span className="font-athletic text-[10px] uppercase tracking-[.14em] text-muted-green">
              {runnersLabel(live)}
            </span>
            <span className="font-athletic text-[10px] uppercase tracking-wide text-gold">
              tap runner ▸ advance
            </span>
          </div>
          <div className="mx-auto max-w-[300px]">
            <FieldDiamond
              bases={live.bases}
              nameOf={nameOf}
              onRunnerTap={advanceRunner}
              batterLabel={s.currentBatter ? shortName(s.currentBatter) : null}
              className="block w-full"
            />
          </div>
          {/* AB pitch log */}
          <div className="flex items-center gap-1.5 bg-cream-off px-3 py-1.5">
            <span className="font-athletic text-[10px] font-semibold uppercase tracking-[.12em] text-muted-tan">
              AB
            </span>
            {s.abPitches.map((c, i) => (
              <span
                key={i}
                className="flex h-6 w-6 items-center justify-center font-athletic text-xs font-bold text-cream"
                style={{ background: c === 'B' ? '#2C5234' : '#A6342E' }}
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* context for non-playing states */}
      {!playing && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-8 text-center">
          {notStarted ? (
            <>
              <p className="font-display text-2xl">Ready to start</p>
              <button onClick={() => act('game_start')} className="bg-gold px-8 py-4 font-display text-xl text-ink">
                START GAME ▸
              </button>
            </>
          ) : isFinal ? (
            <p className="font-display text-3xl text-gold">FINAL</p>
          ) : (
            <>
              <p className="font-athletic uppercase tracking-[.16em] text-muted-green">3 outs</p>
              <p className="font-display text-2xl">
                {live.half === 'top' ? 'Middle' : 'End'} of {ordinal(live.inning)}
              </p>
              <button onClick={() => act('inning_change')} className="bg-gold px-8 py-4 font-display text-lg text-ink">
                {live.half === 'top'
                  ? `START BOTTOM ${ordinal(live.inning)} ▸`
                  : `START TOP ${ordinal(live.inning + 1)} ▸`}
              </button>
            </>
          )}
        </div>
      )}

      {/* undo strip */}
      {!notStarted && !isFinal && (
        <div className="flex items-center justify-between border-t-2 border-ink bg-gold px-3 py-2">
          <button onClick={undo} disabled={!events.length} className="font-athletic text-[13px] font-semibold text-ink disabled:opacity-40">
            ↶ UNDO{lastLabel ? ` — ${lastLabel}` : ''}
          </button>
          <button
            onClick={() => confirm('End game and record final?') && act('game_end')}
            className="font-athletic text-xs font-bold uppercase text-barn-red"
          >
            END ▸
          </button>
        </div>
      )}

      {/* action zone */}
      {playing && (
        <div className="flex flex-col gap-2.5 bg-ink p-3.5">
          <div className="grid grid-cols-2 gap-2.5">
            <ActionBtn className="h-[68px] bg-board-green" onClick={onBall}>BALL</ActionBtn>
            <ActionBtn className="h-[68px] bg-barn-red" onClick={() => setStrikePopup(true)}>STRIKE</ActionBtn>
          </div>
          <div className="grid grid-cols-[1fr_1fr_1.4fr] gap-2.5">
            <ActionBtn className="h-[54px] border-2 border-gold text-gold" onClick={() => act('pitch_foul')}>FOUL</ActionBtn>
            <ActionBtn className="h-[54px] border-2 border-cream text-cream" onClick={() => act('hit_by_pitch')}>HBP</ActionBtn>
            <ActionBtn className="h-[54px] bg-gold text-ink" onClick={() => setInPlay(true)}>IN PLAY ▸</ActionBtn>
          </div>
        </div>
      )}

      {strikePopup && <StrikePopup live={live} onPick={onStrikeKind} onClose={() => setStrikePopup(false)} />}
      {inPlay && (
        <InPlayFlow
          batter={s.currentBatter}
          runners={s.runnersOnBase}
          onCancel={() => setInPlay(false)}
          onConfirm={(result, resolution, rbi) => {
            act(result, { resolution, rbi })
            setInPlay(false)
          }}
        />
      )}
    </div>
  )
}

/* ----------------------------------------------------------- batter strip */

function BatterPitcherStrip({
  scorer,
  gameId,
}: {
  scorer: ReturnType<typeof useScorer>
  gameId: string | undefined
}) {
  const { currentBatter, currentPitcher, events, playersById } = scorer
  if (!currentBatter) {
    return (
      <div className="flex items-center justify-between bg-cream px-3 py-2 text-ink">
        <span className="font-athletic text-xs uppercase tracking-[.14em] text-muted-tan">No lineup set</span>
        <Link to={`/lineup/${gameId}`} className="font-athletic text-xs font-semibold uppercase text-board-green underline">
          Set lineup ▸
        </Link>
      </div>
    )
  }
  const lines = computeBattingLines(events, (id) => playersById.get(id)?.name ?? null)
  const line = [...lines.away, ...lines.home].find((l) => l.playerId === currentBatter.id)
  const lineText = line && line.ab > 0 ? `${line.h}-for-${line.ab}` : 'first AB'
  return (
    <div className="flex border-b-2 border-ink bg-cream text-ink">
      <div className="flex-1 border-r border-ink/20 px-3 py-2">
        <p className="font-athletic text-[10px] font-semibold uppercase tracking-[.14em] text-barn-red">At Bat</p>
        <p className="font-display text-base leading-tight">
          <span className="text-barn-red">{currentBatter.jersey_number ?? '—'}</span> {currentBatter.name}
        </p>
        <p className="font-data text-[11px] text-muted-tan">{lineText}</p>
      </div>
      <div className="flex-1 px-3 py-2">
        <p className="font-athletic text-[10px] font-semibold uppercase tracking-[.14em] text-muted-tan">Pitching</p>
        <p className="font-display text-base leading-tight">
          {currentPitcher ? (
            <>
              <span className="text-barn-red">{currentPitcher.jersey_number ?? '—'}</span> {currentPitcher.name}
            </>
          ) : (
            <span className="text-muted-tan">—</span>
          )}
        </p>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- strike popup */

function StrikePopup({
  live,
  onPick,
  onClose,
}: {
  live: LiveGame
  onPick: (kind: string) => void
  onClose: () => void
}) {
  const nextStrikes = Math.min(live.strikes + 1, 3)
  const willK = live.strikes >= 2
  return (
    <Overlay onClose={onClose}>
      <div className="w-[320px] border-[3px] border-barn-red bg-cream text-ink shadow-hard">
        <div className="flex items-center justify-between bg-barn-red px-4 py-2.5">
          <span className="font-display text-lg text-cream">Strike — what kind?</span>
          <button onClick={onClose} className="font-athletic text-cream">✕</button>
        </div>
        <div className="flex items-center justify-center gap-2 border-b border-ink/20 bg-cream-off py-2 font-athletic">
          <span className="text-xs uppercase tracking-wide text-muted-tan">Count</span>
          <span className="font-display">{live.balls}–{live.strikes}</span>
          <span className="text-muted-tan">→</span>
          <span className="font-display text-barn-red">{live.balls}–{nextStrikes}</span>
        </div>
        <div className="flex flex-col gap-2 p-3">
          <ActionBtn className="h-[54px] bg-barn-red" onClick={() => onPick('swinging')}>SWINGING</ActionBtn>
          <ActionBtn className="h-[54px] border-2 border-ink text-ink" onClick={() => onPick('looking')}>LOOKING</ActionBtn>
          <button
            onClick={() => onPick('foul_tip')}
            className="h-[44px] border-2 border-ink/30 font-athletic font-bold uppercase tracking-wide text-muted-tan"
          >
            Foul tip
          </button>
        </div>
        {willK && (
          <p className="px-3 pb-3 text-center font-data text-xs text-barn-red">This is strike three — records a strikeout.</p>
        )}
      </div>
    </Overlay>
  )
}

/* --------------------------------------------------------- in-play resolve */

const RESULTS: { type: EventType; label: string; group: 'hit' | 'out' | 'other' }[] = [
  { type: 'single', label: '1B', group: 'hit' },
  { type: 'double', label: '2B', group: 'hit' },
  { type: 'triple', label: '3B', group: 'hit' },
  { type: 'home_run', label: 'HR', group: 'hit' },
  { type: 'groundout', label: 'GROUND OUT', group: 'out' },
  { type: 'flyout', label: 'FLY OUT', group: 'out' },
  { type: 'lineout', label: 'LINE OUT', group: 'out' },
  { type: 'fielders_choice', label: "FIELDER'S CHOICE", group: 'other' },
  { type: 'error', label: 'REACH ON ERROR', group: 'other' },
]

const BATTER_DEST: Partial<Record<EventType, Dest>> = {
  single: 1, double: 2, triple: 3, home_run: 4, error: 1, fielders_choice: 1,
  groundout: 0, flyout: 0, lineout: 0,
}
const RUNNER_ADVANCE: Partial<Record<EventType, number>> = {
  single: 1, error: 1, double: 2, triple: 3, home_run: 4,
}

type OnBase = { key: BaseName; from: number; player: Player }

function InPlayFlow({
  batter,
  runners,
  onCancel,
  onConfirm,
}: {
  batter: Player | null
  runners: { first: Player | null; second: Player | null; third: Player | null }
  onCancel: () => void
  onConfirm: (result: EventType, resolution: Resolution, rbi: number) => void
}) {
  const [result, setResult] = useState<EventType | null>(null)

  const onBase: OnBase[] = [
    runners.first && { key: 'first' as const, from: 1, player: runners.first },
    runners.second && { key: 'second' as const, from: 2, player: runners.second },
    runners.third && { key: 'third' as const, from: 3, player: runners.third },
  ].filter(Boolean) as OnBase[]

  return (
    <Overlay onClose={onCancel} align="end">
      <div className="w-full max-w-[430px] border-t-2 border-gold bg-field-green p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-athletic text-sm font-semibold uppercase tracking-[.12em] text-cream">
            Ball in play — result
          </span>
          <button onClick={onCancel} className="font-athletic text-cream">✕</button>
        </div>

        {/* step 1: result */}
        <div className="mb-3 grid grid-cols-4 gap-2">
          {RESULTS.filter((r) => r.group === 'hit').map((r) => (
            <ResultBtn key={r.type} active={result === r.type} onClick={() => setResult(r.type)} gold>
              {r.label}
            </ResultBtn>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {RESULTS.filter((r) => r.group !== 'hit').map((r) => (
            <ResultBtn key={r.type} active={result === r.type} onClick={() => setResult(r.type)}>
              {r.label}
            </ResultBtn>
          ))}
        </div>

        {/* step 2: resolve each runner */}
        {result && (
          <Resolver result={result} batter={batter} onBase={onBase} onConfirm={onConfirm} />
        )}
      </div>
    </Overlay>
  )
}

function Resolver({
  result,
  batter,
  onBase,
  onConfirm,
}: {
  result: EventType
  batter: Player | null
  onBase: OnBase[]
  onConfirm: (result: EventType, resolution: Resolution, rbi: number) => void
}) {
  // default destinations
  const adv = RUNNER_ADVANCE[result]
  const initial: Record<string, Dest> = {}
  initial['batter'] = BATTER_DEST[result] ?? 0
  for (const r of onBase) {
    initial[r.player.id] = (adv ? Math.min(r.from + adv, 4) : r.from) as Dest
  }
  const [dest, setDest] = useState<Record<string, Dest>>(initial)

  const set = (key: string, d: Dest) => setDest((p) => ({ ...p, [key]: d }))
  const runs = Object.values(dest).filter((d) => d === 4).length
  const outs = Object.values(dest).filter((d) => d === 0).length

  const confirm = () => {
    const resolution: Resolution = {
      batter: dest['batter'] ?? 0,
      runners: Object.fromEntries(onBase.map((r) => [r.player.id, dest[r.player.id] ?? r.from])),
    }
    onConfirm(result, resolution, runs)
  }

  return (
    <div className="mt-4 border-t-2 border-gold/30 pt-3">
      <p className="mb-2 font-athletic text-[10px] font-semibold uppercase tracking-[.14em] text-muted-green">
        Where did each runner end up?
      </p>
      <div className="flex flex-col gap-3">
        <Ladder label="BATTER" name={batter?.name ?? 'Batter'} value={dest['batter'] ?? 0} onPick={(d) => set('batter', d)} />
        {onBase.map((r) => (
          <Ladder
            key={r.player.id}
            label={`ON ${baseLabel(r.from)}`}
            name={r.player.name}
            value={dest[r.player.id] ?? r.from}
            onPick={(d) => set(r.player.id, d)}
          />
        ))}
      </div>
      <div className="mt-4 flex items-center gap-4">
        <span className="font-athletic text-xs uppercase tracking-wide text-muted-green">
          OUTS <b className="font-display text-cream">{outs}</b>
        </span>
        <span className="font-athletic text-xs uppercase tracking-wide text-muted-green">
          RBI <b className="font-display text-cream">{runs}</b>
        </span>
        <button onClick={confirm} className="ml-auto flex-1 bg-board-green py-3 font-display text-cream">
          CONFIRM PLAY ▸
        </button>
      </div>
    </div>
  )
}

const DESTS: { d: Dest; label: string }[] = [
  { d: 0, label: 'OUT' },
  { d: 1, label: '1B' },
  { d: 2, label: '2B' },
  { d: 3, label: '3B' },
  { d: 4, label: 'HOME' },
]

function Ladder({
  label,
  name,
  value,
  onPick,
}: {
  label: string
  name: string
  value: Dest
  onPick: (d: Dest) => void
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="bg-gold px-1.5 py-0.5 font-athletic text-[10px] font-bold uppercase text-ink">{label}</span>
        <span className="font-display text-sm text-cream">{name}</span>
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {DESTS.map((o) => {
          const active = value === o.d
          const isOut = o.d === 0
          return (
            <button
              key={o.d}
              onClick={() => onPick(o.d)}
              className={`h-9 font-athletic text-[13px] font-bold ${
                active
                  ? isOut
                    ? 'bg-barn-red text-cream'
                    : 'bg-board-green text-cream'
                  : 'border border-cream/30 text-cream/80'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ shared */

function ResultBtn({
  children,
  active,
  gold = false,
  onClick,
}: {
  children: React.ReactNode
  active: boolean
  gold?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-12 items-center justify-center px-1 text-center font-display text-sm ${
        active
          ? 'bg-gold text-ink'
          : gold
            ? 'bg-gold/80 text-ink'
            : 'border-2 border-cream text-cream'
      }`}
    >
      {children}
    </button>
  )
}

function ActionBtn({
  children,
  className = '',
  onClick,
}: {
  children: React.ReactNode
  className?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center font-display text-xl text-cream active:opacity-80 ${className}`}
    >
      {children}
    </button>
  )
}

function Overlay({
  children,
  onClose,
  align = 'center',
}: {
  children: React.ReactNode
  onClose: () => void
  align?: 'center' | 'end'
}) {
  return (
    <div
      className={`fixed inset-0 z-10 flex justify-center bg-black/60 ${align === 'end' ? 'items-end' : 'items-center'}`}
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center p-6 text-center font-athletic text-muted-green">
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ utils */

function toBoard(live: LiveGame, teams: { away: Team; home: Team } | null) {
  return {
    away: { code: resolveCode(teams?.away.code, teams?.away.name), name: teams?.away.name, score: live.awayScore },
    home: { code: resolveCode(teams?.home.code, teams?.home.name), name: teams?.home.name, score: live.homeScore },
    inning: live.inning,
    half: live.half,
    balls: live.balls,
    strikes: live.strikes,
    outs: live.outs,
    runners: occupancy(live.bases),
  }
}

function runnersLabel(live: LiveGame): string {
  const on: string[] = []
  if (live.bases.first) on.push('1st')
  if (live.bases.second) on.push('2nd')
  if (live.bases.third) on.push('3rd')
  if (on.length === 0) return 'Bases empty'
  if (on.length === 3) return 'Bases loaded'
  return `Runners on · ${on.join(' & ')}`
}

function shortName(p: Player | null | undefined): string | null {
  if (!p) return null
  const last = p.name.trim().split(/\s+/).pop() ?? p.name
  return `${p.jersey_number ?? ''} ${last}`.trim().toUpperCase()
}

function baseLabel(n: number): string {
  return n === 1 ? '1ST' : n === 2 ? '2ND' : '3RD'
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

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
  type EventPayload,
  type EventType,
  type LiveGame,
  type Resolution,
} from '@/lib/engine'
import type { Player, Team } from '@/lib/types'

export default function Score() {
  const { gameId } = useParams()
  const s = useScorer(gameId)
  const { game, teams, lineups, live, events, loading, error, act, undo } = s
  const [strikePopup, setStrikePopup] = useState(false)
  const [inPlay, setInPlay] = useState(false)
  const [endPopup, setEndPopup] = useState(false)
  const [simple, setSimple] = useState(() => localStorage.getItem('bpw_simple') === '1')

  const toggleSimple = () => {
    setSimple((v) => {
      localStorage.setItem('bpw_simple', v ? '0' : '1')
      return !v
    })
  }

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

  // Simple mode: one-tap HIT (single, everyone up a base) / OUT (batter out).
  const onSimpleHit = () => {
    const runners: Record<string, Dest> = {}
    if (live.bases.first) runners[live.bases.first] = 2
    if (live.bases.second) runners[live.bases.second] = 3
    if (live.bases.third) runners[live.bases.third] = 4
    act('single', { resolution: { batter: 1, runners }, rbi: live.bases.third ? 1 : 0 })
  }
  const onSimpleOut = () => act('groundout', { resolution: { batter: 0, runners: {} } })
  const onStrikeSimple = () => (live.strikes >= 2 ? act('strikeout', {}) : act('pitch_strike', {}))

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

      {/* non-playing states */}
      {notStarted && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-8 text-center">
          <p className="font-display text-2xl">Ready to start</p>
          <button onClick={() => act('game_start')} className="bg-gold px-8 py-4 font-display text-xl text-ink">
            START GAME ▸
          </button>
        </div>
      )}
      {isFinal && (
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
          <p className="font-display text-4xl text-gold">FINAL</p>
          <p className="mt-2 font-athletic uppercase tracking-[.14em] text-muted-green">
            {board.away.code} {live.awayScore} · {board.home.code} {live.homeScore}
          </p>
        </div>
      )}
      {halfOver && (
        <BetweenInnings
          live={live}
          lineups={lineups}
          gameId={gameId}
          onStartNext={() => act('inning_change')}
          onEndEarly={() => setEndPopup(true)}
        />
      )}

      {/* undo strip (during play + between innings) */}
      {!notStarted && !isFinal && (
        <div className="flex items-center justify-between border-t-2 border-ink bg-gold px-3 py-2">
          <button onClick={undo} disabled={!events.length} className="font-athletic text-[13px] font-semibold text-ink disabled:opacity-40">
            ↶ UNDO{lastLabel ? ` — ${lastLabel}` : ''}
          </button>
          <button onClick={() => setEndPopup(true)} className="font-athletic text-xs font-bold uppercase text-barn-red">
            END ▸
          </button>
        </div>
      )}

      {/* action zone */}
      {playing && (
        <>
          <button
            onClick={toggleSimple}
            className="flex items-center justify-between border-t-2 border-ink bg-gold px-3 py-1.5 text-left"
          >
            <span className="font-athletic text-[11px] font-semibold uppercase tracking-wide text-ink">
              {simple ? 'Quick scoring · stats incomplete' : 'Full scoring'}
            </span>
            <span className="font-athletic text-[11px] uppercase tracking-wide text-ink/70">
              {simple ? 'switch to full ▸' : 'switch to quick ▸'}
            </span>
          </button>
          {simple ? (
            <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-0.5 bg-ink">
              <ActionBtn className="bg-board-green text-[28px]" onClick={onBall}>BALL</ActionBtn>
              <ActionBtn className="bg-barn-red text-[28px]" onClick={onStrikeSimple}>STRIKE</ActionBtn>
              <ActionBtn className="bg-cream !text-ink text-[28px]" onClick={onSimpleHit}>HIT</ActionBtn>
              <ActionBtn className="border-2 border-gold text-[28px]" onClick={onSimpleOut}>OUT</ActionBtn>
            </div>
          ) : (
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
        </>
      )}

      {strikePopup && <StrikePopup live={live} onPick={onStrikeKind} onClose={() => setStrikePopup(false)} />}
      {endPopup && (
        <EndGamePopup
          onCancel={() => setEndPopup(false)}
          onConfirm={(reason) => {
            act('game_end', { reason })
            setEndPopup(false)
          }}
        />
      )}
      {inPlay && (
        <InPlayFlow
          batter={s.currentBatter}
          runners={s.runnersOnBase}
          onCancel={() => setInPlay(false)}
          onConfirm={(result, payload) => {
            act(result, payload)
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

/* ------------------------------------------------------- between innings */

function BetweenInnings({
  live,
  lineups,
  gameId,
  onStartNext,
  onEndEarly,
}: {
  live: LiveGame
  lineups: { away: Player[]; home: Player[] }
  gameId: string | undefined
  onStartNext: () => void
  onEndEarly: () => void
}) {
  // The team batting in the NEXT half.
  const nextTop = live.half === 'bottom'
  const nextLineup = nextTop ? lineups.away : lineups.home
  const startIdx = (nextTop ? live.awayBatterIdx : live.homeBatterIdx) % (nextLineup.length || 1)
  const due = nextLineup.length
    ? [0, 1, 2].map((i) => nextLineup[(startIdx + i) % nextLineup.length])
    : []
  const nextLabel = nextTop ? `START TOP ${ordinal(live.inning + 1)} ▸` : `START BOTTOM ${ordinal(live.inning)} ▸`

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 bg-field-green px-6 py-8 text-center">
      <StitchedBall />
      <p className="font-display text-3xl leading-tight text-cream">
        {live.half === 'top' ? 'Middle' : 'End'}
        <br />
        of the {ordinal(live.inning)}
      </p>
      <p className="font-athletic text-sm uppercase tracking-[.12em] text-muted-green">
        {/* scores shown in the scorebug above */}
        3 outs
      </p>
      {due.length > 0 && (
        <div className="w-full max-w-xs border-t border-gold/30 pt-4">
          <p className="mb-1 font-athletic text-[10px] uppercase tracking-[.16em] text-muted-green">Due up</p>
          <p className="font-data text-sm text-cream">
            {due.map((p) => `${p.jersey_number ?? ''} ${p.name.split(' ').pop()}`).join(' · ')}
          </p>
        </div>
      )}
      <div className="mt-2 flex w-full max-w-xs flex-col gap-2.5">
        <button onClick={onStartNext} className="bg-gold py-4 font-display text-lg text-ink">
          {nextLabel}
        </button>
        <Link
          to={`/lineup/${gameId}`}
          className="border-2 border-muted-green py-3 text-center font-athletic text-sm font-semibold uppercase tracking-wide text-cream"
        >
          Substitution / Lineup
        </Link>
        <button
          onClick={onEndEarly}
          className="border-2 border-barn-red py-2.5 font-athletic text-xs font-bold uppercase tracking-[.12em] text-barn-red"
        >
          End game early ▸
        </button>
      </div>
    </div>
  )
}

function StitchedBall() {
  return (
    <svg width="60" height="60" viewBox="0 0 100 100" aria-hidden>
      <circle cx="50" cy="50" r="36" fill="none" stroke="#C9A14A" strokeWidth="5" />
      <path d="M34 26 q12 24 0 48" fill="none" stroke="#A6342E" strokeWidth="4" strokeDasharray="2.5 5" strokeLinecap="round" />
      <path d="M66 26 q-12 24 0 48" fill="none" stroke="#A6342E" strokeWidth="4" strokeDasharray="2.5 5" strokeLinecap="round" />
    </svg>
  )
}

const END_REASONS = ['Time limit reached', 'Mercy rule', 'Weather / forfeit', 'Other']

function EndGamePopup({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState(END_REASONS[0])
  return (
    <Overlay onClose={onCancel}>
      <div className="w-[330px] border-[3px] border-barn-red bg-cream text-ink shadow-hard">
        <div className="flex items-center justify-between bg-barn-red px-4 py-2.5">
          <span className="font-display text-lg text-cream">End game early?</span>
          <button onClick={onCancel} className="font-athletic text-cream">✕</button>
        </div>
        <div className="flex flex-col gap-1.5 p-3">
          {END_REASONS.map((r) => {
            const sel = reason === r
            return (
              <button
                key={r}
                onClick={() => setReason(r)}
                className={`flex items-center gap-2.5 px-3 py-2.5 text-left ${sel ? 'bg-ink text-cream' : 'border border-ink/25 text-ink'}`}
              >
                <span className={`h-3.5 w-3.5 rounded-full ${sel ? 'bg-gold' : 'border-2 border-ink'}`} />
                <span className="font-athletic text-sm font-semibold uppercase tracking-wide">{r}</span>
              </button>
            )
          })}
        </div>
        <div className="flex gap-2 p-3 pt-0">
          <button onClick={onCancel} className="flex-1 border-2 border-ink/30 py-3 font-athletic font-bold uppercase tracking-wide text-muted-tan">
            Cancel
          </button>
          <button onClick={() => onConfirm(reason)} className="flex-[2] bg-barn-red py-3 font-display text-cream">
            End &amp; record final ▸
          </button>
        </div>
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

// position number -> label (scorekeeping numbering)
const POSITIONS: { n: number; label: string }[] = [
  { n: 1, label: 'P' },
  { n: 2, label: 'C' },
  { n: 3, label: '1B' },
  { n: 4, label: '2B' },
  { n: 5, label: '3B' },
  { n: 6, label: 'SS' },
  { n: 7, label: 'LF' },
  { n: 8, label: 'CF' },
  { n: 9, label: 'RF' },
]

// spray zone id -> fielding position number (who fielded it)
const ZONE_POS: Record<string, number> = {
  P: 1, C: 2, '1B': 3, '2B': 4, '3B': 5, SS: 6, LF: 7, CF: 8, RF: 9,
}

function InPlayFlow({
  batter,
  runners,
  onCancel,
  onConfirm,
}: {
  batter: Player | null
  runners: { first: Player | null; second: Player | null; third: Player | null }
  onCancel: () => void
  onConfirm: (result: EventType, payload: EventPayload) => void
}) {
  const [result, setResult] = useState<EventType>('single')
  const [location, setLocation] = useState<string | null>(null)
  const [fielders, setFielders] = useState<number[]>([])

  const onBase: OnBase[] = [
    runners.first && { key: 'first' as const, from: 1, player: runners.first },
    runners.second && { key: 'second' as const, from: 2, player: runners.second },
    runners.third && { key: 'third' as const, from: 3, player: runners.third },
  ].filter(Boolean) as OnBase[]

  // Fielder credit only matters when someone's out (or an error was made).
  const isOut = ['groundout', 'flyout', 'lineout', 'fielders_choice'].includes(result)
  const isError = result === 'error'
  const showCredit = isOut || isError
  const sprayLabel = ['single', 'double', 'triple', 'home_run'].includes(result)
    ? 'Where was it hit?'
    : 'Where did it go?'

  const pickResult = (t: EventType) => {
    setResult(t)
    if (!['groundout', 'flyout', 'lineout', 'fielders_choice', 'error'].includes(t)) {
      setFielders([])
    }
  }

  return (
    <div className="fixed inset-0 z-20 mx-auto flex max-w-[430px] flex-col bg-night-green text-cream">
      <header className="flex items-center justify-between border-b-2 border-gold bg-ink px-3 py-2.5">
        <span className="font-display text-lg text-cream">Ball in Play</span>
        <button onClick={onCancel} className="font-athletic text-sm uppercase tracking-wide text-gold">
          Cancel ✕
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {/* result */}
        <SectionLabel>Result</SectionLabel>
        <div className="mb-2 grid grid-cols-4 gap-2">
          {RESULTS.filter((r) => r.group === 'hit').map((r) => (
            <ResultBtn key={r.type} active={result === r.type} onClick={() => pickResult(r.type)} gold>
              {r.label}
            </ResultBtn>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {RESULTS.filter((r) => r.group !== 'hit').map((r) => (
            <ResultBtn key={r.type} active={result === r.type} onClick={() => pickResult(r.type)}>
              {r.label}
            </ResultBtn>
          ))}
        </div>

        {/* where did it go */}
        <SectionLabel>{sprayLabel}</SectionLabel>
        <div className="mx-auto w-full max-w-[320px] border-2 border-gold/40">
          <SprayField
            selected={location}
            onSelect={(id) => {
              setLocation(id)
              // seed the putout sequence with whoever fielded it (out/error only)
              setFielders(showCredit && ZONE_POS[id] ? [ZONE_POS[id]] : [])
            }}
          />
        </div>

        {/* who made the out / error — only when relevant */}
        {showCredit && (
          <>
            <SectionLabel>
              {isError ? 'Who made the error?' : 'Who made the out?'}
              {fielders.length ? ` · ${fielders.join('–')}` : ' · tap in order'}
            </SectionLabel>
            <FielderGrid
              sequence={fielders}
              onAppend={(n) => setFielders((s) => [...s, n])}
              onClear={() => setFielders([])}
            />
          </>
        )}

        {/* resolve each runner (re-keyed so defaults follow the result) */}
        <Resolver
          key={result}
          result={result}
          batter={batter}
          onBase={onBase}
          onResolve={(resolution, runs) =>
            onConfirm(result, {
              resolution,
              rbi: runs,
              ...(location ? { location } : {}),
              ...(fielders.length ? { fielders } : {}),
            })
          }
        />
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 mt-4 font-athletic text-[10px] font-semibold uppercase tracking-[.14em] text-gold">
      {children}
    </p>
  )
}

function FielderGrid({
  sequence,
  onAppend,
  onClear,
}: {
  sequence: number[]
  onAppend: (n: number) => void
  onClear: () => void
}) {
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {POSITIONS.map((p) => {
        const order = sequence.indexOf(p.n)
        const active = order !== -1
        return (
          <button
            key={p.n}
            onClick={() => onAppend(p.n)}
            className={`flex h-11 flex-col items-center justify-center ${active ? 'bg-gold text-ink' : 'border border-cream/30 text-cream'}`}
          >
            <span className="font-display text-sm leading-none">{p.n}</span>
            <span className="font-athletic text-[8px] uppercase">{p.label}</span>
          </button>
        )
      })}
      <button
        onClick={onClear}
        className="flex h-11 items-center justify-center border-2 border-dashed border-cream/25 font-athletic text-xs uppercase text-cream/60"
      >
        Clear
      </button>
    </div>
  )
}

function Resolver({
  result,
  batter,
  onBase,
  onResolve,
}: {
  result: EventType
  batter: Player | null
  onBase: OnBase[]
  onResolve: (resolution: Resolution, runs: number) => void
}) {
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
    onResolve(resolution, runs)
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

/* zone-tap spray field — geometry from the design spec (State 2) */
const SPRAY_WEDGES: { id: string; d: string; cx: number; cy: number }[] = [
  { id: 'LF', d: 'M150 200 L82 132 L52 80 A140 44 0 0 1 104 48 L150 64 Z', cx: 80, cy: 92 },
  { id: 'CF', d: 'M150 64 L104 48 A140 44 0 0 1 196 48 L150 64 Z', cx: 150, cy: 52 },
  { id: 'RF', d: 'M150 200 L218 132 L248 80 A140 44 0 0 0 196 48 L150 64 Z', cx: 220, cy: 92 },
]
const SPRAY_INFIELD: { id: string; x: number; y: number }[] = [
  { id: '3B', x: 100, y: 150 },
  { id: 'SS', x: 124, y: 112 },
  { id: 'P', x: 150, y: 150 },
  { id: '2B', x: 176, y: 112 },
  { id: '1B', x: 200, y: 150 },
  { id: 'C', x: 150, y: 192 },
]

function SprayField({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const wedge = SPRAY_WEDGES.find((w) => w.id === selected)
  const infield = SPRAY_INFIELD.find((z) => z.id === selected)
  const marker = wedge ? { x: wedge.cx, y: wedge.cy } : infield ? { x: infield.x, y: infield.y } : null
  return (
    <svg viewBox="0 0 300 215" className="block w-full" role="img" aria-label="Spray field">
      <rect width="300" height="215" fill="#2C5234" />
      {SPRAY_WEDGES.map((w) => (
        <path
          key={w.id}
          d={w.d}
          onClick={() => onSelect(w.id)}
          fill={selected === w.id ? 'rgba(201,161,74,.4)' : 'rgba(244,236,216,.06)'}
          stroke={selected === w.id ? '#C9A14A' : 'rgba(244,236,216,.25)'}
          strokeWidth={selected === w.id ? 2 : 1.5}
          style={{ cursor: 'pointer' }}
        />
      ))}
      {SPRAY_WEDGES.map((w) => (
        <text key={w.id + 't'} x={w.cx} y={w.cy} textAnchor="middle" fontSize="11" fontWeight="700"
          fill={selected === w.id ? '#C9A14A' : 'rgba(244,236,216,.7)'} style={{ pointerEvents: 'none', fontFamily: "'Saira Condensed',sans-serif" }}>
          {w.id}
        </text>
      ))}
      {/* diamond outline */}
      <polygon points="150,200 218,132 150,64 82,132" fill="none" stroke="#e9ddc2" strokeWidth="2" />
      {/* infield hotspots */}
      {SPRAY_INFIELD.map((z) => (
        <g key={z.id} onClick={() => onSelect(z.id)} style={{ cursor: 'pointer' }}>
          <circle cx={z.x} cy={z.y} r="14" fill={selected === z.id ? '#C9A14A' : 'rgba(26,42,74,.35)'} />
          <text x={z.x} y={z.y + 4} textAnchor="middle" fontSize="10" fontWeight="700"
            fill={selected === z.id ? '#1A2A4A' : '#F4ECD8'} style={{ pointerEvents: 'none', fontFamily: "'Saira Condensed',sans-serif" }}>
            {z.id}
          </text>
        </g>
      ))}
      {/* spray line + landing marker */}
      {marker && (
        <>
          <line x1="150" y1="198" x2={marker.x} y2={marker.y} stroke="#C9A14A" strokeWidth="2" strokeDasharray="5 4" />
          <circle cx={marker.x} cy={marker.y} r="6" fill="#F4ECD8" stroke="#C9A14A" strokeWidth="2.5" />
        </>
      )}
    </svg>
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

import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useScorer } from '@/hooks/useScorer'
import { Scorebug } from '@/components/Scorebug'
import { teamCode } from '@/lib/scoreboard'
import { EVENT_LABELS, type EventType, type LiveGame } from '@/lib/engine'
import type { Team } from '@/lib/types'

export default function Score() {
  const { gameId } = useParams()
  const { game, teams, events, live, loading, error, act, undo } = useScorer(gameId)
  const [showInPlay, setShowInPlay] = useState(false)

  if (loading) {
    return <Centered>Loading game…</Centered>
  }
  if (error && !game) {
    return <Centered>{error}</Centered>
  }

  const lastLabel = events.length ? EVENT_LABELS[events.at(-1)!.event_type] : null
  const board = toBoard(live, teams)

  const halfOver = live.outs >= 3
  const notStarted = live.status === 'scheduled'
  const isFinal = live.status === 'final'

  return (
    <div className="mx-auto flex min-h-full max-w-[430px] flex-col bg-night-green text-cream">
      {/* Header */}
      <header className="flex items-center justify-between border-b-2 border-gold bg-field-green px-3 py-2">
        <Link to="/setup" className="font-athletic text-sm uppercase tracking-wide text-gold">
          ← Setup
        </Link>
        <span className="font-athletic text-xs uppercase tracking-[.16em] text-muted-green">
          Scorer
        </span>
        <Link
          to={`/watch/${gameId}`}
          target="_blank"
          className="font-athletic text-sm uppercase tracking-wide text-gold"
        >
          Watch ↗
        </Link>
      </header>

      {/* Live state */}
      <div className="flex justify-center bg-night-green px-3 py-4">
        <Scorebug state={board} variant="dark" />
      </div>

      {error && (
        <p className="bg-barn-red/15 px-3 py-1 font-data text-xs text-barn-red">{error}</p>
      )}

      {/* Spacer / context */}
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
        {notStarted ? (
          <>
            <p className="font-display text-2xl">Ready to start</p>
            <button
              onClick={() => act('game_start')}
              className="mt-2 bg-gold px-8 py-4 font-display text-xl text-ink"
            >
              START GAME ▸
            </button>
          </>
        ) : isFinal ? (
          <p className="font-display text-3xl text-gold">FINAL</p>
        ) : halfOver ? (
          <>
            <p className="font-athletic uppercase tracking-[.16em] text-muted-green">3 outs</p>
            <p className="font-display text-2xl">
              {live.half === 'top' ? 'Middle' : 'End'} of {ordinal(live.inning)}
            </p>
            <button
              onClick={() => act('inning_change')}
              className="mt-2 bg-gold px-8 py-4 font-display text-lg text-ink"
            >
              {live.half === 'top'
                ? `START BOTTOM ${ordinal(live.inning)} ▸`
                : `START TOP ${ordinal(live.inning + 1)} ▸`}
            </button>
          </>
        ) : (
          <p className="font-athletic uppercase tracking-[.14em] text-muted-green">
            {board.away.code} batting · {live.half === 'top' ? 'top' : 'bottom'}{' '}
            {ordinal(live.inning)}
          </p>
        )}
      </div>

      {/* Undo strip */}
      {!notStarted && !isFinal && (
        <div className="flex items-center justify-between border-t-2 border-ink bg-gold px-3 py-2">
          <button
            onClick={undo}
            disabled={!events.length}
            className="font-athletic text-[13px] font-semibold text-ink disabled:opacity-40"
          >
            ↶ UNDO{lastLabel ? ` — ${lastLabel}` : ''}
          </button>
          <button
            onClick={() => {
              if (confirm('End game and record final?')) act('game_end')
            }}
            className="font-athletic text-xs font-bold uppercase text-barn-red"
          >
            END ▸
          </button>
        </div>
      )}

      {/* Action zone */}
      {!notStarted && !isFinal && !halfOver && (
        <div className="flex flex-col gap-2.5 bg-ink p-3.5">
          <div className="grid grid-cols-2 gap-2.5">
            <ActionBtn className="h-[74px] bg-board-green" onClick={() => act('pitch_ball')}>
              BALL
            </ActionBtn>
            <ActionBtn className="h-[74px] bg-barn-red" onClick={() => act('pitch_strike')}>
              STRIKE
            </ActionBtn>
          </div>
          <div className="grid grid-cols-[1fr_1fr_1.4fr] gap-2.5">
            <ActionBtn
              className="h-[58px] border-2 border-gold text-gold"
              onClick={() => act('pitch_foul')}
            >
              FOUL
            </ActionBtn>
            <ActionBtn
              className="h-[58px] border-2 border-cream text-cream"
              onClick={() => act('hit_by_pitch')}
            >
              HBP
            </ActionBtn>
            <ActionBtn
              className="h-[58px] bg-gold text-ink"
              onClick={() => setShowInPlay(true)}
            >
              IN PLAY ▸
            </ActionBtn>
          </div>
        </div>
      )}

      {showInPlay && (
        <InPlaySheet
          onPick={(t) => {
            act(t)
            setShowInPlay(false)
          }}
          onClose={() => setShowInPlay(false)}
        />
      )}
    </div>
  )
}

function InPlaySheet({
  onPick,
  onClose,
}: {
  onPick: (t: EventType) => void
  onClose: () => void
}) {
  const hits: [EventType, string][] = [
    ['single', '1B'],
    ['double', '2B'],
    ['triple', '3B'],
    ['home_run', 'HR'],
  ]
  const outs: [EventType, string][] = [
    ['groundout', 'GROUND OUT'],
    ['flyout', 'FLY OUT'],
    ['lineout', 'LINE OUT'],
    ['fielders_choice', "FIELDER'S CHOICE"],
    ['error', 'REACH ON ERROR'],
    ['walk', 'WALK'],
  ]
  return (
    <div className="fixed inset-0 z-10 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-[430px] border-t-2 border-gold bg-field-green p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="font-athletic text-sm font-semibold uppercase tracking-[.12em] text-cream">
            Ball in play — result
          </span>
          <button onClick={onClose} className="font-athletic text-cream">
            ✕
          </button>
        </div>
        <div className="mb-2 grid grid-cols-4 gap-2">
          {hits.map(([t, label]) => (
            <ActionBtn key={t} className="h-[56px] bg-gold text-ink" onClick={() => onPick(t)}>
              {label}
            </ActionBtn>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {outs.map(([t, label]) => (
            <ActionBtn
              key={t}
              className="h-[48px] border-2 border-cream text-[15px] text-cream"
              onClick={() => onPick(t)}
            >
              {label}
            </ActionBtn>
          ))}
        </div>
      </div>
    </div>
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

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center p-6 text-center font-athletic text-muted-green">
      {children}
    </div>
  )
}

function toBoard(live: LiveGame, teams: { away: Team; home: Team } | null) {
  return {
    away: { code: teamCode(teams?.away.name), name: teams?.away.name, score: live.awayScore },
    home: { code: teamCode(teams?.home.name), name: teams?.home.name, score: live.homeScore },
    inning: live.inning,
    half: live.half,
    balls: live.balls,
    strikes: live.strikes,
    outs: live.outs,
    runners: live.bases,
  }
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

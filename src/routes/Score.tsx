import { Fragment, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useScorer } from '@/hooks/useScorer'
import { ScorePanel } from '@/components/ScorePanel'
import { ShareSheet } from '@/components/ShareSheet'
import { VideoSetup } from '@/components/VideoSetup'
import { FieldDiamond, type BaseName, type Fielder } from '@/components/FieldDiamond'
import { ArrowUpRightIcon } from '@/components/Icons'
import { buildRecapSummary, generateRecap } from '@/lib/recap'
import { displayName } from '@/lib/names'
import { useBroadcastStatus } from '@/lib/phoneVideo'
import { supabase } from '@/lib/supabase'
import { resolveCode } from '@/lib/scoreboard'
import { buildPlayByPlay, computeBattingLines, computeBoxScore } from '@/lib/stats'
import {
  EVENT_LABELS,
  occupancy,
  hitPoint,
  type Dest,
  type EventPayload,
  type EventType,
  type GameEventRow,
  type HitDir,
  type HitDepth,
  type HitZone,
  type LiveGame,
  type Resolution,
} from '@/lib/engine'
import type { Player, Recap, Team } from '@/lib/types'

export default function Score() {
  const { gameId } = useParams()
  const s = useScorer(gameId)
  const { game, teams, lineups, live, events, firstPitchAt, loading, error, act, undo } = s
  const [strikePopup, setStrikePopup] = useState(false)
  const [inPlay, setInPlay] = useState(false)
  const [endPopup, setEndPopup] = useState(false)
  const [endHalf, setEndHalf] = useState(false)
  const [showSub, setShowSub] = useState(false)
  const [showPlays, setShowPlays] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const [showVideo, setShowVideo] = useState(false)
  const [editPlayer, setEditPlayer] = useState<Player | null>(null)
  const [runnerAction, setRunnerAction] = useState<{ base: BaseName; id: string } | null>(null)
  // Teams whose lineup we auto-filled from their roster at start (dismissible note).
  const [rosterNote, setRosterNote] = useState<string[] | null>(null)
  // Live health of the phone broadcast (for the indicator in the header).
  const bstatus = useBroadcastStatus(gameId, game?.video_source === 'phone_whip')
  // Scoring mode is chosen at game start and locked for the game (Full default).
  const [scoreboard, setScoreboard] = useState(
    () => localStorage.getItem(`bpw_mode_${gameId}`) === 'board',
  )
  const setMode = (sb: boolean) => {
    setScoreboard(sb)
    localStorage.setItem(`bpw_mode_${gameId}`, sb ? 'board' : 'full')
  }

  if (loading) return <Centered>Loading game…</Centered>
  if (error && !game) return <Centered>{error}</Centered>

  const lastLabel = events.length ? EVENT_LABELS[events.at(-1)!.event_type] : null
  const board = toBoard(live, teams)
  // Scoreboard mode shows a live R-H-E readout so + RUN / + HIT visibly register.
  const box = scoreboard ? computeBoxScore(events) : null
  const halfOver = live.outs >= 3
  const notStarted = live.status === 'scheduled'
  const isFinal = live.status === 'final'
  const playing = !notStarted && !isFinal && !halfOver

  const nameOf = (id: string) => shortName(s.playersById.get(id))

  // BALL on 3 balls = walk; STRIKE on 2 strikes = strikeout (keeps stats clean).
  const onBall = () => (live.balls >= 3 ? act('walk') : act('pitch_ball'))
  const onStrikeKind = (kind: string) => {
    setStrikePopup(false)
    // A foul ball is never strike three — it's a foul (stays at two strikes).
    if (kind === 'foul_tip') return void act('pitch_foul')
    if (live.strikes >= 2) act('strikeout', { kind })
    else act('pitch_strike', { kind })
  }

  // Scoreboard mode: a generic out (no batter) just bumps the out count —
  // no "grounded out" play-by-play, no spoken commentary.
  const onSimpleOut = () => act('manual_out')
  const onStrikeSimple = () => (live.strikes >= 2 ? act('strikeout', {}) : act('pitch_strike', {}))

  return (
    <div className="mx-auto flex h-[100dvh] max-w-[430px] flex-col overflow-hidden bg-night-green text-cream">
      {rosterNote && (
        <div className="flex items-center gap-2 border-b-2 border-gold bg-board-green px-3 py-2 text-cream">
          <p className="min-w-0 flex-1 font-data text-xs">
            Filled {rosterNote.join(' & ')}’s lineup from the roster.{' '}
            <Link to={`/lineup/${gameId}`} className="font-bold underline">
              Edit lineup ▸
            </Link>
          </p>
          <button
            onClick={() => setRosterNote(null)}
            className="shrink-0 font-athletic text-xs font-bold uppercase tracking-wide text-cream/70"
          >
            Dismiss
          </button>
        </div>
      )}
      <header className="flex shrink-0 items-center justify-between border-b-2 border-gold bg-ink px-3 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
        <Link to="/setup" className="font-athletic text-sm uppercase tracking-wide text-gold">
          ← Setup
        </Link>
        <div className="flex flex-col items-center leading-none">
          <span className="font-athletic text-xs uppercase tracking-[.16em] text-muted-green">Scorer</span>
          {live.status === 'live' && firstPitchAt && <GameClock startIso={firstPitchAt} />}
        </div>
        <div className="flex items-center gap-3">
          {game && game.video_source !== 'none' && (
            <button
              onClick={() => setShowVideo(true)}
              className={`inline-flex items-center gap-1.5 font-athletic text-sm font-semibold uppercase tracking-wide ${
                bstatus.down ? 'text-barn-red' : 'text-gold'
              }`}
            >
              {game.video_source === 'phone_whip' && (
                <span
                  className={`h-2 w-2 rounded-full ${
                    bstatus.live
                      ? 'animate-pulse bg-board-green'
                      : bstatus.down
                        ? 'animate-pulse bg-barn-red'
                        : 'bg-gold/40'
                  }`}
                />
              )}
              {bstatus.live ? `Live · ${bstatus.viewers}` : bstatus.down ? 'Feed down' : 'Video'}
            </button>
          )}
          <button onClick={() => setShowShare(true)} className="inline-flex items-center gap-1 font-athletic text-sm font-semibold uppercase tracking-wide text-gold">
            Share <ArrowUpRightIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* Video feed died — make it impossible to miss so the scorer can go fix the
          broadcasting phone (locked screen / lost signal are the usual culprits). */}
      {bstatus.down && (
        <button
          onClick={() => setShowVideo(true)}
          className="flex w-full shrink-0 items-center justify-between gap-2 bg-barn-red px-3 py-2 text-left"
        >
          <span className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cream" />
            <span className="font-athletic text-sm font-bold uppercase tracking-wide text-cream">
              Video feed lost
              {bstatus.secsSinceBeat != null ? ` — no signal for ${bstatus.secsSinceBeat}s` : ''}
            </span>
          </span>
          <span className="font-athletic text-xs font-semibold uppercase tracking-wide text-cream/90">
            Check phone ▸
          </span>
        </button>
      )}

      <ScorePanel state={board} />

      {error && <p className="bg-barn-red/15 px-3 py-1 font-data text-xs text-barn-red">{error}</p>}

      {/* batter / pitcher strip (full mode only) */}
      {playing && !scoreboard && <BatterPitcherStrip scorer={s} gameId={gameId} onEdit={setEditPlayer} />}

      {/* live field — grows to fill the available space (full mode only) */}
      {playing && !scoreboard && (
        <div className="flex min-h-0 flex-1 flex-col bg-board-green">
          <div className="flex flex-none items-center justify-between bg-field-green px-3 py-1.5">
            <span className="font-athletic text-[10px] uppercase tracking-[.14em] text-muted-green">
              {runnersLabel(live)}
            </span>
            <span className="font-athletic text-[10px] uppercase tracking-wide text-gold">
              tap runner ▸ steal · out
            </span>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-1">
            <FieldDiamond
              bases={live.bases}
              nameOf={nameOf}
              fielders={(live.half === 'top' ? s.lineups.home : s.lineups.away).map((p) => ({
                pos: p.position ?? p.default_position,
                name: p.name,
              }))}
              onRunnerTap={(base, id) => setRunnerAction({ base, id })}
              batterLabel={s.currentBatter ? shortName(s.currentBatter) : null}
              className="h-full max-h-full w-full max-w-[340px]"
            />
          </div>
          {/* AB pitch log */}
          <div className="flex flex-none items-center gap-1.5 bg-cream-off px-3 py-1.5">
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
        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-4 py-8 text-center">
          <p className="font-display text-2xl">Ready to start</p>
          <div>
            <p className="mb-2 font-athletic text-[11px] uppercase tracking-[.14em] text-muted-green">
              Scoring mode
            </p>
            <div className="inline-flex border-2 border-gold">
              <button
                onClick={() => setMode(false)}
                className={`px-6 py-2 font-display ${!scoreboard ? 'bg-gold text-ink' : 'text-cream'}`}
              >
                Full
              </button>
              <button
                onClick={() => setMode(true)}
                className={`px-6 py-2 font-display ${scoreboard ? 'bg-gold text-ink' : 'text-cream'}`}
              >
                Scoreboard
              </button>
            </div>
            <p className="mt-2 max-w-xs font-data text-[11px] text-muted-green">
              {scoreboard
                ? 'Scoreboard: just balls, strikes, outs, runs & hits — no field or lineup. Viewers see the score, not play-by-play.'
                : 'Full play-by-play, baserunners, stats, and commentary.'}
            </p>
          </div>
          <button
            onClick={async () => {
              // Full mode needs a batting order. For a team with a roster (yours / a
              // claimed team) start its order from that roster; a rosterless ghost
              // opponent falls back to generic "Player 1, 2…". Scoreboard needs none.
              if (!scoreboard) {
                const filled: string[] = []
                if (!s.lineups.away.length && (await s.fillLineupFromRoster('away')) === 'roster')
                  filled.push(teams?.away.name ?? 'Away')
                if (!s.lineups.home.length && (await s.fillLineupFromRoster('home')) === 'roster')
                  filled.push(teams?.home.name ?? 'Home')
                if (filled.length) setRosterNote(filled)
              }
              act('game_start')
            }}
            className="bg-gold px-8 py-4 font-display text-xl text-ink"
          >
            START GAME ▸
          </button>
          {!scoreboard && (!s.lineups.away.length || !s.lineups.home.length) && (
            <p className="max-w-xs font-data text-xs text-muted-tan">
              No lineup set? We’ll fill each team’s batting order from its roster — edit anytime from the
              Lineup screen. A brand-new opponent with no roster gets numbered placeholders you can name as
              you go.
            </p>
          )}
        </div>
      )}
      {isFinal && (
        <FinalRecap
          events={s.events}
          teams={teams}
          gameId={gameId}
          nameOf={(id) => (id ? displayName(s.playersById.get(id)?.name) : null)}
          initial={game?.recap ?? null}
          scoreLine={`${board.away.code} ${live.awayScore} · ${board.home.code} ${live.homeScore}`}
        />
      )}
      {halfOver && (
        <BetweenInnings
          live={live}
          lineups={lineups}
          gameId={gameId}
          awayCode={board.away.code}
          homeCode={board.home.code}
          onStartNext={() => act('inning_change')}
          onEndEarly={() => setEndPopup(true)}
          onSub={() => setShowSub(true)}
          onAdjust={(team, delta) => act('score_adjust', { team, delta })}
        />
      )}

      {/* undo strip (during play + between innings) */}
      {!notStarted && !isFinal && (
        <div className="flex items-center justify-between border-t-2 border-ink bg-gold px-3 py-2">
          <button onClick={undo} disabled={!events.length} className="font-athletic text-[13px] font-semibold text-ink disabled:opacity-40">
            ↶ UNDO{lastLabel ? ` — ${lastLabel}` : ''}
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowPlays(true)}
              disabled={!events.length}
              className="font-athletic text-xs font-bold uppercase text-ink disabled:opacity-40"
            >
              ✎ PLAYS
            </button>
            {!scoreboard && (
              <>
                <span className="h-4 w-px bg-ink/25" />
                <button onClick={() => setShowSub(true)} className="font-athletic text-xs font-bold uppercase text-ink">
                  ⇄ SUB
                </button>
              </>
            )}
            {playing && (
              <>
                <span className="h-4 w-px bg-ink/25" />
                <button
                  onClick={() => setEndHalf(true)}
                  className="font-athletic text-xs font-bold uppercase text-ink"
                  title="End this half-inning early (run limit reached)"
                >
                  END ½
                </button>
              </>
            )}
            <span className="h-4 w-px bg-ink/25" />
            <button onClick={() => setEndPopup(true)} className="font-athletic text-xs font-bold uppercase text-barn-red">
              END GAME
            </button>
          </div>
        </div>
      )}

      {/* action zone — mode chosen at game start */}
      {playing &&
        (scoreboard ? (
          // Scoreboard mode: no field/lineup — just the count, outs, runs and hits.
          <div className="flex min-h-0 flex-1 flex-col justify-center gap-2.5 bg-ink p-4">
            {/* inning control — advance the half directly (no lineup to step through) */}
            <div className="flex items-center justify-between border-2 border-cream/25 px-3 py-2">
              <span className="font-athletic text-sm uppercase tracking-wide text-muted-green">
                {live.half === 'top' ? 'Top' : 'Bottom'} {live.inning}
                {ordSuffix(live.inning)}
              </span>
              <button
                onClick={() => act('inning_change')}
                className="font-athletic text-sm font-bold uppercase tracking-wide text-gold"
              >
                Next half ▸
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              <ActionBtn className="h-[64px] bg-board-green text-xl" onClick={onBall}>BALL</ActionBtn>
              <ActionBtn className="h-[64px] bg-barn-red text-xl" onClick={onStrikeSimple}>STRIKE</ActionBtn>
              <ActionBtn className="h-[64px] border-2 border-gold text-xl text-gold" onClick={() => act('pitch_foul')}>FOUL</ActionBtn>
            </div>
            <ActionBtn className="h-[56px] border-2 border-cream text-xl" onClick={onSimpleOut}>OUT</ActionBtn>
            <div className="mt-1 grid grid-cols-2 gap-2.5">
              <ActionBtn className="h-[60px] bg-gold text-xl !text-ink" onClick={() => act('manual_run', { team: 'away' })}>
                + RUN {board.away.code}
              </ActionBtn>
              <ActionBtn className="h-[60px] bg-gold text-xl !text-ink" onClick={() => act('manual_run', { team: 'home' })}>
                + RUN {board.home.code}
              </ActionBtn>
              <ActionBtn className="h-[48px] border-2 border-cream/60 text-base" onClick={() => act('manual_hit', { team: 'away' })}>
                + HIT {board.away.code}
              </ActionBtn>
              <ActionBtn className="h-[48px] border-2 border-cream/60 text-base" onClick={() => act('manual_hit', { team: 'home' })}>
                + HIT {board.home.code}
              </ActionBtn>
            </div>
            {/* live R-H-E so + RUN / + HIT visibly register */}
            {box && (
              <table className="mt-1 w-full font-data text-sm text-cream">
                <thead>
                  <tr className="text-muted-green">
                    <th className="py-0.5 text-left font-athletic text-xs uppercase tracking-wide" />
                    <th className="py-0.5 text-center font-athletic text-xs uppercase tracking-wide text-gold">R</th>
                    <th className="py-0.5 text-center font-athletic text-xs uppercase tracking-wide">H</th>
                    <th className="py-0.5 text-center font-athletic text-xs uppercase tracking-wide">E</th>
                  </tr>
                </thead>
                <tbody>
                  {([['away', board.away.code, box.away], ['home', board.home.code, box.home]] as const).map(
                    ([key, code, t]) => (
                      <tr key={key} className="border-t border-cream/15">
                        <td className="py-1 text-left font-athletic uppercase tracking-wide">{code}</td>
                        <td className="py-1 text-center font-bold text-gold">{t.r}</td>
                        <td className="py-1 text-center">{t.h}</td>
                        <td className="py-1 text-center">{t.e}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            )}
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
        ))}

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
      {endHalf && (
        <ConfirmPopup
          title="End half-inning?"
          body={`Retire the ${live.half === 'top' ? 'top' : 'bottom'} of the ${live.inning}${ordSuffix(live.inning)} now (run limit reached). You'll get the between-innings screen, then start the next half.`}
          confirmLabel="End half ▸"
          onCancel={() => setEndHalf(false)}
          onConfirm={() => {
            act('end_half')
            setEndHalf(false)
          }}
        />
      )}
      {runnerAction && (
        <RunnerActionPopup
          base={runnerAction.base}
          name={shortName(s.playersById.get(runnerAction.id)) ?? 'Runner'}
          onAct={(type, payload) => {
            act(type, payload)
            setRunnerAction(null)
          }}
          runnerId={runnerAction.id}
          onClose={() => setRunnerAction(null)}
        />
      )}
      {editPlayer && (
        <PlayerEditPopup
          player={editPlayer}
          onSave={async (patch) => {
            await s.editPlayer(editPlayer.id, patch)
            setEditPlayer(null)
          }}
          onClose={() => setEditPlayer(null)}
        />
      )}
      {showSub && <SubstitutionFlow scorer={s} onClose={() => setShowSub(false)} />}
      {showPlays && <PlaysEditor scorer={s} onClose={() => setShowPlays(false)} />}
      {showShare && (
        <ShareSheet
          url={`${window.location.origin}/watch/${gameId}`}
          title={`${board.away.code} @ ${board.home.code}`}
          onClose={() => setShowShare(false)}
        />
      )}
      {showVideo && game && <VideoSetup game={game} onClose={() => setShowVideo(false)} />}
      {inPlay && (
        <InPlayFlow
          batter={s.currentBatter}
          runners={s.runnersOnBase}
          defense={(live.half === 'top' ? s.lineups.home : s.lineups.away).map((p) => ({
            pos: p.position ?? p.default_position,
            name: p.name,
          }))}
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
  onEdit,
}: {
  scorer: ReturnType<typeof useScorer>
  gameId: string | undefined
  onEdit: (p: Player) => void
}) {
  const { currentBatter, onDeck, currentPitcher, currentPitcherPitches, events, playersById } = scorer
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
  const pitches = currentPitcherPitches
  return (
    <div className="flex border-b-2 border-ink bg-cream text-ink">
      <button onClick={() => onEdit(currentBatter)} className="flex-1 border-r border-ink/20 px-3 py-2 text-left">
        <p className="flex items-center gap-1 font-athletic text-[10px] font-semibold uppercase tracking-[.14em] text-barn-red">
          At Bat <span className="text-muted-tan">· tap to edit</span>
        </p>
        <p className="font-display text-base leading-tight">
          <span className="text-barn-red">{currentBatter.jersey_number ?? '—'}</span> {currentBatter.name}
        </p>
        <p className="font-data text-[11px] text-muted-tan">
          {lineText}
          {onDeck ? ` · on deck: ${onDeck.jersey_number ? `${onDeck.jersey_number} ` : ''}${onDeck.name}` : ''}
        </p>
      </button>
      <button
        onClick={() => currentPitcher && onEdit(currentPitcher)}
        disabled={!currentPitcher}
        className="flex-1 px-3 py-2 text-left"
      >
        <p className="font-athletic text-[10px] font-semibold uppercase tracking-[.14em] text-muted-tan">
          Pitching{currentPitcher ? ' · tap to edit' : ''}
        </p>
        <p className="font-display text-base leading-tight">
          {currentPitcher ? (
            <>
              <span className="text-barn-red">{currentPitcher.jersey_number ?? '—'}</span> {currentPitcher.name}
            </>
          ) : (
            <span className="text-muted-tan">—</span>
          )}
        </p>
        {currentPitcher && <p className="font-data text-[11px] text-muted-tan">{pitches} pitches</p>}
      </button>
    </div>
  )
}

/* -------------------------------------------------------- quick player edit */

function PlayerEditPopup({
  player,
  onSave,
  onClose,
}: {
  player: Player
  onSave: (patch: { name?: string; jersey_number?: string | null }) => void
  onClose: () => void
}) {
  const [num, setNum] = useState(player.jersey_number ?? '')
  const [name, setName] = useState(player.name ?? '')
  return (
    <Overlay onClose={onClose}>
      <div className="w-[320px] border-[3px] border-ink bg-cream text-ink shadow-hard">
        <div className="flex items-center justify-between bg-ink px-4 py-2.5">
          <span className="font-display text-lg text-cream">Edit player</span>
          <button onClick={onClose} className="font-athletic text-cream">
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <label className="block">
            <span className="mb-1 block font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">
              Number
            </span>
            <input
              value={num}
              onChange={(e) => setNum(e.target.value)}
              inputMode="numeric"
              placeholder="#"
              className="w-full border-2 border-ink bg-white px-3 py-2 font-display text-lg outline-none focus:border-board-green"
            />
          </label>
          <label className="block">
            <span className="mb-1 block font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">
              Name (optional)
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Leave blank for number only"
              className="w-full border-2 border-ink bg-white px-3 py-2 font-data outline-none focus:border-board-green"
            />
          </label>
          <button
            onClick={() => onSave({ name, jersey_number: num })}
            className="bg-gold py-3 font-display text-ink"
          >
            Save ▸
          </button>
        </div>
      </div>
    </Overlay>
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
            Foul {willK ? '(stays alive)' : 'tip'}
          </button>
        </div>
        {willK && (
          <p className="px-3 pb-3 text-center font-data text-xs text-barn-red">
            Swinging or looking is strike three. A foul stays at two strikes.
          </p>
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
  awayCode,
  homeCode,
  onStartNext,
  onEndEarly,
  onSub,
  onAdjust,
}: {
  live: LiveGame
  lineups: { away: Player[]; home: Player[] }
  gameId: string | undefined
  awayCode: string
  homeCode: string
  onStartNext: () => void
  onEndEarly: () => void
  onSub: () => void
  onAdjust: (team: 'away' | 'home', delta: number) => void
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
      {/* Correct the score here if the stats fell behind the real game. Each tap is
          logged in the play feed as a "Scorer edit". */}
      <div className="w-full max-w-xs border-t border-gold/30 pt-4">
        <p className="mb-2 font-athletic text-[10px] uppercase tracking-[.16em] text-muted-green">
          Score — tap to correct
        </p>
        <div className="flex flex-col gap-2">
          {([['away', awayCode, live.awayScore], ['home', homeCode, live.homeScore]] as const).map(
            ([team, code, score]) => (
              <div key={team} className="flex items-center justify-between">
                <span className="font-display text-lg text-cream">{code}</span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => onAdjust(team, -1)}
                    disabled={score <= 0}
                    aria-label={`Subtract a run from ${code}`}
                    className="h-9 w-9 border-2 border-cream/50 font-display text-xl text-cream disabled:opacity-30"
                  >
                    −
                  </button>
                  <span className="w-8 text-center font-display text-2xl text-gold">{score}</span>
                  <button
                    onClick={() => onAdjust(team, 1)}
                    aria-label={`Add a run to ${code}`}
                    className="h-9 w-9 border-2 border-gold font-display text-xl text-gold"
                  >
                    +
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      </div>

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
        <button
          onClick={onSub}
          className="border-2 border-muted-green py-3 text-center font-athletic text-sm font-semibold uppercase tracking-wide text-cream"
        >
          Substitution / Positions
        </button>
        <Link
          to={`/lineup/${gameId}`}
          className="font-athletic text-xs uppercase tracking-wide text-muted-green underline"
        >
          Edit full lineup
        </Link>
        <button onClick={onEndEarly} className="bg-barn-red py-3.5 font-display text-base text-cream">
          End game ▸
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

function ordSuffix(n: number): string {
  const t = n % 100
  if (t >= 11 && t <= 13) return 'th'
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
}

// A running game clock — elapsed since first pitch, ticking each second.
function GameClock({ startIso }: { startIso: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const s = Math.max(0, Math.floor((now - new Date(startIso).getTime()) / 1000))
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const text =
    hh > 0
      ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
      : `${mm}:${String(ss).padStart(2, '0')}`
  return (
    <span className="font-athletic tabular text-[11px] text-gold" title="Elapsed since first pitch">
      {text}
    </span>
  )
}

function ConfirmPopup({
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string
  body: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Overlay onClose={onCancel}>
      <div className="w-[330px] border-[3px] border-ink bg-cream text-ink shadow-hard">
        <div className="flex items-center justify-between bg-ink px-4 py-2.5">
          <span className="font-display text-lg text-cream">{title}</span>
          <button onClick={onCancel} className="font-athletic text-cream">
            ✕
          </button>
        </div>
        <div className="p-4">
          <p className="font-data text-sm leading-relaxed text-muted-tan">{body}</p>
          <div className="mt-4 flex gap-2">
            <button onClick={onConfirm} className="flex-1 bg-gold py-3 font-display text-ink">
              {confirmLabel}
            </button>
            <button onClick={onCancel} className="border-2 border-ink px-4 py-3 font-display text-ink">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  )
}

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

/* ---------------------------------------------------------- substitutions */

// BENCH = still in the batting order, just not in the field this rotation.
const SUB_POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'EH', 'BENCH']
// The nine fielding spots are one-per-lineup; DH/EH/BENCH may repeat.
const UNIQUE_SUB_POSITIONS = new Set(['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'])

function SubstitutionFlow({
  scorer,
  onClose,
}: {
  scorer: ReturnType<typeof useScorer>
  onClose: () => void
}) {
  const { teams, lineups, bench, live, act } = scorer
  // Default to the team about to take the field: mid-inning that's the current
  // fielding team; between innings (3 outs) it's the team fielding next half.
  const fielding = live.half === 'top' ? 'home' : 'away'
  const defaultTeam: 'away' | 'home' =
    live.outs >= 3 ? (fielding === 'home' ? 'away' : 'home') : fielding
  const [team, setTeam] = useState<'away' | 'home'>(defaultTeam)
  const lineup = lineups[team]
  const benchList = bench[team]
  const benchById = new Map(benchList.map((p) => [p.id, p]))

  // pos: each slot's (original player id) -> position. repl: slot -> bench player in.
  const [pos, setPos] = useState<Record<string, string>>({})
  const [repl, setRepl] = useState<Record<string, string>>({})
  const [pickFor, setPickFor] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)

  useEffect(() => {
    const init: Record<string, string> = {}
    for (const p of lineup) init[p.id] = p.position ?? p.default_position ?? ''
    setPos(init)
    setRepl({})
    setPickFor(null)
    // re-init when the team changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team])

  const teamName = (k: 'away' | 'home') => (k === 'away' ? teams?.away.name : teams?.home.name) ?? k
  const usedBench = new Set(Object.values(repl))
  const avail = benchList.filter((p) => !usedBench.has(p.id))

  const dirty =
    Object.keys(repl).length > 0 ||
    lineup.some((p) => (pos[p.id] ?? '') !== (p.position ?? p.default_position ?? ''))

  const confirm = () => {
    const moves: { out_id?: string; in_id: string; position?: string }[] = []
    for (const p of lineup) {
      const benchId = repl[p.id]
      const original = p.position ?? p.default_position ?? ''
      if (benchId) moves.push({ out_id: p.id, in_id: benchId, position: pos[p.id] || undefined })
      else if ((pos[p.id] ?? '') !== original) moves.push({ in_id: p.id, position: pos[p.id] || undefined })
    }
    if (!moves.length) return
    act('substitution', { team, moves })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-20 mx-auto flex max-w-[430px] flex-col bg-night-green text-cream">
      <header className="flex items-center justify-between border-b-2 border-gold bg-ink px-3 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))]">
        <span className="font-display text-lg text-cream">Substitution</span>
        <button onClick={onClose} className="font-athletic text-sm uppercase tracking-wide text-gold">
          Cancel ✕
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-3 inline-flex border-2 border-gold">
          {(['away', 'home'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTeam(k)}
              className={`px-4 py-1.5 font-display text-sm ${team === k ? 'bg-gold text-ink' : 'text-cream'}`}
            >
              {teamName(k)}
            </button>
          ))}
        </div>
        <p className="mb-2 font-data text-xs text-muted-green">
          Tap a name to edit its number/name. Change a position with the dropdown, or tap{' '}
          <b>Replace</b> to bring in a bench player.
        </p>
        <button
          onClick={() => setPos(Object.fromEntries(lineup.map((p) => [p.id, ''])))}
          className="mb-3 border-2 border-cream/30 px-3 py-1.5 font-athletic text-xs font-semibold uppercase tracking-wide text-cream"
        >
          Clear all positions
        </button>

        <div className="flex flex-col border-2 border-cream/20">
          {lineup.map((p, i) => {
            const benchId = repl[p.id]
            const shown = benchId ? benchById.get(benchId) : p
            // Fielding positions already held by OTHER players in this lineup.
            const takenElsewhere = new Set(
              lineup.filter((o) => o.id !== p.id).map((o) => pos[o.id]).filter(Boolean),
            )
            return (
              <div key={p.id} className={`${i > 0 ? 'border-t border-cream/12' : ''}`}>
                <div className="flex items-center gap-2 px-2 py-2">
                  <span className="w-4 text-right font-athletic text-xs text-muted-green">{i + 1}</span>
                  <span className="w-6 text-right font-athletic text-base font-bold text-barn-red">
                    {shown?.jersey_number ?? '—'}
                  </span>
                  <button
                    onClick={() => shown && setEditId(shown.id)}
                    className="flex-1 truncate text-left font-data text-sm underline decoration-cream/30"
                  >
                    {shown?.name || `#${shown?.jersey_number ?? '—'}`}
                    {benchId && <span className="ml-1 font-athletic text-[9px] uppercase text-gold">in</span>}
                  </button>
                  <select
                    value={pos[p.id] ?? ''}
                    onChange={(e) => setPos((m) => ({ ...m, [p.id]: e.target.value }))}
                    className="appearance-none rounded-none border border-cream/30 bg-night-green px-1 py-1 font-athletic text-xs text-cream"
                  >
                    <option value="">—</option>
                    {SUB_POSITIONS.map((x) => {
                      const taken = UNIQUE_SUB_POSITIONS.has(x) && takenElsewhere.has(x)
                      return (
                        <option key={x} value={x} disabled={taken}>
                          {x}
                          {taken ? ' • taken' : ''}
                        </option>
                      )
                    })}
                  </select>
                  {benchId ? (
                    <button
                      onClick={() => setRepl((m) => { const n = { ...m }; delete n[p.id]; return n })}
                      className="px-1.5 font-athletic text-xs text-barn-red"
                    >
                      ↶
                    </button>
                  ) : (
                    <button
                      onClick={() => setPickFor(pickFor === p.id ? null : p.id)}
                      className="px-1.5 font-athletic text-[11px] uppercase text-gold"
                    >
                      Replace
                    </button>
                  )}
                </div>
                {pickFor === p.id && (
                  <div className="bg-field-green px-2 py-2">
                    {avail.length === 0 ? (
                      <p className="font-data text-xs text-muted-green">No bench players left.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {avail.map((b) => (
                          <button
                            key={b.id}
                            onClick={() => {
                              setRepl((m) => ({ ...m, [p.id]: b.id }))
                              setPickFor(null)
                            }}
                            className="border border-cream/30 px-2 py-1 font-data text-xs"
                          >
                            <b className="text-barn-red">{b.jersey_number ?? '—'}</b> {b.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="border-t-2 border-ink bg-ink p-3.5">
        <button
          onClick={confirm}
          disabled={!dirty}
          className="w-full bg-gold py-3 font-display text-lg text-ink disabled:opacity-40"
        >
          Confirm Sub ▸
        </button>
      </div>

      {editId && scorer.playersById.get(editId) && (
        <PlayerEditPopup
          player={scorer.playersById.get(editId)!}
          onSave={async (patch) => {
            await scorer.editPlayer(editId, patch)
            setEditId(null)
          }}
          onClose={() => setEditId(null)}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------- plays editor */

// Edit/undo ANY past play, not just the last. Lists the play-by-play; deleting a
// play removes that event and re-projects the game from the remaining log.
function PlaysEditor({ scorer, onClose }: { scorer: ReturnType<typeof useScorer>; onClose: () => void }) {
  const { events, playersById, deleteEvent } = scorer
  const plays = buildPlayByPlay(events, (id) => (id ? (playersById.get(id)?.name ?? null) : null))
  const half = (h: string) => (h === 'top' ? 'T' : 'B')
  return (
    <div className="fixed inset-0 z-20 mx-auto flex max-w-[430px] flex-col bg-night-green text-cream">
      <header className="flex items-center justify-between border-b-2 border-gold bg-ink px-3 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))]">
        <span className="font-display text-lg text-cream">Edit Plays</span>
        <button onClick={onClose} className="font-athletic text-sm uppercase tracking-wide text-gold">
          Done
        </button>
      </header>
      <p className="px-3 py-2 font-data text-xs text-muted-green">
        Tap ✕ to remove a play (corrects a mistake found later). The game re-computes
        from what’s left. To change a play, delete it and re-score it.
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {plays.length === 0 ? (
          <p className="px-3 py-4 font-data text-sm text-muted-green">No plays yet.</p>
        ) : (
          <ul className="flex flex-col">
            {plays.map((p) => (
              <li key={p.seq} className="flex items-center gap-3 border-b border-cream/10 px-3 py-2.5">
                <span className="w-8 shrink-0 font-athletic text-[11px] uppercase text-muted-green">
                  {half(p.half)}
                  {p.inning}
                </span>
                <span className="flex-1 font-data text-sm">{p.text}</span>
                <button
                  onClick={() => {
                    if (window.confirm(`Delete this play?\n\n${p.text}`)) deleteEvent(p.seq)
                  }}
                  title="Delete play"
                  className="shrink-0 px-2 font-athletic text-base font-bold text-barn-red"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/* --------------------------------------------------------- runner actions */

function RunnerActionPopup({
  base,
  name,
  runnerId,
  onAct,
  onClose,
}: {
  base: BaseName
  name: string
  runnerId: string
  onAct: (type: EventType, payload: EventPayload) => void
  onClose: () => void
}) {
  const from = base === 'first' ? 1 : base === 'second' ? 2 : 3
  const next = (from + 1) as Dest
  const lbl = (d: number) => (d === 2 ? '2nd' : d === 3 ? '3rd' : 'home')

  const options: { label: string; type: EventType; payload: EventPayload; danger?: boolean }[] = []
  if (from < 3) {
    options.push({ label: `Steal ${lbl(next)}`, type: 'stolen_base', payload: { runner: runnerId, to: next } })
    options.push({ label: `Advance to ${lbl(next)}`, type: 'runner_advance', payload: { runner: runnerId, to: next } })
  } else {
    options.push({ label: 'Score', type: 'runner_advance', payload: { runner: runnerId, to: 4 } })
    options.push({ label: 'Steal home', type: 'stolen_base', payload: { runner: runnerId, to: 4 } })
  }
  options.push({ label: 'Caught stealing', type: 'caught_stealing', payload: { runner: runnerId }, danger: true })
  options.push({ label: 'Picked off', type: 'picked_off', payload: { runner: runnerId }, danger: true })

  return (
    <Overlay onClose={onClose}>
      <div className="w-[300px] border-[3px] border-gold bg-cream text-ink shadow-hard">
        <div className="flex items-center justify-between bg-ink px-4 py-2.5">
          <span className="font-display text-base text-cream">{name}</span>
          <button onClick={onClose} className="font-athletic text-cream">✕</button>
        </div>
        <div className="flex flex-col gap-2 p-3">
          {options.map((o) => (
            <button
              key={o.label}
              onClick={() => onAct(o.type, o.payload)}
              className={`py-3 font-display ${o.danger ? 'border-2 border-barn-red text-barn-red' : 'bg-board-green text-cream'}`}
            >
              {o.label}
            </button>
          ))}
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

function InPlayFlow({
  batter,
  runners,
  defense,
  onCancel,
  onConfirm,
}: {
  batter: Player | null
  runners: { first: Player | null; second: Player | null; third: Player | null }
  defense: Fielder[]
  onCancel: () => void
  onConfirm: (result: EventType, payload: EventPayload) => void
}) {
  // No outcome chosen yet — the batter-first grid is the whole first screen.
  const [result, setResult] = useState<EventType | null>(null)
  const [zone, setZone] = useState<HitZone | null>(null)
  const [fielders, setFielders] = useState<number[]>([])
  const [extraOuts, setExtraOuts] = useState(0) // 0 = normal, 1 = double play, 2 = triple play

  const onBase: OnBase[] = [
    runners.first && { key: 'first' as const, from: 1, player: runners.first },
    runners.second && { key: 'second' as const, from: 2, player: runners.second },
    runners.third && { key: 'third' as const, from: 3, player: runners.third },
  ].filter(Boolean) as OnBase[]

  const isOut = !!result && ['groundout', 'flyout', 'lineout', 'fielders_choice'].includes(result)
  const isError = result === 'error'
  const isCleanHit = !!result && ['single', 'double', 'triple'].includes(result)
  const showCredit = isOut || isError
  // A clean hit with the bases empty needs no runner resolution → the zone tap commits.
  const autoHit = isCleanHit && onBase.length === 0

  const baseIds = {
    first: runners.first?.id ?? null,
    second: runners.second?.id ?? null,
    third: runners.third?.id ?? null,
  }
  const runnerName = (id: string) => {
    for (const r of [runners.first, runners.second, runners.third])
      if (r && r.id === id) return (r.name.split(' ').pop() ?? r.name).toUpperCase()
    return null
  }

  // Pick an outcome. A home run is unambiguous — everyone scores — so it commits
  // immediately (no further taps).
  const pickResult = (t: EventType) => {
    if (t === 'home_run') {
      onConfirm('home_run', {
        resolution: { batter: 4, runners: Object.fromEntries(onBase.map((r) => [r.player.id, 4 as Dest])) },
        rbi: onBase.length + 1,
        advances: onBase.map((r) => ({ id: r.player.id, from: r.from, to: 4 as Dest })),
      })
      return
    }
    setResult(t)
    setZone(null)
    setExtraOuts(0)
    setFielders([])
  }

  // Chosen a hit location. For a bases-empty clean hit this IS the commit; otherwise it
  // just records the zone and the runner resolver (below) commits.
  const onZone = (z: HitZone | null) => {
    setZone(z)
    if (autoHit && result) {
      onConfirm(result, {
        resolution: { batter: BATTER_DEST[result] ?? 1, runners: {} },
        rbi: 0,
        advances: [],
        ...(z ? { hit: z } : {}),
      })
    }
  }

  const isOutResult = !!result && ['groundout', 'lineout', 'flyout'].includes(result)
  const maxExtraOuts = isOutResult ? Math.min(onBase.length, 2) : 0
  const chosenLabel = result ? (RESULTS.find((r) => r.type === result)?.label ?? '') : ''

  return (
    <div className="fixed inset-0 z-20 mx-auto flex max-w-[430px] flex-col bg-night-green text-cream">
      <header className="flex items-center justify-between border-b-2 border-gold bg-ink px-3 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))]">
        <span className="font-display text-lg text-cream">Ball in play</span>
        <button onClick={onCancel} className="font-athletic text-sm uppercase tracking-wide text-gold">
          Cancel ✕
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {result === null ? (
          /* Step 1 — batter-first outcome grid. */
          <>
            <SectionLabel>What happened?</SectionLabel>
            <div className="mb-2 grid grid-cols-4 gap-2">
              {RESULTS.filter((r) => r.group === 'hit').map((r) => (
                <ResultBtn key={r.type} active={false} onClick={() => pickResult(r.type)} gold>
                  {r.label}
                </ResultBtn>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {RESULTS.filter((r) => r.group !== 'hit').map((r) => (
                <ResultBtn key={r.type} active={false} onClick={() => pickResult(r.type)}>
                  {r.label}
                </ResultBtn>
              ))}
            </div>
          </>
        ) : (
          /* Step 2 — resolve the chosen outcome. */
          <>
            <div className="mb-3 flex items-center justify-between">
              <span className="bg-gold px-3 py-1 font-display text-ink">{chosenLabel}</span>
              <button
                onClick={() => setResult(null)}
                className="font-athletic text-xs font-bold uppercase tracking-wide text-gold"
              >
                ‹ Change
              </button>
            </div>

            {/* Double / triple play — pre-marks the lead forced runners out. */}
            {maxExtraOuts > 0 && (
              <div className="mb-1 flex gap-2">
                <button
                  onClick={() => setExtraOuts((v) => (v === 1 ? 0 : 1))}
                  className={`flex-1 border-2 py-2.5 font-display text-sm ${
                    extraOuts === 1 ? 'border-barn-red bg-barn-red text-cream' : 'border-cream/30 text-cream'
                  }`}
                >
                  {extraOuts === 1 ? 'DOUBLE PLAY ✓' : 'DOUBLE PLAY'}
                </button>
                {maxExtraOuts >= 2 && (
                  <button
                    onClick={() => setExtraOuts((v) => (v === 2 ? 0 : 2))}
                    className={`flex-1 border-2 py-2.5 font-display text-sm ${
                      extraOuts === 2 ? 'border-barn-red bg-barn-red text-cream' : 'border-cream/30 text-cream'
                    }`}
                  >
                    {extraOuts === 2 ? 'TRIPLE PLAY ✓' : 'TRIPLE PLAY'}
                  </button>
                )}
              </div>
            )}

            {/* Who made the out / error — position keypad (fielder-based, not a field tap). */}
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

            {/* Where did it go — a labeled direction × depth zone (a menu, not a field
                tap), feeding the spray chart. Required to commit a bases-empty hit;
                optional enrichment otherwise. */}
            <SectionLabel>{autoHit ? 'Where did it go? · tap to record' : 'Where did it go? · optional'}</SectionLabel>
            <ZoneGrid selected={zone} onPick={onZone} />
            {autoHit && (
              <button
                onClick={() => onZone(null)}
                className="mt-2 w-full border-2 border-cream/30 py-2 font-athletic text-xs font-semibold uppercase tracking-wide text-cream/70"
              >
                Commit — location not sure
              </button>
            )}

            {/* Display-only field: shows the runners + a preview of the picked zone. */}
            <div className="mx-auto mt-3 w-full max-w-[280px] border-2 border-gold/40">
              <FieldDiamond
                bases={baseIds}
                nameOf={runnerName}
                fielders={defense}
                batterLabel={batter ? (batter.name.split(' ').pop() ?? batter.name).toUpperCase() : null}
                marker={zone ? hitPoint(zone) : null}
                className="block w-full"
              />
            </div>

            {/* Runner resolution + commit — for everything except a bases-empty clean hit. */}
            {!autoHit && (
              <Resolver
                key={`${result}:${extraOuts}`}
                result={result}
                batter={batter}
                onBase={onBase}
                extraOuts={extraOuts}
                locked={false}
                hideBatter={['groundout', 'flyout', 'lineout'].includes(result)}
                onResolve={(resolution, runs, advances) =>
                  onConfirm(result, {
                    resolution,
                    rbi: runs,
                    advances,
                    ...(zone ? { hit: zone } : {}),
                    ...(fielders.length ? { fielders } : {}),
                  })
                }
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

const ZONE_ROWS: { depth: HitDepth; label: string }[] = [
  { depth: 'deep', label: 'Deep' },
  { depth: 'shallow', label: 'Shallow' },
  { depth: 'IF', label: 'Infield' },
]
const ZONE_DIRS: { dir: HitDir; label: string }[] = [
  { dir: 'L', label: 'Left' },
  { dir: 'C', label: 'Center' },
  { dir: 'R', label: 'Right' },
]
// A labeled direction × depth grid — categorical menu selection, not a tap on a field
// diagram. One tap captures both axes; it maps to an approximate point for the spray chart.
function ZoneGrid({ selected, onPick }: { selected: HitZone | null; onPick: (z: HitZone) => void }) {
  return (
    <div className="grid grid-cols-[3.4rem_1fr_1fr_1fr] gap-1.5">
      <span />
      {ZONE_DIRS.map((d) => (
        <span key={d.dir} className="text-center font-athletic text-[10px] font-semibold uppercase text-muted-green">
          {d.label}
        </span>
      ))}
      {ZONE_ROWS.map((r) => (
        <Fragment key={r.depth}>
          <span className="self-center font-athletic text-[10px] font-semibold uppercase text-muted-green">
            {r.label}
          </span>
          {ZONE_DIRS.map((d) => {
            const on = selected?.dir === d.dir && selected?.depth === r.depth
            return (
              <button
                key={d.dir}
                onClick={() => onPick({ dir: d.dir, depth: r.depth })}
                className={`flex h-10 items-center justify-center border-2 ${
                  on ? 'border-gold bg-gold text-ink' : 'border-cream/25 text-cream/40'
                }`}
              >
                {on ? '●' : ''}
              </button>
            )
          })}
        </Fragment>
      ))}
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
  hideBatter = false,
  extraOuts = 0,
  locked = false,
  onResolve,
}: {
  result: EventType
  batter: Player | null
  onBase: OnBase[]
  hideBatter?: boolean
  extraOuts?: number
  locked?: boolean
  onResolve: (resolution: Resolution, runs: number, advances: { id: string; from: number; to: Dest }[]) => void
}) {
  const adv = RUNNER_ADVANCE[result]
  const initial: Record<string, Dest> = {}
  initial['batter'] = BATTER_DEST[result] ?? 0
  for (const r of onBase) {
    initial[r.player.id] = (adv ? Math.min(r.from + adv, 4) : r.from) as Dest
  }
  if (extraOuts > 0) {
    // Double/triple play: mark the lead forced runners out, starting at first
    // (the classic 6-4-3 / around-the-horn). Scorer can still correct below.
    const ordered = [1, 2, 3]
      .map((b) => onBase.find((r) => r.from === b))
      .filter((r): r is OnBase => !!r)
    ordered.slice(0, extraOuts).forEach((r) => (initial[r.player.id] = 0))
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
    const advances = onBase.map((r) => ({ id: r.player.id, from: r.from, to: (dest[r.player.id] ?? r.from) as Dest }))
    onResolve(resolution, runs, advances)
  }

  // Home run: everyone scores, full stop — no destinations to edit.
  if (locked) {
    return (
      <div className="mt-4 border-t-2 border-gold/30 pt-3">
        <p className="mb-2 font-athletic text-[10px] font-semibold uppercase tracking-[.14em] text-muted-green">
          Home run — everyone scores
        </p>
        <div className="flex flex-col gap-2">
          {!hideBatter && <ScoredRow label="BATTER" name={batter?.name ?? 'Batter'} />}
          {onBase.map((r) => (
            <ScoredRow key={r.player.id} label={`ON ${baseLabel(r.from)}`} name={r.player.name} />
          ))}
        </div>
        <div className="mt-4 flex items-center gap-4">
          <span className="font-athletic text-xs uppercase tracking-wide text-muted-green">
            RBI <b className="font-display text-cream">{onBase.length + (hideBatter ? 0 : 1)}</b>
          </span>
          <button onClick={confirm} className="ml-auto flex-1 bg-board-green py-3 font-display text-cream">
            CONFIRM PLAY ▸
          </button>
        </div>
      </div>
    )
  }

  const nothingToResolve = hideBatter && onBase.length === 0
  return (
    <div className="mt-4 border-t-2 border-gold/30 pt-3">
      <p className="mb-2 font-athletic text-[10px] font-semibold uppercase tracking-[.14em] text-muted-green">
        {nothingToResolve
          ? 'Batter is out'
          : hideBatter
            ? 'Where did each runner end up?'
            : 'Where did the batter & runners end up?'}
      </p>
      <div className="flex flex-col gap-3">
        {!hideBatter &&
          // For a clean hit the batter's base IS the hit type — lock it so type and
          // base can't diverge (want the batter on 2nd? pick Double). Runners below
          // stay editable. Errors / fielder's choice keep the editable ladder.
          (['single', 'double', 'triple'].includes(result) ? (
            <LockedDestRow
              label="BATTER"
              name={batter?.name ?? 'Batter'}
              destLabel={DESTS.find((x) => x.d === (dest['batter'] ?? 1))?.label ?? ''}
            />
          ) : (
            <Ladder label="BATTER" name={batter?.name ?? 'Batter'} value={dest['batter'] ?? 0} onPick={(d) => set('batter', d)} />
          ))}
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


// A locked destination row — the base is fixed (e.g. a hit's batter), not tappable.
function LockedDestRow({ label, name, destLabel }: { label: string; name: string; destLabel: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="bg-gold px-1.5 py-0.5 font-athletic text-[10px] font-bold uppercase text-ink">{label}</span>
      <span className="font-display text-sm text-cream">{name}</span>
      <span className="ml-auto bg-board-green px-2 py-0.5 font-athletic text-[10px] font-bold uppercase text-cream">
        {destLabel}
      </span>
    </div>
  )
}

// A non-editable runner row (home run: everyone scored).
function ScoredRow({ label, name }: { label: string; name: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="bg-gold px-1.5 py-0.5 font-athletic text-[10px] font-bold uppercase text-ink">{label}</span>
      <span className="font-display text-sm text-cream">{name}</span>
      <span className="ml-auto bg-board-green px-2 py-0.5 font-athletic text-[10px] font-bold uppercase text-cream">
        Scored
      </span>
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

/* ----------------------------------------------------------- final recap */

function FinalRecap({
  events,
  teams,
  gameId,
  nameOf,
  initial,
  scoreLine,
}: {
  events: GameEventRow[]
  teams: { away: Team; home: Team } | null
  gameId: string | undefined
  nameOf: (id: string | null | undefined) => string | null
  initial: Recap | null
  scoreLine: string
}) {
  const [recap, setRecap] = useState<Recap | null>(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const tried = useRef(false)

  async function generate() {
    if (!teams || !gameId) return
    setBusy(true)
    setErr(null)
    try {
      // Build the recap from the SAVED event log, not the in-memory copy — the
      // latter can be missing plays if the local state ever drifted, which is how
      // a 6-0 game got recapped as a 0-0 tie. The DB is the source of truth.
      const { data: rows } = await supabase
        .from('game_events')
        .select('seq,event_type,payload,batter_id')
        .eq('game_id', gameId)
        .order('seq')
      const log = (rows as GameEventRow[] | null)?.length ? (rows as GameEventRow[]) : events
      const summary = buildRecapSummary(log, teams, nameOf)
      const r = await generateRecap(summary)
      const withTs: Recap = { ...r, generated_at: new Date().toISOString() }
      const { error } = await supabase.from('games').update({ recap: withTs }).eq('id', gameId)
      if (error) throw new Error(error.message)
      setRecap(withTs)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Recap failed.')
    } finally {
      setBusy(false)
    }
  }

  // Auto-write the recap the moment the game ends (once). The scorer can still
  // regenerate, and viewers pick it up from games.recap.
  useEffect(() => {
    if (!recap && !tried.current && teams) {
      tried.current = true
      generate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams])

  return (
    <div className="flex flex-1 flex-col items-center overflow-y-auto px-4 py-8 text-center">
      <p className="font-display text-4xl text-gold">FINAL</p>
      <p className="mt-2 font-athletic uppercase tracking-[.14em] text-muted-green">{scoreLine}</p>

      {recap ? (
        <div className="mt-6 w-full max-w-md border-2 border-gold bg-black/20 p-4 text-left">
          <p className="font-display text-xl leading-tight text-gold">{recap.headline}</p>
          <p className="mt-2 whitespace-pre-line font-data text-sm leading-relaxed text-cream">
            {recap.body}
          </p>
          <button
            onClick={generate}
            disabled={busy}
            className="mt-3 font-athletic text-xs uppercase tracking-wide text-muted-green underline disabled:opacity-60"
          >
            {busy ? 'Rewriting…' : 'Regenerate'}
          </button>
        </div>
      ) : err ? (
        <div className="mt-6 text-center">
          <p className="font-data text-sm text-barn-red">{err}</p>
          <button onClick={generate} className="mt-2 bg-gold px-6 py-2 font-display text-ink">
            Try again
          </button>
        </div>
      ) : (
        <p className="mt-6 font-athletic text-sm uppercase tracking-[.14em] text-muted-green">
          Writing the game recap…
        </p>
      )}
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

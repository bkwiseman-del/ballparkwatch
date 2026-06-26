import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { ScorePanel } from '@/components/ScorePanel'
import { ScorebugBar } from '@/components/Scorebug'
import { FieldDiamond, FIELDER_POS, POS_BY_NUM, type SprayViz } from '@/components/FieldDiamond'
import { HeaderWordmark } from '@/components/Logo'
import { resolveCode, type ScoreboardState } from '@/lib/scoreboard'
import { INITIAL_LIVE, occupancy, type GameEventRow, type LiveGame } from '@/lib/engine'
import {
  buildPlayByPlay,
  computeBattingLines,
  computeBoxScore,
  formatAvg,
  type BattingLine,
  type BoxScore,
  type PlayKind,
} from '@/lib/stats'
import { currentPitcherEntrySeq, extractSubs, pitchesSince, projectSlots } from '@/lib/lineup'
import { gameChannelName } from '@/lib/realtime'
import { parseYouTubeId } from '@/lib/youtube'
import { YouTubeEmbed } from '@/components/VideoEmbed'
import { PhoneVideo } from '@/components/PhoneVideo'
import { Bunting } from '@/components/Bunting'
import { SoundOnIcon, SoundOffIcon } from '@/components/Icons'
import { audio, fxForEvent } from '@/lib/audio'
import type { Recap } from '@/lib/types'

type PublicGame = {
  id: string
  status: 'scheduled' | 'live' | 'final'
  video_source: string
  video_config?: Record<string, unknown>
  stat_delay_ms?: number
  recap?: Recap | null
  away: { name: string; code: string | null }
  home: { name: string; code: string | null }
  snapshot: Partial<LiveGame>
  lineups?: { away: LineupSlot[]; home: LineupSlot[] }
  players?: Record<string, { name: string; jersey: string | null }>
}

type LineupSlot = { id?: string; name: string; jersey: string | null; pos: string | null }
// A lineup slot after substitutions are projected.
type LiveSlot = { id: string; name: string; jersey: string | null; pos: string | null }
type LiveLineups = { away: LiveSlot[]; home: LiveSlot[] }

// Build the animated spray for a play. Hits carry a free landing point captured
// on the same field geometry the viewer uses, so it's drawn as-is. Outs use the
// fielder putout sequence (contact = first fielder, throws = the rest).
function buildViz(payload: ViewerEvent['payload'], seq: number): SprayViz | null {
  if (!payload) return null
  const pts = (Array.isArray(payload.fielders) ? payload.fielders : [])
    .map((n) => FIELDER_POS[POS_BY_NUM[n]])
    .filter((p): p is { x: number; y: number } => !!p)
  // Tapped contact point + throw sequence: ball goes to where it was hit, then
  // the throws (skip the first fielder since that's ~where it was fielded).
  if (payload.spray && pts.length) return { contact: payload.spray, throws: pts.slice(1), nonce: seq }
  if (payload.spray) return { contact: payload.spray, nonce: seq }
  if (pts.length) return { contact: pts[0], throws: pts.slice(1), nonce: seq }
  return null
}

type ViewerEvent = GameEventRow & { batter_name: string | null }

type Tab = 'field' | 'plays' | 'box' | 'stats'

// True on desktop-width screens (≥1024px), where we use the two-column layout.
function useIsDesktop() {
  const [d, setD] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const fn = () => setD(mq.matches)
    fn()
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return d
}

export default function Watch() {
  const { gameId } = useParams()
  const [info, setInfo] = useState<PublicGame | null>(null)
  const [live, setLive] = useState<LiveGame>(INITIAL_LIVE)
  const [events, setEvents] = useState<ViewerEvent[]>([])
  const [tab, setTab] = useState<Tab>('field')
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<SprayViz | null>(null)
  const [showStandby, setShowStandby] = useState(false)
  const [soundOn, setSoundOn] = useState(false)
  const isDesktop = useIsDesktop()
  const loadingEvents = useRef(false)
  const prevMaxSeq = useRef<number | null>(null)
  const flashTimer = useRef<number | undefined>(undefined)
  // Hold live updates back by stat_delay_ms so the scorebug matches what the
  // viewer is actually seeing on the (delayed) video, instead of spoiling it.
  const delayRef = useRef(0)
  const delayTimers = useRef<number[]>([])

  const loadEvents = useCallback(async () => {
    if (!gameId || loadingEvents.current) return
    loadingEvents.current = true
    const { data, error } = await supabase.rpc('get_public_events', { p_game_id: gameId })
    loadingEvents.current = false
    if (!error && data) setEvents(data as ViewerEvent[])
  }, [gameId])

  // Refresh game info (lineups, status, video) — picks up substitutions/realignment.
  // When there's no stat delay, also reconcile the live score from the snapshot
  // (the authoritative, upsert-on-every-event projection) so a missed broadcast
  // self-heals. Delayed games skip this so we don't bypass the delay buffer.
  const loadGame = useCallback(async () => {
    if (!gameId) return
    const { data } = await supabase.rpc('get_public_game', { p_game_id: gameId })
    if (!data) return
    const g = data as PublicGame
    setInfo(g)
    if ((g.stat_delay_ms ?? 0) === 0 && g.snapshot) {
      setLive({ ...INITIAL_LIVE, ...g.snapshot })
    }
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
      const apply = () => {
        setLive({ ...INITIAL_LIVE, ...(payload as LiveGame) })
        loadEvents() // refresh plays/box when the operator scores
        loadGame() // refresh lineups/status (catches subs)
      }
      const d = delayRef.current
      if (d > 0) {
        const id = window.setTimeout(apply, d)
        delayTimers.current.push(id)
      } else {
        apply()
      }
    }).subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(ch)
      delayTimers.current.forEach((id) => window.clearTimeout(id))
      delayTimers.current = []
    }
  }, [gameId, loadEvents, loadGame])

  // Keep the live delay in sync with the game's configured stat_delay_ms.
  useEffect(() => {
    delayRef.current = info?.stat_delay_ms ?? 0
  }, [info?.stat_delay_ms])

  // Poll game info so status (scheduled → live → final), the video link, and
  // lineup changes reach an already-open viewer even before any play is scored.
  // The live score itself rides the instant (delayed) broadcast path.
  useEffect(() => {
    if (!gameId) return
    const tick = () => {
      loadGame()
      // No delay → also catch up the plays/box feed if a broadcast was missed.
      if (delayRef.current === 0) loadEvents()
    }
    const id = window.setInterval(tick, 10000)
    return () => window.clearInterval(id)
  }, [gameId, loadGame, loadEvents])

  // Briefly animate the spray when a *new* located play arrives (not on load).
  useEffect(() => {
    if (events.length === 0) return
    const maxSeq = Math.max(...events.map((e) => e.seq))
    if (prevMaxSeq.current === null) {
      prevMaxSeq.current = maxSeq // baseline the first load — don't replay history
      return
    }
    if (maxSeq > prevMaxSeq.current) {
      const baseline = prevMaxSeq.current
      prevMaxSeq.current = maxSeq
      const freshAll = events.filter((e) => e.seq > baseline).sort((a, b) => a.seq - b.seq)

      // spray animation (located plays only)
      const located = freshAll.filter((e) => e.payload?.spray || e.payload?.fielders)
      const last = located[located.length - 1]
      if (last) {
        const viz = buildViz(last.payload, last.seq)
        if (viz) {
          setFlash(viz)
          window.clearTimeout(flashTimer.current)
          flashTimer.current = window.setTimeout(() => setFlash(null), 4500)
        }
      }

      // sound fx + voice commentary for the newest action
      const newest = freshAll[freshAll.length - 1]
      if (audio.isEnabled() && newest) {
        const fx = fxForEvent(newest.event_type)
        if (fx) audio.playFx(fx)
        if (['single', 'double', 'triple', 'home_run'].includes(newest.event_type)) audio.swellCrowd()

        // Commentary only for real plays (not pitches), generated once + cached.
        const nameOf = (id: string | null | undefined) =>
          (id && info?.players?.[id]?.name) || null
        const line = buildPlayByPlay(events, nameOf).find((p) => p.seq === newest.seq)
        if (line && gameId) {
          supabase.functions
            .invoke('commentary', { body: { gameId, seq: newest.seq, text: line.text } })
            .then(({ data }) => {
              if (data?.url) audio.playCommentary(data.url)
            })
            .catch(() => {})
        }
      }
    }
  }, [events, gameId, info])

  // When a half ends (3 outs), show the final play for a beat before the standby.
  const halfEnded = live.status === 'live' && (live.outs ?? 0) >= 3
  useEffect(() => {
    if (!halfEnded) {
      setShowStandby(false)
      return
    }
    const t = window.setTimeout(() => setShowStandby(true), 5000)
    return () => window.clearTimeout(t)
  }, [halfEnded])

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
  const between = live.status === 'live' && (live.outs ?? 0) >= 3

  // Project the current lineups (starters + substitutions) for both teams.
  const subs = extractSubs(events)
  const resolveTeam = (key: 'away' | 'home'): LiveSlot[] => {
    const initial = (info!.lineups?.[key] ?? [])
      .filter((s): s is LineupSlot & { id: string } => !!s.id)
      .map((s) => ({ playerId: s.id, position: s.pos }))
    return projectSlots(initial, subs, key).map((s) => {
      const pl = info!.players?.[s.playerId]
      return { id: s.playerId, name: pl?.name ?? '—', jersey: pl?.jersey ?? null, pos: s.position }
    })
  }
  const lineups: LiveLineups = { away: resolveTeam('away'), home: resolveTeam('home') }

  // External-camera games stream to YouTube; embed it if we have a usable link.
  const ytId =
    info.video_source === 'youtube'
      ? parseYouTubeId(String(info.video_config?.youtube_url ?? ''))
      : null

  // Live video block: the feed with the scorebug bar BELOW it (so it never sits
  // over the player's controls), the phone feed, or the scoreboard if no video.
  const videoBlock = ytId ? (
    <div>
      <YouTubeEmbed videoId={ytId} title={`${board.away.code} @ ${board.home.code}`} />
      <ScorebugBar state={board} />
    </div>
  ) : info.video_source === 'phone_whip' ? (
    <PhoneVideo gameId={gameId} board={board} />
  ) : (
    <ScorePanel state={board} />
  )

  return (
    <div className="mx-auto flex min-h-full w-full max-w-lg flex-col bg-night-green text-cream min-[760px]:max-w-3xl lg:max-w-6xl">
      {/* branded header */}
      <header className="flex items-center justify-between border-b-2 border-gold bg-ink px-3 py-2.5 min-[760px]:px-5">
        <HeaderWordmark />
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (soundOn) {
                audio.disable()
                setSoundOn(false)
              } else {
                audio.enable()
                setSoundOn(true)
              }
            }}
            aria-label={soundOn ? 'Mute sound' : 'Turn on sound'}
            className="text-gold"
          >
            {soundOn ? <SoundOnIcon className="h-5 w-5" /> : <SoundOffIcon className="h-5 w-5" />}
          </button>
          {live.status === 'live' ? (
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-barn-red" />
              <span className="font-athletic text-sm font-semibold tracking-[.18em] text-barn-red">LIVE</span>
            </span>
          ) : (
            <span className="font-athletic text-sm tracking-[.18em] text-muted-green">
              {live.status === 'final' ? 'FINAL' : 'STARTING SOON'}
            </span>
          )}
        </div>
      </header>

      {live.status === 'final' ? (
        <FinalView board={board} events={events} recap={info.recap ?? null} />
      ) : isDesktop ? (
        /* Desktop: left = video + bug + Plays/Box/Stats; right = the live field. */
        <div className="flex flex-1 items-stretch">
          <div className="flex w-[58%] flex-col border-r-2 border-gold">
            {videoBlock}
            <DataTabs board={board} events={events} />
          </div>
          <div className="flex flex-1 flex-col">
            {live.status === 'live' && !between && (
              <BatterPitcherStrip lineups={lineups} live={live} events={events} />
            )}
            <div className="flex-1 p-6">
              {between && showStandby ? (
                <Standby lineups={lineups} live={live} away={board.away} home={board.home} />
              ) : (
                <FieldTab lineups={lineups} live={live} events={events} spray={flash} />
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Phone: single column, all four tabs. */
        <>
          {videoBlock}

          {live.status === 'live' && !between && (
            <BatterPitcherStrip lineups={lineups} live={live} events={events} />
          )}

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

          <div className="flex-1 p-4 min-[760px]:p-6">
            {tab === 'field' &&
              (between && showStandby ? (
                <Standby lineups={lineups} live={live} away={board.away} home={board.home} />
              ) : (
                <FieldTab lineups={lineups} live={live} events={events} spray={flash} />
              ))}
            {tab === 'plays' && <PlaysTab events={events} />}
            {tab === 'box' && <BoxTab board={board} events={events} />}
            {tab === 'stats' && <StatsTab board={board} events={events} />}
          </div>
        </>
      )}
    </div>
  )
}

// Post-game screen: FINAL hero, the AI recap, and tabs into the box/stats/plays.
function FinalView({
  board,
  events,
  recap,
}: {
  board: ScoreboardState
  events: ViewerEvent[]
  recap: Recap | null
}) {
  const [tab, setTab] = useState<'recap' | 'box' | 'stats' | 'plays'>('recap')
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
      {/* stars-and-stripes bunting (design spec: top of the Final screen) */}
      <Bunting />

      {/* FINAL hero */}
      <div className="border-b-2 border-gold bg-[#122019] px-4 pb-6 pt-5 text-center">
        <p className="font-display text-2xl tracking-[.3em] text-barn-red">FINAL</p>
        <div className="mt-3 flex items-center justify-center gap-4 font-display text-3xl min-[760px]:text-4xl">
          <span className="text-cream">
            {board.away.code} {board.away.score}
          </span>
          <span className="text-muted-green">—</span>
          <span className="text-gold">
            {board.home.code} {board.home.score}
          </span>
        </div>
        {(board.away.name || board.home.name) && (
          <p className="mt-1.5 font-data text-xs text-muted-green">
            {board.away.name} at {board.home.name}
          </p>
        )}
      </div>

      {/* sub-tabs */}
      <div className="flex border-b-2 border-gold bg-[#122019]">
        {(['recap', 'box', 'stats', 'plays'] as const).map((t) => (
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

      <div className="flex-1 p-4 min-[760px]:p-6">
        {tab === 'recap' && <RecapFinal recap={recap} events={events} board={board} />}
        {tab === 'box' && <BoxTab board={board} events={events} />}
        {tab === 'stats' && <StatsTab board={board} events={events} />}
        {tab === 'plays' && <PlaysTab events={events} />}
      </div>
    </div>
  )
}

function RecapFinal({
  recap,
  events,
  board,
}: {
  recap: Recap | null
  events: ViewerEvent[]
  board: ScoreboardState
}) {
  const box = computeBoxScore(events)
  return (
    <div className="mx-auto max-w-xl">
      {recap ? (
        <div className="border-2 border-gold bg-black/20 p-4 min-[760px]:p-5">
          <p className="font-display text-2xl leading-tight text-gold">{recap.headline}</p>
          <p className="mt-3 whitespace-pre-line font-data text-sm leading-relaxed text-cream/90">
            {recap.body}
          </p>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2 border-2 border-dashed border-gold/40 p-6 text-center font-athletic text-sm uppercase tracking-[.14em] text-muted-green">
          <span className="h-2 w-2 animate-pulse rounded-full bg-gold" />
          Writing the game recap…
        </div>
      )}
      <LineScore box={box} awayCode={board.away.code} homeCode={board.home.code} />
    </div>
  )
}

function LineScore({ box, awayCode, homeCode }: { box: BoxScore; awayCode: string; homeCode: string }) {
  const innings = Math.max(
    box.innings,
    box.away.runsByInning.length,
    box.home.runsByInning.length,
    1,
  )
  const cols = Array.from({ length: innings }, (_, i) => i + 1)
  const rows: { code: string; b: BoxScore['away']; accent?: boolean }[] = [
    { code: awayCode, b: box.away },
    { code: homeCode, b: box.home, accent: true },
  ]
  return (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full border-2 border-gold text-center font-data text-sm tabular">
        <thead>
          <tr className="bg-[#122019] text-[11px] uppercase tracking-wide text-muted-green">
            <th className="px-2 py-1.5 text-left" />
            {cols.map((c) => (
              <th key={c} className="px-2 py-1.5">
                {c}
              </th>
            ))}
            <th className="px-2 py-1.5 text-gold">R</th>
            <th className="px-2 py-1.5">H</th>
            <th className="px-2 py-1.5">E</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code} className="border-t border-gold/20">
              <td className="px-2 py-1.5 text-left font-athletic font-bold">{r.code}</td>
              {cols.map((c) => (
                <td key={c} className="px-2 py-1.5 text-cream/90">
                  {r.b.runsByInning[c - 1] ?? ''}
                </td>
              ))}
              <td className={`px-2 py-1.5 font-bold ${r.accent ? 'text-gold' : 'text-cream'}`}>{r.b.r}</td>
              <td className="px-2 py-1.5 text-cream/80">{r.b.h}</td>
              <td className="px-2 py-1.5 text-cream/80">{r.b.e}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Desktop left-column data tabs (Plays / Box / Stats). Field lives on the right.
function DataTabs({ board, events }: { board: ScoreboardState; events: ViewerEvent[] }) {
  const [tab, setTab] = useState<'plays' | 'box' | 'stats'>('plays')
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex border-y-2 border-gold bg-[#122019]">
        {(['plays', 'box', 'stats'] as const).map((t) => (
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
      <div className="flex-1 p-6">
        {tab === 'plays' && <PlaysTab events={events} />}
        {tab === 'box' && <BoxTab board={board} events={events} />}
        {tab === 'stats' && <StatsTab board={board} events={events} />}
      </div>
    </div>
  )
}

function BatterPitcherStrip({
  lineups,
  live,
  events,
}: {
  lineups: LiveLineups
  live: LiveGame
  events: ViewerEvent[]
}) {
  const battingKey = live.half === 'top' ? 'away' : 'home'
  const fieldingKey = live.half === 'top' ? 'home' : 'away'
  const order = lineups[battingKey]
  const idx = battingKey === 'away' ? live.awayBatterIdx : live.homeBatterIdx
  const batter = order.length ? order[idx % order.length] : null
  const onDeck = order.length ? order[(idx + 1) % order.length] : null
  const pitcher = lineups[fieldingKey].find((p) => p.pos === 'P') ?? null
  const pitches = pitchesSince(events, fieldingKey, currentPitcherEntrySeq(events, fieldingKey))
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

function Standby({
  lineups,
  live,
  away,
  home,
}: {
  lineups: LiveLineups
  live: LiveGame
  away: { code: string }
  home: { code: string }
}) {
  const nextTop = live.half === 'bottom'
  const order = lineups[nextTop ? 'away' : 'home']
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
        {away.code} {live.awayScore} · {home.code} {live.homeScore}
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

function FieldTab({
  lineups,
  live,
  events,
  spray,
}: {
  lineups: LiveLineups
  live: LiveGame
  events: ViewerEvent[]
  spray?: SprayViz | null
}) {
  const map = nameMap(events)
  const plays = buildPlayByPlay(events, (id) => (id ? map.get(id) ?? null : null))
  const latest = plays[0]

  // last name for runner chips
  const runnerName = (id: string) => {
    const n = map.get(id)
    return n ? (n.trim().split(/\s+/).pop() ?? n) : null
  }

  // defense + current batter from the projected lineups
  const fieldingKey = live.half === 'top' ? 'home' : 'away'
  const battingKey = live.half === 'top' ? 'away' : 'home'
  const fielders = lineups[fieldingKey].map((p) => ({ pos: p.pos, name: p.name }))
  const order = lineups[battingKey]
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
          spray={spray}
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

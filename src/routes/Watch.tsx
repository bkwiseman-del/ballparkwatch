import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { ScorePanel } from '@/components/ScorePanel'
import { ScorebugBar } from '@/components/Scorebug'
import { FieldDiamond, FIELDER_POS, POS_BY_NUM, type SprayViz } from '@/components/FieldDiamond'
import { HeaderWordmark } from '@/components/Logo'
import { resolveCode, type ScoreboardState } from '@/lib/scoreboard'
import { INITIAL_LIVE, occupancy, project, sprayFor, type GameEventRow, type LiveGame } from '@/lib/engine'
import {
  buildPlayByPlay,
  computeBattingLines,
  computeBoxScore,
  computePitchingLines,
  formatIp,
  type BattingLine,
  type BoxScore,
  type PitchingLine,
  type PlayKind,
  type StartPositions,
} from '@/lib/stats'
import { currentPitcherEntrySeq, extractSubs, pitchesSince, projectSlots } from '@/lib/lineup'
import { gameChannelName } from '@/lib/realtime'
import { parseYouTubeId } from '@/lib/youtube'
import { useBroadcastStatus } from '@/lib/phoneVideo'
import { attachHls, isHlsUrl } from '@/lib/hls'
import { YouTubeEmbed } from '@/components/VideoEmbed'
import { PhoneVideo } from '@/components/PhoneVideo'
import { Bunting } from '@/components/Bunting'
import { ShareSheet } from '@/components/ShareSheet'
import { SoundOnIcon, SoundOffIcon, ArrowUpRightIcon } from '@/components/Icons'
import { audio } from '@/lib/audio'
import { displayName } from '@/lib/names'
import { freshCues, fxCues } from '@/lib/commentary'
import type { Recap } from '@/lib/types'

type PublicGame = {
  id: string
  status: 'scheduled' | 'live' | 'final'
  video_source: string
  video_config?: Record<string, unknown>
  stat_delay_ms?: number
  scheduled_at?: string | null
  location?: string | null
  recap?: Recap | null
  away: { name: string; code: string | null }
  home: { name: string; code: string | null }
  snapshot: Partial<LiveGame>
  lineups?: { away: LineupSlot[]; home: LineupSlot[] }
  players?: Record<string, { name: string; jersey: string | null }>
  recording_path?: string | null
  recording_started_at?: string | null
  recording_mime?: string | null
  recording_duration_ms?: number | null
  recording_segments?: string[] | null
  cf_whep_url?: string | null
  cf_hls_url?: string | null
  cf_recording_uid?: string | null
  cf_customer_code?: string | null
  sponsors?: { name: string | null; image: string; url: string | null }[]
}

type LineupSlot = { id?: string; name: string; jersey: string | null; pos: string | null }
// A lineup slot after substitutions are projected.
type LiveSlot = { id: string; name: string; jersey: string | null; pos: string | null }
type LiveLineups = { away: LiveSlot[]; home: LiveSlot[] }

// Build the animated spray for a play. The contact point comes from the categorical
// hit zone (reconstructed via hitPoint) or a legacy tapped point; outs use the fielder
// putout sequence (contact = first fielder, throws = the rest).
function buildViz(payload: ViewerEvent['payload'], seq: number): SprayViz | null {
  if (!payload) return null
  const pts = (Array.isArray(payload.fielders) ? payload.fielders : [])
    .map((n) => FIELDER_POS[POS_BY_NUM[n]])
    .filter((p): p is { x: number; y: number } => !!p)
  // Fielded play: draw the ball to the EXACT fielder who made the play (home → fielder →
  // any throws), so the line connects to the player the scorer tapped — not a coarse zone.
  if (pts.length) return { contact: pts[0], throws: pts.slice(1), nonce: seq }
  // Clean hit (no fielder): use the categorical hit location.
  const contact = sprayFor(payload)
  if (contact) return { contact, nonce: seq }
  return null
}

type ViewerEvent = GameEventRow & {
  batter_name: string | null
  created_at?: string
  wall_clock_ts?: string
}

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
  const navigate = useNavigate()
  const location = useLocation()
  // Only show an in-app Back button when we arrived here by navigating within the app
  // (e.g. a family member tapping a replay in the PWA). A fresh load from a shared link
  // has key 'default' — those viewers get no back button (there's nowhere to go). Fixes
  // the PWA getting trapped on /watch with no way back to the dashboard.
  const canGoBack = location.key !== 'default'
  const [info, setInfo] = useState<PublicGame | null>(null)
  const [live, setLive] = useState<LiveGame>(INITIAL_LIVE)
  const [events, setEvents] = useState<ViewerEvent[]>([])
  const [tab, setTab] = useState<Tab>('field')
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<SprayViz | null>(null)
  const [showStandby, setShowStandby] = useState(false)
  const [showShare, setShowShare] = useState(false)
  // Commentary on by default so it plays the moment the game starts. Audio still
  // needs a user gesture to unlock (browser autoplay policy) — see the effect below.
  const [soundOn, setSoundOn] = useState(true)
  const [audioReady, setAudioReady] = useState(false) // true once the AudioContext is unlocked
  const isDesktop = useIsDesktop()
  const eventsReq = useRef(0)
  const lastApply = useRef(0)
  const prevMaxSeq = useRef<number | null>(null)
  const flashTimer = useRef<number | undefined>(undefined)
  // Hold live updates back by stat_delay_ms so the scorebug matches what the
  // viewer is actually seeing on the (delayed) video, instead of spoiling it.
  const delayRef = useRef(0)
  const delayTimers = useRef<number[]>([])

  // Latest-response-wins, so a slow request can't leave the event list stale.
  const loadEvents = useCallback(async () => {
    if (!gameId) return
    const my = ++eventsReq.current
    const { data, error } = await supabase.rpc('get_public_events', { p_game_id: gameId })
    if (my !== eventsReq.current) return // superseded by a newer load
    if (!error && data) {
      const rows = data as ViewerEvent[]
      // Baseline the play/audio trigger on the FIRST load — to the max seq present
      // (0 if none yet). Otherwise, when a viewer is sitting on Starting Soon with
      // no events, game_start (the first event to arrive) would be treated as the
      // baseline and skipped, so the organ/welcome never fire.
      if (prevMaxSeq.current === null)
        prevMaxSeq.current = rows.length ? Math.max(...rows.map((e) => e.seq)) : 0
      setEvents(rows)
    }
  }, [gameId])

  // Refresh game info (lineups, status, video) — picks up substitutions/realignment.
  const loadGame = useCallback(async () => {
    if (!gameId) return
    const { data } = await supabase.rpc('get_public_game', { p_game_id: gameId })
    if (data) setInfo(data as PublicGame)
  }, [gameId])

  useEffect(() => {
    if (!gameId) return
    let cancelled = false

    supabase.rpc('get_public_game', { p_game_id: gameId }).then(({ data, error }) => {
      if (cancelled) return
      if (error) return setError(error.message)
      if (!data) return setError('Game not found')
      setInfo(data as PublicGame)
    })
    loadEvents()

    // The broadcast payload IS the scorer's exact live state — use it directly so
    // the viewer's scorebug can never diverge from the scorer. (Delayed for video
    // games.) We also reload events for the plays/box/commentary.
    const ch = supabase.channel(gameChannelName(gameId))
    ch.on('broadcast', { event: 'state' }, ({ payload }) => {
      const apply = () => {
        setLive({ ...INITIAL_LIVE, ...(payload as LiveGame) })
        lastApply.current = Date.now()
        loadEvents()
        loadGame()
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

  // Seed and self-heal the scorebug from the EVENT LOG — the immutable source of
  // truth — so the scorebug and the spoken score (also projected from events) can
  // never disagree. The cached game_state snapshot can lag the log when a scorer's
  // persist drops a write, so we don't trust it for the bug. The realtime broadcast
  // (the scorer's own projection) drives instant updates; this covers first load
  // and a scorer whose broadcasts go briefly quiet.
  useEffect(() => {
    if (!events.length) return
    if (lastApply.current === 0 || Date.now() - lastApply.current > 12000) {
      setLive(project(events))
    }
  }, [events])

  // Keep the live delay in sync with the game's configured stat_delay_ms.
  useEffect(() => {
    delayRef.current = info?.stat_delay_ms ?? 0
  }, [info?.stat_delay_ms])

  // Is there live video? (YouTube link set, or a phone broadcast in progress.)
  const phoneStatus = useBroadcastStatus(gameId, info?.video_source === 'phone_whip')
  const hasVideo =
    (info?.video_source === 'youtube' &&
      !!parseYouTubeId(String(info?.video_config?.youtube_url ?? ''))) ||
    (info?.video_source === 'phone_whip' && phoneStatus.live)

  // Commentary is on by default, but the browser won't let audio play until the
  // viewer interacts. Unlock the AudioContext on the first tap anywhere so the
  // organ + welcome fire as soon as the game starts.
  useEffect(() => {
    if (!soundOn) return
    if (audio.isEnabled()) {
      setAudioReady(true) // already unlocked (e.g. remount) — don't wait for a tap
      return
    }
    const unlock = async () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('touchend', unlock)
      await audio.enable()
      setAudioReady(true)
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('touchend', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('touchend', unlock)
    }
  }, [soundOn])

  // Match the page (and the desktop side margins + iOS safe-area strips) to the
  // screen being shown: navy for the Starting Soon cover and the Final screen,
  // night-green for the live scoreboard.
  useEffect(() => {
    document.body.style.backgroundColor = live.status === 'live' ? '#15281b' : '#1A2A4A'
    return () => {
      document.body.style.backgroundColor = ''
    }
  }, [live.status])

  // Crowd ambience plays whenever there's no ACTIVE video audio. The video block
  // only renders during a live game, so pre-game (Starting Soon) and the final
  // screen always get the crowd bed — otherwise tapping "Tap for sound" on the
  // cover of a video game would play nothing. Depends on audioReady so the loop
  // starts the moment the context unlocks.
  const videoActive = live.status === 'live' && hasVideo
  useEffect(() => {
    // Crowd bed during pre-game (Starting Soon) and the live game, but NOT on the
    // final summary — once the game's over the ambience shouldn't keep droning on
    // revisits. The end-of-game commentary is a queued voice line, not the crowd
    // loop, so silencing the bed here doesn't affect it.
    audio.setCrowd(soundOn && audioReady && !videoActive && live.status !== 'final')
  }, [soundOn, videoActive, audioReady, live.status])

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
  // prevMaxSeq is baselined in loadEvents on first load, so the first real events
  // after that (incl. game_start from a pre-game viewer) fire here.
  useEffect(() => {
    if (prevMaxSeq.current === null) return // initial load hasn't baselined yet
    const maxSeq = events.length ? Math.max(...events.map((e) => e.seq)) : 0
    if (maxSeq > prevMaxSeq.current) {
      const baseline = prevMaxSeq.current
      prevMaxSeq.current = maxSeq
      const freshAll = events.filter((e) => e.seq > baseline).sort((a, b) => a.seq - b.seq)

      // spray animation (located plays only). `hit` is the categorical zone used by the
      // redesigned in-play flow (clean hits); spray/fielders cover legacy + fielded plays.
      const located = freshAll.filter((e) => e.payload?.hit || e.payload?.spray || e.payload?.fielders)
      const last = located[located.length - 1]
      if (last) {
        const viz = buildViz(last.payload, last.seq)
        if (viz) {
          setFlash(viz)
          window.clearTimeout(flashTimer.current)
          flashTimer.current = window.setTimeout(() => setFlash(null), 4500)
        }
      }

      // GameChanger-style audio. Sound FX fire immediately, synced to the play
      // (pitch → crack + cheer); the play-by-play voice — batter up, the count,
      // the play, the situation, inning recaps — is generated (cached) and
      // queued so lines don't overlap. Only when commentary is on.
      const newest = freshAll[freshAll.length - 1]
      if (audio.isEnabled() && newest) {
        audio.playFx(fxCues(newest.event_type))
        if (['single', 'double', 'triple', 'home_run', 'manual_run'].includes(newest.event_type))
          audio.swellCrowd()
        // Inning-intro stinger ahead of the commentary: the SHORT organ every half
        // (the long charge riff is too long to hold up the start of an inning — it
        // now plays ducked under the between-innings recap instead).
        if (freshAll.some((e) => e.event_type === 'inning_change' || e.event_type === 'game_start')) {
          audio.enqueueOrgan()
        }

        if (gameId) {
          // Commentary is public too — speak first name + last initial only.
          // Play descriptions use the last name ("Cook singles"); the batter intro
          // ("now batting") uses the FULL name + number, so pass full names here.
          const nameOf = (id: string | null | undefined) =>
            id && info?.players?.[id]?.name ? displayName(info.players[id].name) : null
          const lns = {
            away: (info?.lineups?.away ?? []).map((s) => ({ name: s.name, jersey: s.jersey })),
            home: (info?.lineups?.home ?? []).map((s) => ({ name: s.name, jersey: s.jersey })),
          }
          const teamNames = {
            away: info?.away?.name ?? 'Away',
            home: info?.home?.name ?? 'Home',
          }
          const cues = freshCues(events, baseline, nameOf, lns, teamNames)
          ;(async () => {
            for (const c of cues) {
              try {
                const { data } = await supabase.functions.invoke('commentary', {
                  body: { gameId, seq: c.key, text: c.text, kind: c.kind },
                })
                if (data?.url) audio.enqueueVoice(data.url, c.kind === 'summary')
              } catch {
                /* skip this line */
              }
            }
          })()
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

  // Build the replay URL. Single-file recordings play directly; a chunked recording
  // (recording_segments) is fetched part-by-part and concatenated back into the
  // original file (contiguous byte-slices), then played as one blob — so the ReplayView
  // and its scorebug sync are unchanged.
  const [replayUrl, setReplayUrl] = useState<string | null>(null)
  const recStarted = info?.recording_started_at ?? null
  const recPath = info?.recording_path ?? null
  const recMime = info?.recording_mime ?? null
  const recSegKey = (info?.recording_segments ?? []).join('|')
  useEffect(() => {
    if (!recStarted) return setReplayUrl(null)
    const segs = recSegKey ? recSegKey.split('|') : []
    if (segs.length) {
      let cancelled = false
      let objUrl: string | null = null
      ;(async () => {
        try {
          const blobs: Blob[] = []
          for (const p of segs) {
            const u = supabase.storage.from('bpw-video').getPublicUrl(p).data.publicUrl
            const r = await fetch(u)
            if (!r.ok) throw new Error('part fetch failed')
            blobs.push(await r.blob())
          }
          if (cancelled) return
          objUrl = URL.createObjectURL(new Blob(blobs, { type: recMime ?? 'video/webm' }))
          setReplayUrl(objUrl)
        } catch {
          if (!cancelled) setReplayUrl(null)
        }
      })()
      return () => {
        cancelled = true
        if (objUrl) URL.revokeObjectURL(objUrl)
      }
    }
    setReplayUrl(recPath ? supabase.storage.from('bpw-video').getPublicUrl(recPath).data.publicUrl : null)
  }, [recStarted, recPath, recMime, recSegKey])

  // If the game is final and was a Stream broadcast but the recording id isn't stored
  // yet (broadcaster ended early / closed before the VOD was ready), resolve it OURSELVES
  // from Cloudflare — the replay must show what was recorded, no matter how it ended.
  const [resolvedRecUid, setResolvedRecUid] = useState<string | null>(null)
  useEffect(() => {
    if (info?.status !== 'final' || !info?.cf_customer_code || info?.cf_recording_uid || resolvedRecUid) return
    let cancelled = false
    let tries = 0
    const attempt = async () => {
      if (cancelled) return
      tries++
      try {
        const { data } = await supabase.functions.invoke('stream-live', {
          body: { gameId, action: 'finalize' },
        })
        if (!cancelled && data?.recordingUid) return setResolvedRecUid(data.recordingUid as string)
      } catch {
        /* retry */
      }
      if (!cancelled && tries < 12) setTimeout(attempt, 15000)
    }
    void attempt()
    return () => {
      cancelled = true
    }
  }, [info?.status, info?.cf_customer_code, info?.cf_recording_uid, resolvedRecUid, gameId])

  // Prefer Cloudflare Stream's server-side auto-recording (upright, ABR, HLS); the local
  // upload is the backup.
  const recUid = info?.cf_recording_uid ?? resolvedRecUid
  const streamVod =
    recUid && info?.cf_customer_code
      ? `https://${info.cf_customer_code}.cloudflarestream.com/${recUid}/manifest/video.m3u8`
      : null

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

  // Replay of the recorded broadcast (shown on the Final screen) whenever a recording
  // exists — the Stream VOD (preferred) or the local upload. The time anchor comes from
  // recording_started_at; if that's missing (older/early-ended broadcast) we fall back to
  // the game_start timestamp so the replay still plays (sync just approximate).
  const replayVideoUrl = streamVod ?? replayUrl ?? null
  const gameStartMs = (() => {
    const gs = events.find((e) => e.event_type === 'game_start')
    return gs?.wall_clock_ts ? new Date(gs.wall_clock_ts).getTime() : 0
  })()
  const replay: ReplayProps | null =
    replayVideoUrl
      ? {
          url: replayVideoUrl,
          startedAtMs: info.recording_started_at ? new Date(info.recording_started_at).getTime() : gameStartMs,
          gameId: info.id,
          events,
          lineups: {
            away: (info.lineups?.away ?? []).map((s) => ({ name: s.name, jersey: s.jersey })),
            home: (info.lineups?.home ?? []).map((s) => ({ name: s.name, jersey: s.jersey })),
          },
          teams: {
            away: { name: info.away.name, code: board.away.code },
            home: { name: info.home.name, code: board.home.code },
          },
          cueNameOf: (id) => (id && info?.players?.[id]?.name ? displayName(info.players[id].name) : null),
          // Enough to re-render the LIVE field + batter/pitcher, projected to the video's
          // position, so the replay mirrors what viewers saw.
          lineupsRaw: { away: info.lineups?.away ?? [], home: info.lineups?.home ?? [] },
          players: info.players ?? {},
        }
      : null

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
      // Last name when present; fall back to the jersey for a number-only player.
      const nm = displayName(pl?.name) || (pl?.jersey ? `#${pl.jersey}` : '—')
      return { id: s.playerId, name: nm, jersey: pl?.jersey ?? null, pos: s.position }
    })
  }
  const lineups: LiveLineups = { away: resolveTeam('away'), home: resolveTeam('home') }

  // Player name resolver (last name, jersey fallback) + starting positions, for
  // the box score / pitching tables.
  const nameById = (id: string): string => {
    const pl = info?.players?.[id]
    return displayName(pl?.name) || (pl?.jersey ? `#${pl.jersey}` : '—')
  }
  const startPositions: StartPositions = {
    away: Object.fromEntries((info?.lineups?.away ?? []).filter((s) => s.id).map((s) => [s.id!, s.pos])),
    home: Object.fromEntries((info?.lineups?.home ?? []).filter((s) => s.id).map((s) => [s.id!, s.pos])),
  }
  // Scoreboard-mode games have no lineup (full games always do — generic if needed),
  // so there are no baserunners/players: skip the field, just show the line score.
  const isScoreboard =
    live.status !== 'scheduled' && !(info.lineups?.away?.length || info.lineups?.home?.length)

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
    <PhoneVideo
      gameId={gameId}
      board={board}
      live={phoneStatus.live}
      whepUrl={info.cf_whep_url}
      hlsUrl={info.cf_hls_url}
    />
  ) : (
    <ScorePanel state={board} />
  )

  return (
    <div
      className="mx-auto flex min-h-full w-full max-w-lg flex-col text-cream min-[760px]:max-w-3xl lg:max-w-6xl"
      // --surface is the page color (green live / navy final); data cells use it so
      // they match the screen instead of being hard-coded green.
      style={
        {
          backgroundColor: live.status === 'live' ? '#15281b' : '#1A2A4A',
          '--surface': live.status === 'live' ? '#15281b' : '#1A2A4A',
        } as CSSProperties
      }
    >
      {/* branded header */}
      <header className="flex items-center justify-between border-b-2 border-gold bg-ink px-3 py-2.5 min-[760px]:px-5">
        <div className="flex items-center gap-3">
          {canGoBack && (
            <button
              onClick={() => navigate(-1)}
              aria-label="Back"
              className="font-athletic text-sm font-semibold uppercase tracking-wide text-gold"
            >
              ‹ Back
            </button>
          )}
          <HeaderWordmark />
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowShare(true)}
            aria-label="Share this game"
            className="inline-flex items-center gap-1 border border-cream/40 px-2 py-1 font-athletic text-[11px] font-semibold uppercase tracking-wide text-cream/80"
          >
            Share <ArrowUpRightIcon className="h-3 w-3" />
          </button>
          {/* Commentary only matters during a live game — hide it pre-game and on
              the final summary. */}
          {live.status === 'live' &&
            (() => {
              // Three states: ON (sound wanted + unlocked), LOCKED (sound wanted but
              // the browser hasn't let audio start since this load — needs a tap), and
              // OFF. After a reload soundOn is still true but the AudioContext is
              // suspended, so we must show LOCKED and treat a tap as "unlock", NOT
              // "turn off" (the old bug: the button looked on but a tap muted it).
              const locked = soundOn && !audioReady
              return (
                <button
                  onClick={async () => {
                    if (soundOn && audioReady) {
                      audio.disable()
                      setSoundOn(false)
                      setAudioReady(false)
                    } else {
                      setSoundOn(true)
                      await audio.enable()
                      setAudioReady(true)
                    }
                  }}
                  aria-label={
                    locked
                      ? 'Tap to start commentary sound'
                      : soundOn
                        ? 'Turn off AI commentary'
                        : 'Turn on AI commentary'
                  }
                  className={`inline-flex items-center gap-1.5 border px-2 py-1 font-athletic text-[11px] font-semibold uppercase tracking-wide ${
                    locked
                      ? 'animate-pulse border-gold text-gold'
                      : soundOn
                        ? 'border-gold bg-gold text-ink'
                        : 'border-cream/40 text-cream/70'
                  }`}
                >
                  {soundOn && audioReady ? (
                    <SoundOnIcon className="h-4 w-4" />
                  ) : (
                    <SoundOffIcon className="h-4 w-4" />
                  )}
                  {locked ? 'Tap for sound' : 'Commentary'}
                </button>
              )
            })()}
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

      <SponsorStrip sponsors={info.sponsors ?? []} />

      {live.status === 'scheduled' ? (
        <StartingSoon
          board={board}
          when={info.scheduled_at ?? null}
          location={info.location ?? null}
          hasVideo={info.video_source !== 'none'}
          audioReady={audioReady}
          onEnableSound={async () => {
            setSoundOn(true)
            await audio.enable()
            setAudioReady(true)
          }}
        />
      ) : live.status === 'final' ? (
        <FinalView
          board={board}
          events={events}
          recap={info.recap ?? null}
          location={info.location ?? null}
          startPos={startPositions}
          nameOf={nameById}
          replay={replay}
        />
      ) : isScoreboard ? (
        /* Scoreboard game: no field/lineup — the live scoreboard + the line score. */
        <>
          {videoBlock}
          <div className="flex-1 p-4 min-[760px]:mx-auto min-[760px]:w-full min-[760px]:max-w-2xl min-[760px]:p-6">
            <BoxTab board={board} events={events} startPos={startPositions} nameOf={nameById} />
          </div>
        </>
      ) : isDesktop ? (
        /* Desktop: left = video + bug + Plays/Box/Stats; right = the live field. */
        <div className="flex flex-1 items-stretch">
          <div className="flex w-[58%] flex-col border-r-2 border-gold">
            {videoBlock}
            <DataTabs board={board} events={events} startPos={startPositions} nameOf={nameById} />
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
            {tab === 'box' && <BoxTab board={board} events={events} startPos={startPositions} nameOf={nameById} />}
            {tab === 'stats' && <StatsTab board={board} events={events} />}
          </div>
        </>
      )}

      {showShare && (
        <ShareSheet
          url={window.location.href}
          title={`${board.away.name ?? board.away.code} at ${board.home.name ?? board.home.code}`}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  )
}


// Pre-game cover (design spec): a navy screen with bunting, the matchup in full
// names, the first-pitch time, and the location — vertically centered.
function StartingSoon({
  board,
  when,
  location,
  hasVideo,
  audioReady,
  onEnableSound,
}: {
  board: ScoreboardState
  when: string | null
  location: string | null
  hasVideo: boolean
  audioReady: boolean
  onEnableSound: () => void
}) {
  const d = when ? new Date(when) : null
  const time = d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null
  const date = d ? d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : null
  const sub = [location, date].filter(Boolean).join(' · ')

  // Live countdown to first pitch (only when a time is set).
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!d) return
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [d?.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps
  const countdown = (() => {
    if (!d) return null
    const ms = d.getTime() - nowMs
    if (ms <= 0) return 'Starting any moment'
    const total = Math.floor(ms / 1000)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    if (h > 0) return `${h}h ${m}m`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
  })()

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center bg-ink px-6 text-center">
      <div className="absolute inset-x-0 top-0">
        <Bunting />
      </div>

      <div className="flex flex-col items-center gap-5 border-2 border-gold bg-black/15 px-8 py-9 shadow-hard">
        <p className="font-athletic text-xs font-semibold uppercase tracking-[.28em] text-[#a9b4c9]">
          First Pitch
        </p>

        <div>
          <p className="font-display text-2xl leading-tight text-cream min-[760px]:text-3xl">{board.away.name}</p>
          <p className="my-2 font-athletic text-xs uppercase tracking-[.32em] text-muted-green">— at —</p>
          <p className="font-display text-2xl leading-tight text-gold min-[760px]:text-3xl">{board.home.name}</p>
        </div>

        {time ? (
          <div>
            <p className="font-display text-4xl text-cream">{time}</p>
            {sub && <p className="mt-1.5 font-data text-sm text-muted-green">{sub}</p>}
            {countdown && (
              <p className="mt-2 font-athletic text-sm font-semibold uppercase tracking-[.16em] text-gold">
                First pitch in {countdown}
              </p>
            )}
          </div>
        ) : (
          <>
            <p className="font-display text-3xl tracking-[.2em] text-gold">STARTING SOON</p>
            {sub && <p className="font-data text-sm text-muted-green">{sub}</p>}
          </>
        )}

        <p className="font-athletic text-xs uppercase tracking-[.2em] text-[#7f8aa3]">
          {hasVideo ? 'Waiting for stream' : 'Not live yet'}
        </p>
      </div>

      {/* Audio needs a tap to unlock (browser policy) — make it obvious so sound
          is ready before first pitch. */}
      {audioReady ? (
        <p className="mt-6 inline-flex items-center gap-1.5 font-athletic text-xs uppercase tracking-[.2em] text-[#7f8aa3]">
          <SoundOnIcon className="h-4 w-4" /> Sound on
        </p>
      ) : (
        <button
          onClick={onEnableSound}
          className="mt-6 inline-flex items-center gap-2 border-2 border-gold bg-gold px-5 py-2.5 font-display text-ink shadow-hard"
        >
          <SoundOnIcon className="h-5 w-5" /> Tap for sound
        </button>
      )}
    </div>
  )
}

// Post-game screen: FINAL hero, the AI recap, and tabs into the box/stats/plays.
function FinalView({
  board,
  events,
  recap,
  location,
  startPos,
  nameOf,
  replay,
}: {
  board: ScoreboardState
  events: ViewerEvent[]
  recap: Recap | null
  location: string | null
  startPos: StartPositions
  nameOf: (id: string) => string
  replay?: ReplayProps | null
}) {
  // Recap is the default landing tab; the replay sits one tap away.
  const finalTabs = replay
    ? (['recap', 'replay', 'box', 'stats', 'plays'] as const)
    : (['recap', 'box', 'stats', 'plays'] as const)
  const [tab, setTab] = useState<'replay' | 'recap' | 'box' | 'stats' | 'plays'>('recap')
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col bg-ink lg:max-w-5xl">
      {/* stars-and-stripes bunting (design spec: top of the Final screen) */}
      <Bunting />

      {/* FINAL hero */}
      <div className="border-b-2 border-gold bg-ink px-4 pb-6 pt-5 text-center">
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
        {location && <p className="mt-0.5 font-data text-xs text-muted-green">{location}</p>}
      </div>

      {/* sub-tabs */}
      <div className="flex border-b-2 border-gold bg-ink">
        {finalTabs.map((t) => (
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
        {tab === 'replay' && replay && <ReplayView {...replay} />}
        {tab === 'recap' && <RecapFinal recap={recap} events={events} board={board} />}
        {tab === 'box' && <BoxTab board={board} events={events} startPos={startPos} nameOf={nameOf} />}
        {tab === 'stats' && <StatsTab board={board} events={events} />}
        {tab === 'plays' && <PlaysTab events={events} />}
      </div>
    </div>
  )
}

type ReplayProps = {
  url: string
  startedAtMs: number
  gameId: string
  events: ViewerEvent[]
  lineups: { away: { name: string; jersey: string | null }[]; home: { name: string; jersey: string | null }[] }
  teams: { away: { name: string; code: string }; home: { name: string; code: string } }
  cueNameOf: (id: string | null | undefined) => string | null
  lineupsRaw: { away: LineupSlot[]; home: LineupSlot[] }
  players: Record<string, { name: string; jersey: string | null }>
}

// Replay the recorded broadcast with the scorebug + AI commentary re-synced to the
// video clock: as the video plays, each event fires at wall_clock_ts − started_at into
// it (FX immediately; the spoken lines through the same cached-TTS queue as live), and
// the scorebug is projected from the events reached so far. Scrubbing re-syncs both.
function ReplayView({ url, startedAtMs, gameId, events, lineups, teams, cueNameOf, lineupsRaw, players }: ReplayProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const sorted = useMemo(() => [...events].sort((a, b) => a.seq - b.seq), [events])
  const firedSeq = useRef(0)
  const lastTime = useRef(0)
  const didSeek = useRef(false)

  // Attach the source: HLS (Stream VOD) via hls.js/native, or a plain file/blob URL.
  useEffect(() => {
    const el = videoRef.current
    if (!el || !url) return
    didSeek.current = false
    if (isHlsUrl(url)) return attachHls(el, url)
    el.src = url
    return () => el.removeAttribute('src')
  }, [url])
  const [live, setLive] = useState<LiveGame>(() => ({ ...INITIAL_LIVE }))
  // Events reached at the current video position — drives the synced field/batter view.
  const [visible, setVisible] = useState<ViewerEvent[]>([])
  // Current playback position as a game wall-clock (ms) — lets the spray flash for a
  // fixed window after contact and then clear, mirroring the live view.
  const [posMs, setPosMs] = useState(0)
  // The recording can be shorter than the game (broadcast ended early). When the video
  // finishes, if the game continued past it, hand off to the big scoreboard like the live
  // view does — showing the final score with a note that the broadcast was stopped early.
  const [videoEnded, setVideoEnded] = useState(false)
  const [durationMs, setDurationMs] = useState(0)

  const tsOf = (e: ViewerEvent) => (e.wall_clock_ts ? new Date(e.wall_clock_ts).getTime() : 0)

  // The recording starts when the CAMERA started (before first pitch). Skip that dead
  // pre-game footage: jump to just BEFORE game_start. A small pre-roll matters — if we
  // land exactly on game_start, onTime treats the jump as a seek, marks that event as
  // already-fired and flushes the voice queue, so the opening AI commentary is skipped.
  // Starting a few seconds early lets game_start fire naturally during playback.
  const PREROLL_SEC = 3
  const startOffsetSec = (() => {
    const gs = sorted.find((e) => e.event_type === 'game_start')
    return gs ? Math.max(0, (tsOf(gs) - startedAtMs) / 1000 - PREROLL_SEC) : 0
  })()

  // If the camera came on AFTER the game started (video covers only part of the game), the
  // scorebug at the video's start already reflects all earlier plays — but we must NOT
  // burst-narrate those off-camera plays at t=0. Baseline the fired-commentary marker past
  // any event more than ~5s before the video begins (keeps game_start + the last few
  // seconds live). The box/stats/plays tabs still cover the FULL game from the event log.
  const baselinedRef = useRef(false)
  useEffect(() => {
    if (baselinedRef.current || !sorted.length) return
    baselinedRef.current = true
    const cutoff = startedAtMs - 5000
    let s = 0
    for (const e of sorted) if (tsOf(e) < cutoff) s = e.seq
    firedSeq.current = s
  }, [sorted, startedAtMs])

  function fire(sinceSeq: number, upTo: ViewerEvent[]) {
    const newest = upTo[upTo.length - 1]
    if (!newest) return
    audio.playFx(fxCues(newest.event_type))
    if (['single', 'double', 'triple', 'home_run', 'manual_run'].includes(newest.event_type)) audio.swellCrowd()
    const fresh = upTo.filter((e) => e.seq > sinceSeq)
    if (fresh.some((e) => e.event_type === 'inning_change' || e.event_type === 'game_start')) {
      audio.enqueueOrgan()
    }
    const cues = freshCues(upTo, sinceSeq, cueNameOf, lineups, { away: teams.away.name, home: teams.home.name })
    void (async () => {
      for (const c of cues) {
        try {
          const { data } = await supabase.functions.invoke('commentary', {
            body: { gameId, seq: c.key, text: c.text, kind: c.kind },
          })
          // The between-innings recap ('summary') gets the charge organ under it.
          if (data?.url) audio.enqueueVoice(String(data.url), c.kind === 'summary')
        } catch {
          /* skip this line */
        }
      }
    })()
  }

  function onTime() {
    const vid = videoRef.current
    if (!vid) return
    const cur = vid.currentTime
    const virtualMs = startedAtMs + cur * 1000
    const upTo = sorted.filter((e) => tsOf(e) <= virtualMs)
    setLive(project(upTo))
    setVisible(upTo)
    setPosMs(virtualMs)
    const newMax = upTo.length ? upTo[upTo.length - 1].seq : 0
    const seeked = Math.abs(cur - lastTime.current) > 1.5 || cur < lastTime.current
    if (seeked) {
      firedSeq.current = newMax
      audio.flushVoice()
    } else if (newMax > firedSeq.current && audio.isEnabled()) {
      fire(firedSeq.current, upTo)
      firedSeq.current = newMax
    }
    lastTime.current = cur
  }

  const board: ScoreboardState = {
    away: { code: teams.away.code, name: teams.away.name, score: live.awayScore },
    home: { code: teams.home.code, name: teams.home.name, score: live.homeScore },
    inning: live.inning,
    half: live.half,
    balls: live.balls,
    strikes: live.strikes,
    outs: live.outs,
    runners: occupancy(live.bases),
  }

  if (!url)
    return (
      <div className="mx-auto flex aspect-video w-full max-w-2xl items-center justify-center bg-black font-data text-sm text-cream/60">
        Loading replay…
      </div>
    )

  // Re-render the live field + batter/pitcher, projected to the video's position, so the
  // replay mirrors what viewers saw (not just the raw clip).
  const subs = extractSubs(visible)
  const resolveTeam = (key: 'away' | 'home'): LiveSlot[] => {
    const initial = (lineupsRaw[key] ?? [])
      .filter((s): s is LineupSlot & { id: string } => !!s.id)
      .map((s) => ({ playerId: s.id, position: s.pos }))
    return projectSlots(initial, subs, key).map((s) => {
      const pl = players[s.playerId]
      const nm = displayName(pl?.name) || (pl?.jersey ? `#${pl.jersey}` : '—')
      return { id: s.playerId, name: nm, jersey: pl?.jersey ?? null, pos: s.position }
    })
  }
  const rLineups: LiveLineups = { away: resolveTeam('away'), home: resolveTeam('home') }
  const hasLineups = !!(lineupsRaw.away?.length || lineupsRaw.home?.length)
  const newestLoc = [...visible].reverse().find((e) => {
    const p = e.payload as { hit?: unknown; spray?: unknown; fielders?: unknown[] } | undefined
    return !!(p && (p.hit || p.spray || (Array.isArray(p.fielders) && p.fielders.length)))
  })
  // Flash the spray only for ~4.5s of game-time after contact, then clear it — matching
  // the live view (which sets `flash` and clears it on a timer). Keyed off the video
  // position, so scrubbing shows a spray only when parked right after that play.
  const SPRAY_FLASH_MS = 4500
  const spray =
    newestLoc && posMs - tsOf(newestLoc) <= SPRAY_FLASH_MS ? buildViz(newestLoc.payload, newestLoc.seq) : null

  // Did the game continue past the recording? (broadcast stopped before the final out).
  const finalLive = project(sorted)
  const lastEventMs = sorted.length ? tsOf(sorted[sorted.length - 1]) : 0
  const endedEarly = durationMs > 0 && lastEventMs > startedAtMs + durationMs + 8000
  const finalBoard: ScoreboardState = {
    away: { code: teams.away.code, name: teams.away.name, score: finalLive.awayScore },
    home: { code: teams.home.code, name: teams.home.name, score: finalLive.homeScore },
    inning: finalLive.inning,
    half: finalLive.half,
    balls: finalLive.balls,
    strikes: finalLive.strikes,
    outs: finalLive.outs,
    runners: occupancy(finalLive.bases),
  }

  return (
    <div className="mx-auto w-full max-w-2xl lg:max-w-none">
      {/* Desktop mirrors the live view: video + scorebug on the left (~58%), the synced
          batter/pitcher + field on the right. Phone stays a single stack. */}
      <div className="lg:flex lg:items-start lg:gap-6">
        <div className="lg:w-[58%] lg:flex-none">
          {/* video, then the scorebug bar BELOW it (never over the player controls) */}
          <div className="bg-black">
            <video
              ref={videoRef}
              controls
              autoPlay
              playsInline
              onPlay={() => {
                void audio.enable()
                setVideoEnded(false)
              }}
              onTimeUpdate={onTime}
              onEnded={() => setVideoEnded(true)}
              onDurationChange={() => {
                const v = videoRef.current
                if (v && isFinite(v.duration)) setDurationMs(v.duration * 1000)
              }}
              onLoadedMetadata={() => {
                const v = videoRef.current
                if (!v || didSeek.current) return
                didSeek.current = true
                if (startOffsetSec > 1 && startOffsetSec < (v.duration || Infinity) - 1) v.currentTime = startOffsetSec
              }}
              // Recording is the upright 16:9 canvas (matches live). object-cover also
              // center-crops the raw-camera fallback clip to 16:9 on the rare device that
              // needed it.
              className="aspect-video w-full bg-black object-cover"
            />
          </div>
          <ScorebugBar state={board} />

          {/* Recording stopped before the game ended — hand off to the big scoreboard with
              the FINAL score, like the live view's no-video state. */}
          {videoEnded && endedEarly && (
            <div className="mt-3">
              <div className="border-2 border-gold bg-gold/10 px-3 py-2 text-center font-athletic text-xs font-semibold uppercase tracking-wide text-gold">
                Broadcast ended early — the rest of the game was played off-camera. Final score below.
              </div>
              <div className="mt-2">
                <ScorePanel state={finalBoard} />
              </div>
            </div>
          )}
        </div>

        {/* The live experience, time-traveled: batter/pitcher + the field, synced to the video. */}
        {hasLineups && (
          <div className="mt-3 lg:mt-0 lg:flex-1">
            <BatterPitcherStrip lineups={rLineups} live={live} events={visible} />
            <div className="mt-3">
              <FieldTab lineups={rLineups} live={live} events={visible} spray={spray} />
            </div>
          </div>
        )}
      </div>

      <p className="mt-3 text-center font-data text-xs text-muted-green">
        Game replay — mirrors the live view, synced to the video. Tap play to enable sound.
      </p>
    </div>
  )
}

// A slim strip of clickable sponsor logos under the header — a flat, on-brand booster
// panel. Outbound links are locked down (noopener/nofollow/sponsored). Only sponsors the
// server already approved reach here (get_public_game filters to approved+active).
function SponsorStrip({ sponsors }: { sponsors: { name: string | null; image: string; url: string | null }[] }) {
  if (!sponsors.length) return null
  const src = (path: string) => supabase.storage.from('bpw-sponsors').getPublicUrl(path).data.publicUrl
  return (
    <div className="flex items-center gap-4 overflow-x-auto border-b-2 border-gold/30 bg-ink/70 px-3 py-1.5">
      <span className="shrink-0 font-athletic text-[9px] font-bold uppercase tracking-[.14em] text-cream/40">
        Sponsored by
      </span>
      {sponsors.map((s, i) => {
        const img = (
          <img
            src={src(s.image)}
            alt={s.name ?? 'Sponsor'}
            loading="lazy"
            className="h-7 w-auto max-w-[120px] object-contain"
          />
        )
        return s.url ? (
          <a key={i} href={s.url} target="_blank" rel="noopener noreferrer nofollow sponsored" className="shrink-0">
            {img}
          </a>
        ) : (
          <span key={i} className="shrink-0">
            {img}
          </span>
        )
      })}
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
    // Desktop: recap write-up and line score sit side by side instead of stacked.
    <div className="mx-auto max-w-xl lg:max-w-none lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
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
    <div className="mt-5 overflow-x-auto lg:mt-0">
      <table className="w-full border-2 border-gold text-center font-data text-sm tabular">
        <thead>
          <tr className="bg-[var(--surface)] text-[11px] uppercase tracking-wide text-muted-green">
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
function DataTabs({
  board,
  events,
  startPos,
  nameOf,
}: {
  board: ScoreboardState
  events: ViewerEvent[]
  startPos: StartPositions
  nameOf: (id: string) => string
}) {
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
        {tab === 'box' && <BoxTab board={board} events={events} startPos={startPos} nameOf={nameOf} />}
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
            {due.map((p) => `${p.jersey ?? ''} ${p.name}`).join(' · ')}
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
  for (const e of events) if (e.batter_id && e.batter_name) m.set(e.batter_id, displayName(e.batter_name))
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

  // runner chips: the already-privatized name ("First L.")
  const runnerName = (id: string) => map.get(id) ?? null

  // defense + current batter from the projected lineups (names already privatized).
  // Field chips are tight, so show just the first name there.
  const fieldingKey = live.half === 'top' ? 'home' : 'away'
  const battingKey = live.half === 'top' ? 'away' : 'home'
  const fielders = lineups[fieldingKey].map((p) => ({ pos: p.pos, name: p.name.split(' ')[0] }))
  const order = lineups[battingKey]
  const idx = battingKey === 'away' ? live.awayBatterIdx : live.homeBatterIdx
  const batter = order.length ? order[idx % order.length] : null
  const batterLabel = batter ? batter.name.toUpperCase() : null

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
    // Two balanced columns on desktop so a long game doesn't become one tall strip.
    <ul className="divide-y divide-cream/10 lg:columns-2 lg:gap-8 lg:divide-y-0">
      {plays.map((p) => (
        <li key={p.seq} className="flex gap-3 py-2.5 lg:break-inside-avoid lg:border-b lg:border-cream/10">
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
  startPos,
  nameOf,
}: {
  board: { away: { code: string; name?: string }; home: { code: string; name?: string } }
  events: ViewerEvent[]
  startPos: StartPositions
  nameOf: (id: string) => string
}) {
  const box = computeBoxScore(events)
  const bats = computeBattingLines(events, (id) => nameOf(id))
  const pitch = computePitchingLines(events, startPos, (id) => nameOf(id))
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

      {/* Each team in its own block: team name, then Batting and Pitching sections.
          Side-by-side on desktop instead of one tall stack. */}
      <div className="grid gap-5 lg:grid-cols-2 lg:gap-6">
        <TeamBox name={board.away.name ?? board.away.code} bats={bats.away} pitch={pitch.away} />
        <TeamBox name={board.home.name ?? board.home.code} bats={bats.home} pitch={pitch.home} accent />
      </div>
    </div>
  )
}

// One team's full box: name heading with Batting / Pitching subheadings beneath.
function TeamBox({
  name,
  bats,
  pitch,
  accent = false,
}: {
  name: string
  bats: BattingLine[]
  pitch: PitchingLine[]
  accent?: boolean
}) {
  return (
    <div className="border-2 border-cream/15">
      <h3
        className={`border-b-2 px-3 py-2 font-display text-lg ${
          accent ? 'border-gold/50 text-gold' : 'border-cream/30 text-cream'
        }`}
      >
        {name}
      </h3>
      <div className="flex flex-col gap-4 p-3">
        <div>
          <SectionHead>Batting</SectionHead>
          <BattingTable lines={bats} accent={accent} />
        </div>
        <div>
          <SectionHead>Pitching</SectionHead>
          <PitchingTable lines={pitch} accent={accent} />
        </div>
      </div>
    </div>
  )
}

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 font-athletic text-[11px] font-semibold uppercase tracking-[.16em] text-barn-red">
      {children}
    </p>
  )
}

// Numeric batting columns (AVG is rendered separately as a .XXX string).
const BAT_COLS = ['AB', 'R', 'H', 'RBI', '2B', '3B', 'HR', 'BB', 'K'] as const

// Format a batting average baseball-style: ".333", "1.000", ".000".
function fmtAvg(avg: number): string {
  if (avg >= 1) return '1.000'
  return avg.toFixed(3).slice(1)
}

function BattingTable({ lines }: { lines: BattingLine[]; accent?: boolean }) {
  if (lines.length === 0)
    return <p className="font-data text-[12px] text-muted-green">No at-bats yet.</p>
  const sorted = lines.slice().sort((a, b) => b.ab - a.ab || b.h - a.h)
  const sum = (f: (l: BattingLine) => number) => sorted.reduce((t, l) => t + f(l), 0)
  const cell = (l: BattingLine, c: (typeof BAT_COLS)[number]) =>
    c === 'AB' ? l.ab : c === 'R' ? l.r : c === 'H' ? l.h : c === 'RBI' ? l.rbi
      : c === '2B' ? l.doubles : c === '3B' ? l.triples : c === 'HR' ? l.hr : c === 'BB' ? l.bb : l.k
  const total = (c: (typeof BAT_COLS)[number]) => sum((l) => cell(l, c))
  const teamAb = sum((l) => l.ab)
  const teamAvg = teamAb > 0 ? sum((l) => l.h) / teamAb : 0
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] table-fixed border-collapse text-[13px]">
        <colgroup>
          <col className="w-[24%]" />
          {BAT_COLS.map((c) => (
            <col key={c} className="w-[7%]" />
          ))}
          <col className="w-[9%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-cream/20 font-athletic text-[11px] text-muted-green">
            <th className="py-1.5 text-left font-normal">Batter</th>
            {BAT_COLS.map((h) => (
              <th key={h} className="px-0.5 py-1.5 text-center font-normal">
                {h}
              </th>
            ))}
            <th className="px-0.5 py-1.5 text-center font-normal">AVG</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-cream/10">
          {sorted.map((l) => (
            <tr key={l.playerId} className="font-data">
              <td className="truncate py-1.5 pr-2 text-cream">{l.name}</td>
              {BAT_COLS.map((c) => (
                <Num key={c} n={cell(l, c)} bold={c === 'H'} />
              ))}
              <td className="px-0.5 py-1.5 text-center tabular text-cream/85">{fmtAvg(l.avg)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-cream/25 font-athletic font-semibold text-cream">
            <td className="py-1.5 pr-2 uppercase tracking-wide">Team</td>
            {BAT_COLS.map((c) => (
              <Num key={c} n={total(c)} bold />
            ))}
            <td className="px-0.5 py-1.5 text-center tabular">{fmtAvg(teamAvg)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

const PITCH_COLS = ['IP', 'H', 'R', 'ER', 'BB', 'K'] as const

function PitchingTable({ lines }: { lines: PitchingLine[]; accent?: boolean }) {
  if (lines.length === 0)
    return <p className="font-data text-[12px] text-muted-green">No pitching recorded yet.</p>
  const tot = {
    outs: lines.reduce((t, l) => t + l.outs, 0),
    h: lines.reduce((t, l) => t + l.h, 0),
    r: lines.reduce((t, l) => t + l.r, 0),
    er: lines.reduce((t, l) => t + l.er, 0),
    bb: lines.reduce((t, l) => t + l.bb, 0),
    k: lines.reduce((t, l) => t + l.k, 0),
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] table-fixed border-collapse text-[13px]">
        <colgroup>
          <col className="w-[34%]" />
          {PITCH_COLS.map((c) => (
            <col key={c} className="w-[11%]" />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-cream/20 font-athletic text-[11px] text-muted-green">
            <th className="py-1.5 text-left font-normal">Pitcher</th>
            {PITCH_COLS.map((h) => (
              <th key={h} className="px-0.5 py-1.5 text-center font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-cream/10">
          {lines.map((l) => (
            <tr key={l.playerId} className="font-data">
              <td className="truncate py-1.5 pr-2 text-cream">{l.name}</td>
              <td className="px-0.5 py-1.5 text-center tabular text-cream/85">{formatIp(l.outs)}</td>
              <Num n={l.h} />
              <Num n={l.r} />
              <Num n={l.er} />
              <Num n={l.bb} />
              <Num n={l.k} />
            </tr>
          ))}
          <tr className="border-t-2 border-cream/25 font-athletic font-semibold text-cream">
            <td className="py-1.5 pr-2 uppercase tracking-wide">Team</td>
            <td className="px-0.5 py-1.5 text-center tabular">{formatIp(tot.outs)}</td>
            <Num n={tot.h} bold />
            <Num n={tot.r} bold />
            <Num n={tot.er} bold />
            <Num n={tot.bb} bold />
            <Num n={tot.k} bold />
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function Num({ n, bold = false }: { n: number; bold?: boolean }) {
  return (
    <td className={`px-1 py-1.5 text-center tabular ${bold ? 'font-bold text-cream' : 'text-cream/85'}`}>
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
    <div className="grid gap-5 lg:grid-cols-2 lg:gap-6">
      <div>
        <h3 className="mb-2 font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-green">
          Team totals
        </h3>
        <div className="grid grid-cols-3 gap-px bg-cream/15 font-data text-sm">
          {['', board.away.code, board.home.code].map((c, i) => (
            <div
              key={i}
              className="bg-[var(--surface)] px-2 py-1.5 text-center font-athletic font-semibold text-muted-green"
            >
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
      <div className="bg-[var(--surface)] px-2 py-1.5 font-athletic text-muted-green">{label}</div>
      <div className="bg-[var(--surface)] px-2 py-1.5 text-center font-athletic tabular text-cream">{a}</div>
      <div className="bg-[var(--surface)] px-2 py-1.5 text-center font-athletic tabular text-cream">{h}</div>
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

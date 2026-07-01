import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Game, LineupEntry, Player, Team } from '@/lib/types'
import {
  currentBatterSlot,
  INITIAL_LIVE,
  PA_ENDING,
  PITCH_TYPES,
  project,
  type EventPayload,
  type EventType,
  type GameEventRow,
  type LiveGame,
} from '@/lib/engine'
import { gameChannelName } from '@/lib/realtime'
import { currentPitcherEntrySeq, extractSubs, pitchesSince, projectSlots } from '@/lib/lineup'

type Teams = { away: Team; home: Team }
// Player plus the position assigned for THIS game (lineup_entries.position).
export type LineupPlayer = Player & { position: string | null }
type Lineups = { away: LineupPlayer[]; home: LineupPlayer[] }

// Local write-ahead log. Every scored play is mirrored to localStorage
// SYNCHRONOUSLY before the async DB insert, so a force-quit (or a dropped
// network write) can't lose plays — on reopen we replay anything that never
// reached the server. localStorage survives the app being killed; an in-flight
// fetch does not.
// Default field positions for a generated lineup's first nine.
const GENERIC_FIELD = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']

const walKey = (gameId: string) => `bpw_wal_${gameId}`
function readWal(gameId: string): GameEventRow[] {
  try {
    const raw = localStorage.getItem(walKey(gameId))
    return raw ? (JSON.parse(raw) as GameEventRow[]) : []
  } catch {
    return []
  }
}
function writeWal(gameId: string, rows: GameEventRow[]) {
  try {
    localStorage.setItem(walKey(gameId), JSON.stringify(rows))
  } catch {
    /* storage unavailable (private mode / quota) — degrade gracefully */
  }
}

export function useScorer(gameId: string | undefined) {
  const [game, setGame] = useState<Game | null>(null)
  const [teams, setTeams] = useState<Teams | null>(null)
  const [lineups, setLineups] = useState<Lineups>({ away: [], home: [] })
  const [playersById, setPlayersById] = useState<Map<string, Player>>(new Map())
  const [events, setEvents] = useState<GameEventRow[]>([])
  const [live, setLive] = useState<LiveGame>(INITIAL_LIVE)
  // First-pitch timestamp (the game_start event) for the scorer's running clock.
  const [firstPitchAt, setFirstPitchAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const statusRef = useRef<string | null>(null)
  // Authoritative, synchronously-updated event list — so back-to-back taps each
  // compute a unique next seq (the React `events` state lags a render behind).
  const eventsRef = useRef<GameEventRow[]>([])

  // Initial load + open the broadcast channel.
  useEffect(() => {
    if (!gameId) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const { data: g, error: gErr } = await supabase
        .from('games')
        .select('*')
        .eq('id', gameId)
        .single()
      if (gErr) {
        if (!cancelled) setError(gErr.message), setLoading(false)
        return
      }
      const [{ data: away }, { data: home }, { data: evs }, { data: le }, { data: pls }] =
        await Promise.all([
          supabase.from('teams').select('*').eq('id', g.away_team_id).single(),
          supabase.from('teams').select('*').eq('id', g.home_team_id).single(),
          supabase.from('game_events').select('seq,event_type,payload,created_at').eq('game_id', gameId).order('seq'),
          supabase.from('lineup_entries').select('*').eq('game_id', gameId).order('batting_order'),
          supabase.from('players').select('*').in('team_id', [g.away_team_id, g.home_team_id]),
        ])
      if (cancelled) return
      setGame(g as Game)
      if (away && home) setTeams({ away: away as Team, home: home as Team })
      // Build batting orders from lineup_entries, resolving player_id -> Player.
      const byId = new Map(((pls ?? []) as Player[]).map((p) => [p.id, p]))
      setPlayersById(byId)
      const ordered = (teamId: string): LineupPlayer[] =>
        ((le ?? []) as LineupEntry[])
          .filter((e) => e.team_id === teamId)
          .map((e) => {
            const p = byId.get(e.player_id)
            return p ? { ...p, position: e.position } : null
          })
          .filter((p): p is LineupPlayer => !!p)
      setLineups({ away: ordered(g.away_team_id), home: ordered(g.home_team_id) })

      // Reconcile the DB with the local write-ahead log: replay any plays that
      // were scored locally but never reached the server (force-quit / dropped
      // write). We only replay the unconfirmed *tail* (seq beyond the DB max),
      // so we never resurrect plays that were legitimately undone. Only for a LIVE
      // game — a scheduled (or reset) or final game shouldn't have its old local
      // backup replayed, which would un-reset it.
      const dbRows = (evs ?? []) as GameEventRow[]
      let rows = dbRows
      const maxDbSeq = dbRows.at(-1)?.seq ?? 0
      const pending =
        g.status === 'live'
          ? readWal(gameId).filter((w) => w.seq > maxDbSeq).sort((a, b) => a.seq - b.seq)
          : []
      if (g.status !== 'live') writeWal(gameId, dbRows) // keep the local backup in sync with the reset
      if (pending.length) {
        const intended = [...dbRows, ...pending]
        const inserts = pending.map((p) => {
          const upto = project(intended.filter((e) => e.seq <= p.seq))
          return {
            game_id: gameId,
            seq: p.seq,
            event_type: p.event_type,
            payload: p.payload,
            inning: upto.inning,
            half: upto.half,
            batter_id: p.batter_id ?? null,
          }
        })
        const { error: replayErr } = await supabase.from('game_events').insert(inserts)
        if (!replayErr) rows = intended // recovered; otherwise keep WAL and retry next load
      }

      if (cancelled) return
      // Game clock anchor: when the game_start event was recorded on the server.
      const startTs = (dbRows as Array<GameEventRow & { created_at?: string }>).find(
        (e) => e.event_type === 'game_start',
      )?.created_at
      setFirstPitchAt(startTs ?? null)
      eventsRef.current = rows
      setEvents(rows)
      setLive(project(rows))
      writeWal(gameId, rows)
      setLoading(false)
    })()

    const ch = supabase.channel(gameChannelName(gameId), {
      config: { broadcast: { self: false } },
    })
    ch.subscribe()
    channelRef.current = ch
    return () => {
      cancelled = true
      supabase.removeChannel(ch)
      channelRef.current = null
    }
  }, [gameId])

  // Persist a new live state to game_state + broadcast it to viewers.
  const persist = useCallback(
    async (next: LiveGame) => {
      if (!gameId) return
      const snapshotErr = await supabase.from('game_state').upsert(
        {
          game_id: gameId,
          inning: next.inning,
          half: next.half,
          outs: next.outs,
          balls: next.balls,
          strikes: next.strikes,
          home_score: next.homeScore,
          away_score: next.awayScore,
          snapshot: next,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'game_id' },
      )
      if (snapshotErr.error) setError(snapshotErr.error.message)
      channelRef.current?.send({ type: 'broadcast', event: 'state', payload: next })

      // Keep the games.status column truthful (scheduled → live → final) so the
      // viewer badge and the Setup games list reflect reality. One write per
      // transition, not per pitch.
      if (next.status !== statusRef.current) {
        statusRef.current = next.status
        await supabase.from('games').update({ status: next.status }).eq('id', gameId)
      }
    },
    [gameId],
  )

  // Re-fetch rosters + lineups (after editing a player or filling a lineup).
  const reloadRoster = useCallback(async () => {
    if (!gameId) return
    const { data: g } = await supabase
      .from('games')
      .select('away_team_id, home_team_id')
      .eq('id', gameId)
      .single()
    if (!g) return
    const [{ data: le }, { data: pls }] = await Promise.all([
      supabase.from('lineup_entries').select('*').eq('game_id', gameId).order('batting_order'),
      supabase.from('players').select('*').in('team_id', [g.away_team_id, g.home_team_id]),
    ])
    const byId = new Map(((pls ?? []) as Player[]).map((p) => [p.id, p]))
    setPlayersById(byId)
    const ordered = (teamId: string): LineupPlayer[] =>
      ((le ?? []) as LineupEntry[])
        .filter((e) => e.team_id === teamId)
        .map((e) => {
          const p = byId.get(e.player_id)
          return p ? { ...p, position: e.position } : null
        })
        .filter((p): p is LineupPlayer => !!p)
    setLineups({ away: ordered(g.away_team_id), home: ordered(g.home_team_id) })
  }, [gameId])

  // Edit a player's number/name on the fly (e.g. naming the other team's batters).
  const editPlayer = useCallback(
    async (id: string, patch: { name?: string; jersey_number?: string | null }) => {
      const upd: Record<string, unknown> = {}
      if (patch.name !== undefined) upd.name = patch.name.trim()
      if (patch.jersey_number !== undefined) upd.jersey_number = patch.jersey_number?.trim() || null
      const { error } = await supabase.from('players').update(upd).eq('id', id)
      if (error) return setError(error.message)
      await reloadRoster()
    },
    [reloadRoster],
  )

  // Drop in a generic batting order ("Player 1"…"Player 9") for a team that has no
  // lineup, so a game can start (and be scored) without the other team's roster.
  const fillGenericLineup = useCallback(
    async (teamKey: 'away' | 'home', count = 9) => {
      if (!game) return
      const teamId = teamKey === 'away' ? game.away_team_id : game.home_team_id
      const newPlayers = Array.from({ length: count }, (_, i) => ({
        team_id: teamId,
        name: `Player ${i + 1}`,
        jersey_number: null as string | null,
      }))
      const { data: created, error } = await supabase.from('players').insert(newPlayers).select()
      if (error || !created) return setError(error?.message ?? 'Could not add players.')
      const entries = created.map((p, i) => ({
        game_id: gameId,
        team_id: teamId,
        player_id: p.id,
        batting_order: i + 1,
        position: GENERIC_FIELD[i] ?? 'BENCH',
        is_starter: true,
      }))
      const { error: leErr } = await supabase.from('lineup_entries').insert(entries)
      if (leErr) return setError(leErr.message)
      await reloadRoster()
    },
    [game, gameId, reloadRoster],
  )

  // Start a team's batting order from its EXISTING roster (your team / a claimed team)
  // rather than generic "Player 1, 2…" — the latter only makes sense for a brand-new
  // ghost opponent with no roster. Returns 'roster' if real players were used, or
  // 'generic' if it fell back (no roster). Order = jersey order; default positions kept.
  const fillLineupFromRoster = useCallback(
    async (teamKey: 'away' | 'home'): Promise<'roster' | 'generic'> => {
      if (!game) return 'generic'
      const teamId = teamKey === 'away' ? game.away_team_id : game.home_team_id
      const { data: roster } = await supabase
        .from('players')
        .select('id, default_position')
        .eq('team_id', teamId)
        .is('archived_at', null)
        .order('jersey_number', { nullsFirst: false })
      const players = (roster ?? []) as { id: string; default_position: string | null }[]
      if (players.length === 0) {
        await fillGenericLineup(teamKey)
        return 'generic'
      }
      const entries = players.map((p, i) => ({
        game_id: gameId,
        team_id: teamId,
        player_id: p.id,
        batting_order: i + 1,
        position: p.default_position ?? GENERIC_FIELD[i] ?? 'BENCH',
        is_starter: true,
      }))
      const { error } = await supabase.from('lineup_entries').insert(entries)
      if (error) {
        setError(error.message)
        return 'generic'
      }
      await reloadRoster()
      return 'roster'
    },
    [game, gameId, reloadRoster, fillGenericLineup],
  )

  // Project the CURRENT lineups (starters + substitutions applied in order).
  const subs = extractSubs(events)
  const projectTeam = (key: 'away' | 'home'): LineupPlayer[] => {
    const initial = lineups[key].map((p) => ({ playerId: p.id, position: p.position }))
    return projectSlots(initial, subs, key)
      .map((s) => {
        const p = playersById.get(s.playerId)
        return p ? ({ ...p, position: s.position } as LineupPlayer) : null
      })
      .filter((p): p is LineupPlayer => !!p)
  }
  const currentLineups: Lineups = { away: projectTeam('away'), home: projectTeam('home') }

  // Current batter / on-deck for the team at bat.
  const battingLineup = live.half === 'top' ? currentLineups.away : currentLineups.home
  const slot = currentBatterSlot(live, battingLineup.length)
  const currentBatter = slot != null ? battingLineup[slot] ?? null : null
  const onDeck =
    slot != null && battingLineup.length
      ? battingLineup[(slot + 1) % battingLineup.length] ?? null
      : null

  // Append an event, re-project, persist.
  const act = useCallback(
    async (event_type: EventType, payload: EventPayload = {}) => {
      if (!gameId) return
      const base = eventsRef.current
      const seq = (base.at(-1)?.seq ?? 0) + 1
      const batter_id = currentBatter?.id ?? null
      const row: GameEventRow = { seq, event_type, payload, batter_id }
      const nextEvents = [...base, row]
      const nextLive = project(nextEvents)
      eventsRef.current = nextEvents // synchronous — a rapid next tap gets seq+1
      setEvents(nextEvents)
      setLive(nextLive)
      if (event_type === 'game_start') setFirstPitchAt(new Date().toISOString()) // start the clock now
      writeWal(gameId, nextEvents) // durable BEFORE the network write — survives a force-quit
      const { error: insErr } = await supabase.from('game_events').insert({
        game_id: gameId,
        seq,
        event_type,
        payload,
        inning: nextLive.inning,
        half: nextLive.half,
        batter_id,
      })
      if (insErr) {
        setError(insErr.message)
        // roll back just this row
        const rolled = eventsRef.current.filter((e) => e !== row)
        eventsRef.current = rolled
        setEvents(rolled)
        setLive(project(rolled))
        writeWal(gameId, rolled)
        return
      }
      await persist(nextLive)
    },
    [gameId, persist, currentBatter],
  )

  // Undo: remove the last event, re-project, persist.
  const undo = useCallback(async () => {
    const base = eventsRef.current
    const last = base.at(-1)
    if (!gameId || !last) return
    const nextEvents = base.slice(0, -1)
    const nextLive = project(nextEvents)
    eventsRef.current = nextEvents
    setEvents(nextEvents)
    setLive(nextLive)
    writeWal(gameId, nextEvents)
    const { error: delErr } = await supabase
      .from('game_events')
      .delete()
      .eq('game_id', gameId)
      .eq('seq', last.seq)
    if (delErr) {
      setError(delErr.message)
      // restore
      eventsRef.current = base
      setEvents(base)
      setLive(project(base))
      writeWal(gameId, base)
      return
    }
    await persist(nextLive)
  }, [gameId, persist])

  // Delete ANY past play (correct a mistake found later). Removes that event, then
  // re-projects the whole log — later events keep their seq, gaps are fine.
  const deleteEvent = useCallback(
    async (seq: number) => {
      const base = eventsRef.current
      if (!gameId || !base.some((e) => e.seq === seq)) return
      const nextEvents = base.filter((e) => e.seq !== seq)
      const nextLive = project(nextEvents)
      eventsRef.current = nextEvents
      setEvents(nextEvents)
      setLive(nextLive)
      writeWal(gameId, nextEvents)
      const { error: delErr } = await supabase
        .from('game_events')
        .delete()
        .eq('game_id', gameId)
        .eq('seq', seq)
      if (delErr) {
        setError(delErr.message)
        eventsRef.current = base
        setEvents(base)
        setLive(project(base))
        writeWal(gameId, base)
        return
      }
      await persist(nextLive)
    },
    [gameId, persist],
  )

  // Fielding team's current pitcher (projected lineup player at position P).
  const fieldingKey = live.half === 'top' ? 'home' : 'away'
  const fieldingLineup = currentLineups[fieldingKey]
  const currentPitcher =
    fieldingLineup.find((p) => (p.position ?? p.default_position) === 'P') ?? null
  // Pitch count for THIS pitcher (since they entered).
  const currentPitcherPitches = pitchesSince(events, fieldingKey, currentPitcherEntrySeq(events, fieldingKey))

  // Bench: roster players not currently in either lineup (archived players excluded
  // from the sub picker, but still resolve by id if they're in this game already).
  const inLineup = new Set([...currentLineups.away, ...currentLineups.home].map((p) => p.id))
  const bench = {
    away: [...playersById.values()].filter((p) => p.team_id === teams?.away.id && !inLineup.has(p.id) && !p.archived_at),
    home: [...playersById.values()].filter((p) => p.team_id === teams?.home.id && !inLineup.has(p.id) && !p.archived_at),
  }

  // Runners currently on base, resolved to players.
  const runnersOnBase = {
    first: live.bases.first ? playersById.get(live.bases.first) ?? null : null,
    second: live.bases.second ? playersById.get(live.bases.second) ?? null : null,
    third: live.bases.third ? playersById.get(live.bases.third) ?? null : null,
  }

  // Pitch chips for the current at-bat (since the last PA-ending / boundary event).
  const abPitches = currentAbPitches(events)

  return {
    game,
    teams,
    lineups: currentLineups,
    events,
    live,
    firstPitchAt,
    loading,
    error,
    act,
    undo,
    currentBatter,
    onDeck,
    currentPitcher,
    currentPitcherPitches,
    bench,
    runnersOnBase,
    playersById,
    abPitches,
    editPlayer,
    fillGenericLineup,
    fillLineupFromRoster,
    deleteEvent,
  }
}

// Returns the pitch chips (S/B/F) for the in-progress at-bat.
function currentAbPitches(events: GameEventRow[]): ('S' | 'B' | 'F')[] {
  const chips: ('S' | 'B' | 'F')[] = []
  for (let i = events.length - 1; i >= 0; i--) {
    const t = events[i].event_type
    if (PITCH_TYPES.includes(t)) {
      if (t === 'pitch_strike') chips.unshift('S')
      else if (t === 'pitch_ball') chips.unshift('B')
      else if (t === 'pitch_foul') chips.unshift('F')
    } else if (PA_ENDING.includes(t) || t === 'inning_change' || t === 'game_start') {
      break
    }
  }
  return chips
}

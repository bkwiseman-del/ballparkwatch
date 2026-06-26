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

export function useScorer(gameId: string | undefined) {
  const [game, setGame] = useState<Game | null>(null)
  const [teams, setTeams] = useState<Teams | null>(null)
  const [lineups, setLineups] = useState<Lineups>({ away: [], home: [] })
  const [playersById, setPlayersById] = useState<Map<string, Player>>(new Map())
  const [events, setEvents] = useState<GameEventRow[]>([])
  const [live, setLive] = useState<LiveGame>(INITIAL_LIVE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)

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
          supabase.from('game_events').select('seq,event_type,payload').eq('game_id', gameId).order('seq'),
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
      const rows = (evs ?? []) as GameEventRow[]
      setEvents(rows)
      setLive(project(rows))
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
    },
    [gameId],
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
      const seq = (events.at(-1)?.seq ?? 0) + 1
      const batter_id = currentBatter?.id ?? null
      const row: GameEventRow = { seq, event_type, payload, batter_id }
      const nextEvents = [...events, row]
      const nextLive = project(nextEvents)
      setEvents(nextEvents)
      setLive(nextLive)
      const { error: insErr } = await supabase.from('game_events').insert({
        game_id: gameId,
        seq,
        event_type,
        payload,
        inning: nextLive.inning,
        half: nextLive.half,
        batter_id: currentBatter?.id ?? null,
      })
      if (insErr) {
        setError(insErr.message)
        // roll back optimistic state
        setEvents(events)
        setLive(project(events))
        return
      }
      await persist(nextLive)
    },
    [gameId, events, persist, currentBatter],
  )

  // Undo: remove the last event, re-project, persist.
  const undo = useCallback(async () => {
    const last = events.at(-1)
    if (!gameId || !last) return
    const nextEvents = events.slice(0, -1)
    const nextLive = project(nextEvents)
    setEvents(nextEvents)
    setLive(nextLive)
    const { error: delErr } = await supabase
      .from('game_events')
      .delete()
      .eq('game_id', gameId)
      .eq('seq', last.seq)
    if (delErr) {
      setError(delErr.message)
      return
    }
    await persist(nextLive)
  }, [gameId, events, persist])

  // Fielding team's current pitcher (projected lineup player at position P).
  const fieldingKey = live.half === 'top' ? 'home' : 'away'
  const fieldingLineup = currentLineups[fieldingKey]
  const currentPitcher =
    fieldingLineup.find((p) => (p.position ?? p.default_position) === 'P') ?? null
  // Pitch count for THIS pitcher (since they entered).
  const currentPitcherPitches = pitchesSince(events, fieldingKey, currentPitcherEntrySeq(events, fieldingKey))

  // Bench: roster players not currently in either lineup.
  const inLineup = new Set([...currentLineups.away, ...currentLineups.home].map((p) => p.id))
  const bench = {
    away: [...playersById.values()].filter((p) => p.team_id === teams?.away.id && !inLineup.has(p.id)),
    home: [...playersById.values()].filter((p) => p.team_id === teams?.home.id && !inLineup.has(p.id)),
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

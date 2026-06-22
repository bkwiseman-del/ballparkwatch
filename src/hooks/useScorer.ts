import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Game, Team } from '@/lib/types'
import {
  INITIAL_LIVE,
  project,
  type EventType,
  type GameEventRow,
  type LiveGame,
} from '@/lib/engine'
import { gameChannelName } from '@/lib/realtime'

type Teams = { away: Team; home: Team }

export function useScorer(gameId: string | undefined) {
  const [game, setGame] = useState<Game | null>(null)
  const [teams, setTeams] = useState<Teams | null>(null)
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
      const [{ data: away }, { data: home }, { data: evs }] = await Promise.all([
        supabase.from('teams').select('*').eq('id', g.away_team_id).single(),
        supabase.from('teams').select('*').eq('id', g.home_team_id).single(),
        supabase.from('game_events').select('seq,event_type,payload').eq('game_id', gameId).order('seq'),
      ])
      if (cancelled) return
      setGame(g as Game)
      if (away && home) setTeams({ away: away as Team, home: home as Team })
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

  // Append an event, re-project, persist.
  const act = useCallback(
    async (event_type: EventType, payload: Record<string, unknown> = {}) => {
      if (!gameId) return
      const seq = (events.at(-1)?.seq ?? 0) + 1
      const row: GameEventRow = { seq, event_type, payload }
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
    [gameId, events, persist],
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

  return { game, teams, events, live, loading, error, act, undo }
}

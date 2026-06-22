import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Scorebug } from '@/components/Scorebug'
import { resolveCode } from '@/lib/scoreboard'
import { INITIAL_LIVE, type LiveGame } from '@/lib/engine'
import { gameChannelName } from '@/lib/realtime'

type PublicGame = {
  id: string
  status: 'scheduled' | 'live' | 'final'
  video_source: string
  away: { name: string; code: string | null }
  home: { name: string; code: string | null }
  snapshot: Partial<LiveGame>
}

export default function Watch() {
  const { gameId } = useParams()
  const [info, setInfo] = useState<PublicGame | null>(null)
  const [live, setLive] = useState<LiveGame>(INITIAL_LIVE)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)

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

    const ch = supabase.channel(gameChannelName(gameId))
    ch.on('broadcast', { event: 'state' }, ({ payload }) => {
      setLive({ ...INITIAL_LIVE, ...(payload as LiveGame) })
    })
      .subscribe((status) => setConnected(status === 'SUBSCRIBED'))

    return () => {
      cancelled = true
      supabase.removeChannel(ch)
    }
  }, [gameId])

  if (error) {
    return (
      <div className="flex min-h-full items-center justify-center bg-night-green p-6 text-center font-athletic text-muted-green">
        {error}
      </div>
    )
  }
  if (!info) {
    return (
      <div className="flex min-h-full items-center justify-center bg-night-green p-6 font-athletic text-muted-green">
        Loading…
      </div>
    )
  }

  const board = {
    away: { code: resolveCode(info.away.code, info.away.name), name: info.away.name, score: live.awayScore },
    home: { code: resolveCode(info.home.code, info.home.name), name: info.home.name, score: live.homeScore },
    inning: live.inning,
    half: live.half,
    balls: live.balls,
    strikes: live.strikes,
    outs: live.outs,
    runners: live.bases,
  }

  return (
    <div className="flex min-h-full flex-col items-center bg-night-green px-4 py-6 text-cream">
      {/* status row */}
      <div className="mb-6 flex w-full max-w-md items-center justify-between">
        {info.status === 'live' ? (
          <span className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-barn-red" />
            <span className="font-athletic text-sm font-semibold tracking-[.18em] text-barn-red">
              LIVE
            </span>
          </span>
        ) : (
          <span className="font-athletic text-sm tracking-[.18em] text-muted-green">
            {info.status === 'final' ? 'FINAL' : 'STARTING SOON'}
          </span>
        )}
        <span className="font-athletic text-xs tracking-[.12em] text-muted-green">
          {connected ? '● synced' : '○ connecting'}
        </span>
      </div>

      <p className="mb-4 text-center font-athletic text-sm uppercase tracking-[.14em] text-muted-green">
        {info.away.name} <span className="text-cream">at</span> {info.home.name}
      </p>

      {/* Hero scorebug (video player slots in above this in Phase 2) */}
      <div className="scale-110">
        <Scorebug state={board} variant="dark" />
      </div>

      {info.status === 'scheduled' && (
        <p className="mt-8 font-display text-2xl text-gold">First pitch soon</p>
      )}
      {info.status === 'final' && (
        <p className="mt-8 font-display text-3xl text-gold">FINAL</p>
      )}
    </div>
  )
}

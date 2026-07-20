import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { StagePreview } from '@/components/StagePreview'
import { SafeBoundary } from '@/components/SafeBoundary'
import { ScorebugBar } from '@/components/Scorebug'
import { ScorePanel } from '@/components/ScorePanel'
import type { ScoreboardState } from '@/lib/scoreboard'

// Watch-page video for phone-broadcast games on Amazon IVS: the viewer joins the game's stage as a
// SUBSCRIBE-only participant and watches the phone feed sub-second (WebRTC) — the same mechanism the
// scorer's setup preview uses. Scorebug rides Supabase Realtime (both real-time → naturally synced),
// so no timed-metadata cues are needed here. Shows the full scoreboard until real frames arrive.
export function PhoneStageVideo({
  gameId,
  board,
  attempt,
}: {
  gameId?: string
  board: ScoreboardState
  attempt: boolean // the game is live → worth joining the stage
}) {
  const [token, setToken] = useState<string | null>(null)
  const [live, setLive] = useState(false)

  useEffect(() => {
    if (!gameId || !attempt) {
      setToken(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await supabase.functions.invoke('stream-ivs', {
          body: { gameId, action: 'viewer-token' },
        })
        const t = (data as { token?: string; full?: boolean } | null)?.token ?? null
        if (!cancelled) setToken(t)
      } catch {
        if (!cancelled) setToken(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [gameId, attempt])

  if (!token) return <ScorePanel state={board} />
  return (
    <div>
      {/* keep the subscriber mounted (hidden) so it can attach + detect frames, like the phone WHEP flow */}
      <div className={live ? '' : 'hidden'}>
        <SafeBoundary fallback={null}>
          <StagePreview token={token} onLive={setLive} controls className="relative bg-black" />
        </SafeBoundary>
      </div>
      {live ? <ScorebugBar state={board} /> : <ScorePanel state={board} />}
    </div>
  )
}

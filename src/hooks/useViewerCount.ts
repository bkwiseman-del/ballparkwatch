import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// Live "N watching" head-count via Supabase Realtime presence — replaces the old peer-to-peer
// count (which only worked when viewers connected directly to the broadcasting phone; IVS viewers
// connect to Amazon, so the broadcaster can't see them). Every WATCH page tracks itself as a
// viewer on a dedicated presence topic; the scorer (and viewers) read the count. Works for EVERY
// game type — phone, external camera, multi-angle, and even stats-only games with no video.
//
// isViewer = true  → this client is a viewer: track presence (counts itself) + read the count.
// isViewer = false → operator/scorer: read the count only (never counted as a viewer).
export function useViewerCount(gameId: string | undefined, isViewer: boolean): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!gameId) return
    // Dedicated topic (not the game state/broadcast channel) so presence churn can't touch scoring.
    const ch = supabase.channel(`viewers:${gameId}`, {
      config: { presence: { key: crypto.randomUUID() } },
    })
    const recount = () => {
      const state = ch.presenceState<{ role?: string }>()
      let n = 0
      for (const key in state) for (const p of state[key]) if (p.role === 'viewer') n++
      setCount(n)
    }
    ch.on('presence', { event: 'sync' }, recount)
      .on('presence', { event: 'join' }, recount)
      .on('presence', { event: 'leave' }, recount)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && isViewer) void ch.track({ role: 'viewer' })
      })
    return () => {
      supabase.removeChannel(ch)
    }
  }, [gameId, isViewer])
  return count
}

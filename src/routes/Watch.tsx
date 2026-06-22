import { useParams } from 'react-router-dom'

// Phase 1: public viewer. Renders the correct video player (or stats-only),
// overlays the HTML scorebug, subscribes to game_state via Realtime, and applies
// updates through a stat_delay_ms buffer. Placeholder shell for Phase 0.
export default function Watch() {
  const { gameId } = useParams()
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-night-green p-6 text-center text-cream">
      <p className="font-athletic uppercase tracking-[0.18em] text-muted-green">Ballpark Watch</p>
      <p className="mb-4 font-data text-sm text-muted-green">{gameId}</p>
      <p className="font-display text-2xl">Viewer — Phase 1</p>
    </div>
  )
}

import { Link, useParams } from 'react-router-dom'

// Phase 1: this becomes the scoring cockpit (scoreboard header, batter strip,
// field, undo strip, BALL/STRIKE/FOUL/IN PLAY action zone) writing game_events
// and upserting game_state. Placeholder shell for Phase 0.
export default function Score() {
  const { gameId } = useParams()
  return (
    <div className="flex min-h-full flex-col bg-night-green text-cream">
      <header className="flex items-center justify-between border-b-2 border-gold bg-field-green px-4 py-3">
        <h1 className="font-display text-xl text-cream">Scorer Console</h1>
        <Link to="/setup" className="font-athletic uppercase tracking-wide text-sm text-gold">
          ← Setup
        </Link>
      </header>
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <div>
          <p className="font-athletic uppercase tracking-[0.18em] text-muted-green">Game</p>
          <p className="mb-4 font-data text-sm text-muted-green">{gameId}</p>
          <p className="font-display text-2xl">Scoring console — Phase 1</p>
        </div>
      </div>
    </div>
  )
}

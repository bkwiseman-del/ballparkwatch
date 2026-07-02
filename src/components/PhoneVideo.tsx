import { useEffect, useRef, useState } from 'react'
import type { ScoreboardState } from '@/lib/scoreboard'
import { attachWhep } from '@/lib/whip'
import { ScorePanel } from '@/components/ScorePanel'
import { ScorebugBar } from '@/components/Scorebug'

// Watch-page video for phone-broadcast games — RECEIVE ONLY. The broadcaster publishes
// to Cloudflare Stream (WHIP); viewers here play it sub-second via WHEP, falling back to
// HLS (native on Safari) if the WebRTC play can't establish. When nobody's broadcasting,
// we show the full scoreboard.
//
// Liveness is decoupled from the heartbeat: we ATTEMPT the WHEP feed whenever the game is
// live (or the heartbeat says so) and REVEAL the player as soon as real frames arrive
// (`playing`). So a working Cloudflare feed is never hidden by a missed/stale heartbeat —
// the video element stays mounted (hidden) while connecting so WHEP can detect frames.
export function PhoneVideo({
  gameId: _gameId,
  board,
  live,
  attempt,
  whepUrl,
  hlsUrl,
}: {
  gameId?: string
  board: ScoreboardState
  live: boolean // broadcaster heartbeat is fresh
  attempt?: boolean // the game is live → worth trying the feed even if the heartbeat lags
  whepUrl?: string | null
  hlsUrl?: string | null
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)

  const tryConnect = !!whepUrl && (live || !!attempt)
  useEffect(() => {
    const el = videoRef.current
    if (!tryConnect || !el || !whepUrl) {
      setPlaying(false)
      return
    }
    // Reconnecting WHEP: survives the stream dropping and resuming on the same url.
    return attachWhep(el, whepUrl, { hlsUrl, onPlaying: setPlaying })
  }, [tryConnect, whepUrl, hlsUrl])

  // Show the player once we actually have a picture, or the heartbeat confirms live.
  const showPlayer = !!whepUrl && (playing || live)

  if (tryConnect) {
    return (
      <div>
        {/* Video stays mounted so WHEP can attach + detect frames, but hidden until we
            have a picture (or the heartbeat confirms live) — otherwise show the scoreboard. */}
        <div className={`relative bg-black ${showPlayer ? '' : 'hidden'}`}>
          <video ref={videoRef} autoPlay playsInline controls className="aspect-video w-full bg-black object-contain" />
          {!playing && (
            <p className="absolute inset-0 flex items-center justify-center font-data text-xs text-cream/70">
              Connecting to the live feed…
            </p>
          )}
        </div>
        {showPlayer ? <ScorebugBar state={board} /> : <ScorePanel state={board} />}
      </div>
    )
  }

  return <ScorePanel state={board} />
}

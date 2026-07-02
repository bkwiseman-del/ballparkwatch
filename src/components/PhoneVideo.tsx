import { useEffect, useRef, useState } from 'react'
import type { ScoreboardState } from '@/lib/scoreboard'
import { attachWhep } from '@/lib/whip'
import { ScorePanel } from '@/components/ScorePanel'
import { ScorebugBar } from '@/components/Scorebug'

// Watch-page video for phone-broadcast games — RECEIVE ONLY. The broadcaster publishes
// to Cloudflare Stream (WHIP); viewers here play it sub-second via WHEP, falling back to
// HLS (native on Safari) if the WebRTC play can't establish. When nobody's broadcasting,
// we show the full scoreboard. `live` comes from the broadcaster's presence heartbeat.
export function PhoneVideo({
  gameId: _gameId,
  board,
  live,
  whepUrl,
  hlsUrl,
}: {
  gameId?: string
  board: ScoreboardState
  live: boolean
  whepUrl?: string | null
  hlsUrl?: string | null
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    const el = videoRef.current
    if (!live || !whepUrl || !el) {
      setPlaying(false)
      return
    }
    // Reconnecting WHEP: survives the stream dropping and resuming on the same url.
    return attachWhep(el, whepUrl, { hlsUrl, onPlaying: setPlaying })
  }, [live, whepUrl, hlsUrl])

  // While live, render the player (with a connecting note until the first frame lands).
  if (live && whepUrl) {
    return (
      <div>
        <div className="relative bg-black">
          <video ref={videoRef} autoPlay playsInline controls className="aspect-video w-full bg-black object-contain" />
          {!playing && (
            <p className="absolute inset-0 flex items-center justify-center font-data text-xs text-cream/70">
              Connecting to the live feed…
            </p>
          )}
        </div>
        <ScorebugBar state={board} />
      </div>
    )
  }

  return (
    <>
      <ScorePanel state={board} />
      {live && (
        <p className="border-b-2 border-gold bg-[#122019] px-4 py-2 text-center font-data text-xs text-cream/80">
          Connecting to the live phone feed…
        </p>
      )}
    </>
  )
}

import { useEffect, useRef } from 'react'
import type { ScoreboardState } from '@/lib/scoreboard'
import { usePhoneVideo } from '@/lib/phoneVideo'
import { ScorePanel } from '@/components/ScorePanel'
import { ScorebugBar } from '@/components/Scorebug'

// Watch-page video for "another phone" games — RECEIVE ONLY. Viewers can't
// broadcast; the scorer controls that via a private broadcaster link/QR. Shows
// the live peer-to-peer feed with the scorebug overlaid when someone is filming,
// otherwise the full scoreboard with a small status line.
export function PhoneVideo({ gameId, board }: { gameId?: string; board: ScoreboardState }) {
  const v = usePhoneVideo(gameId, true)
  const remoteRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (remoteRef.current) remoteRef.current.srcObject = v.incoming
  }, [v.incoming])

  if (v.incoming) {
    return (
      <div className="relative bg-black">
        <video
          ref={remoteRef}
          autoPlay
          playsInline
          controls
          className="aspect-video w-full bg-black object-contain"
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
          <ScorebugBar state={board} />
        </div>
      </div>
    )
  }

  return (
    <>
      <ScorePanel state={board} />
      {v.isLive && (
        <p className="border-b-2 border-gold bg-[#122019] px-4 py-2 text-center font-data text-xs text-cream/80">
          Connecting to the live phone feed…
        </p>
      )}
    </>
  )
}

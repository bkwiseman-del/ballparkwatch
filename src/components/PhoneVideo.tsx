import { useEffect, useRef } from 'react'
import type { ScoreboardState } from '@/lib/scoreboard'
import { usePhoneVideo } from '@/lib/phoneVideo'
import { ScorePanel } from '@/components/ScorePanel'
import { ScorebugBar } from '@/components/Scorebug'
import { CameraIcon } from '@/components/Icons'

// Watch-page video area for "another phone" games: shows the live peer-to-peer
// feed (with the scorebug overlaid) when someone is broadcasting, and a Go Live
// control so any viewer can become the camera. Falls back to the full scoreboard
// when no one is filming.
export function PhoneVideo({ gameId, board }: { gameId?: string; board: ScoreboardState }) {
  const v = usePhoneVideo(gameId, true)
  const remoteRef = useRef<HTMLVideoElement>(null)
  const localRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (remoteRef.current) remoteRef.current.srcObject = v.incoming
  }, [v.incoming])
  useEffect(() => {
    if (localRef.current) localRef.current.srcObject = v.local
  }, [v.local])

  const showingVideo = v.isBroadcasting || !!v.incoming

  if (showingVideo) {
    return (
      <div className="relative bg-black">
        {v.isBroadcasting ? (
          <video ref={localRef} autoPlay playsInline muted className="aspect-video w-full object-cover" />
        ) : (
          <video
            ref={remoteRef}
            autoPlay
            playsInline
            controls
            className="aspect-video w-full bg-black object-contain"
          />
        )}

        {/* broadcast bug */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
          <ScorebugBar state={board} />
        </div>

        {/* broadcaster controls */}
        {v.isBroadcasting && (
          <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-black/40 px-3 py-1.5">
            <span className="flex items-center gap-2 font-athletic text-xs uppercase tracking-wide text-cream">
              <span className="h-2 w-2 animate-pulse rounded-full bg-barn-red" />
              You’re live · {v.viewers} watching
            </span>
            <button
              onClick={v.stop}
              className="pointer-events-auto bg-barn-red px-3 py-1 font-display text-sm text-cream"
            >
              Stop
            </button>
          </div>
        )}
      </div>
    )
  }

  // Nobody filming (or feed still connecting): full scoreboard + Go Live.
  return (
    <>
      <ScorePanel state={board} />
      <div className="flex items-center justify-between gap-2 border-b-2 border-gold bg-[#122019] px-4 py-2.5">
        <span className="font-data text-xs text-cream/80">
          {v.isLive ? 'Connecting to the live phone feed…' : 'No one is filming yet.'}
        </span>
        <button
          onClick={v.goLive}
          className="inline-flex items-center gap-1.5 bg-board-green px-3 py-1.5 font-athletic text-sm font-semibold uppercase tracking-wide text-cream"
        >
          <CameraIcon className="h-4 w-4" />
          Go live
        </button>
      </div>
      {v.error && <p className="bg-barn-red/15 px-4 py-1 font-data text-xs text-barn-red">{v.error}</p>}
    </>
  )
}

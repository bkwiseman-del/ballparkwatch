import { useEffect, useRef, useState } from 'react'
import {
  create as createPlayer,
  isPlayerSupported,
  PlayerEventType,
  PlayerState,
  type TextMetadataCue,
} from 'amazon-ivs-player'
import wasmBinary from 'amazon-ivs-player/dist/assets/amazon-ivs-wasmworker.min.wasm?url'
import wasmWorker from 'amazon-ivs-player/dist/assets/amazon-ivs-wasmworker.min.js?url'
import type { ScoreboardState } from '@/lib/scoreboard'
import { ScorePanel } from '@/components/ScorePanel'
import { ScorebugBar } from '@/components/Scorebug'

// Compact scorebug cue the scorer injects via IVS put-metadata (see Score.tsx). It rides the
// video in-band (timed_id3), so it reaches the viewer frame-synced to the delayed camera feed.
export type ScoreCue = {
  s: number // reached event seq
  a: number
  h: number // scores
  i: number
  hf: 0 | 1 // inning, half (0 = top)
  b: number
  k: number
  o: number // balls, strikes, outs
  r: [boolean, boolean, boolean] // bases occupied
  st: string // status
}

// Watch-page video for external-camera games on Amazon IVS: plays the low-latency channel HLS
// through the IVS player and surfaces the scorer's timed-metadata cues (TEXT_METADATA_CUE), which
// drive the frame-synced scorebug/commentary in Watch. Falls back to the scoreboard until frames
// arrive (channel is only live while the game's recording composition runs).
export function IvsChannelVideo({
  playbackUrl,
  board,
  onCue,
}: {
  playbackUrl?: string | null
  board: ScoreboardState
  onCue?: (cue: ScoreCue) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const onCueRef = useRef(onCue)
  onCueRef.current = onCue
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    const el = videoRef.current
    if (!playbackUrl || !el || !isPlayerSupported) {
      setPlaying(false)
      return
    }
    const player = createPlayer({ wasmBinary, wasmWorker })
    player.attachHTMLVideoElement(el)
    player.setAutoplay(true)
    player.load(playbackUrl)

    const cueHandler = (cue: TextMetadataCue) => {
      if (!cue?.text) return
      try {
        onCueRef.current?.(JSON.parse(cue.text) as ScoreCue)
      } catch {
        /* not one of our scorebug cues */
      }
    }
    const onPlaying = () => setPlaying(true)
    const onEnded = () => setPlaying(false)
    player.addEventListener(PlayerEventType.TEXT_METADATA_CUE, cueHandler)
    player.addEventListener(PlayerState.PLAYING, onPlaying)
    player.addEventListener(PlayerState.ENDED, onEnded)

    return () => {
      player.removeEventListener(PlayerEventType.TEXT_METADATA_CUE, cueHandler)
      player.removeEventListener(PlayerState.PLAYING, onPlaying)
      player.removeEventListener(PlayerState.ENDED, onEnded)
      player.delete()
    }
  }, [playbackUrl])

  if (!playbackUrl) return <ScorePanel state={board} />
  return (
    <div>
      <div className={`relative bg-black ${playing ? '' : 'hidden'}`}>
        <video ref={videoRef} playsInline controls className="aspect-video w-full bg-black object-contain" />
        {!playing && (
          <p className="absolute inset-0 flex items-center justify-center font-data text-xs text-cream/70">
            Connecting to the live feed…
          </p>
        )}
      </div>
      {playing ? <ScorebugBar state={board} /> : <ScorePanel state={board} />}
    </div>
  )
}

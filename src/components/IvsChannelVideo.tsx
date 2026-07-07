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
    // Guard the whole init — the IVS player spins up a Web Worker + WASM; a failure here must
    // degrade to the scoreboard, never bubble up and blank the page.
    let player: ReturnType<typeof createPlayer> | null = null
    let retryTimer: number | undefined
    const cueHandler = (cue: TextMetadataCue) => {
      if (!cue?.text) return
      try {
        onCueRef.current?.(JSON.parse(cue.text) as ScoreCue)
      } catch {
        /* not one of our scorebug cues */
      }
    }
    const onReadyOrPlaying = () => {
      setPlaying(true)
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = undefined
      }
    }
    const onEnded = () => setPlaying(false)
    // Right after Start Game the channel takes ~10-15s to go live, so the master playlist 404s.
    // Keep re-loading until segments exist (the "Connecting…" state shows meanwhile) instead of
    // letting the player give up — that's why the first test "took a while" to appear.
    const onError = (err: unknown) => {
      console.warn('[IvsChannelVideo] player error, retrying load:', err)
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = window.setTimeout(() => {
        try {
          player?.load(playbackUrl)
        } catch {
          /* torn down */
        }
      }, 3000)
    }
    try {
      player = createPlayer({ wasmBinary, wasmWorker })
      player.attachHTMLVideoElement(el)
      player.setMuted(true) // muted so the browser allows autoplay (viewer can unmute via controls)
      player.setAutoplay(true)
      player.load(playbackUrl)
      player.addEventListener(PlayerEventType.TEXT_METADATA_CUE, cueHandler)
      // Reveal on READY (not just PLAYING) so a play control is available if autoplay is blocked.
      player.addEventListener(PlayerState.READY, onReadyOrPlaying)
      player.addEventListener(PlayerState.PLAYING, onReadyOrPlaying)
      player.addEventListener(PlayerState.ENDED, onEnded)
      player.addEventListener(PlayerEventType.ERROR, onError)
    } catch (e) {
      console.error('[IvsChannelVideo] player init failed:', e)
      setPlaying(false)
    }

    return () => {
      if (retryTimer) clearTimeout(retryTimer)
      if (!player) return
      try {
        player.removeEventListener(PlayerEventType.TEXT_METADATA_CUE, cueHandler)
        player.removeEventListener(PlayerState.READY, onReadyOrPlaying)
        player.removeEventListener(PlayerState.PLAYING, onReadyOrPlaying)
        player.removeEventListener(PlayerState.ENDED, onEnded)
        player.removeEventListener(PlayerEventType.ERROR, onError)
        player.delete()
      } catch {
        /* already torn down */
      }
    }
  }, [playbackUrl])

  if (!playbackUrl) return <ScorePanel state={board} />
  return (
    <div>
      <div className={`relative bg-black ${playing ? '' : 'hidden'}`}>
        <video ref={videoRef} playsInline muted autoPlay controls className="aspect-video w-full bg-black object-contain" />
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

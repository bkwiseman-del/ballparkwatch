import { useEffect, useRef, useState } from 'react'
import type { ScoreboardState } from '@/lib/scoreboard'
import { whepPlay, type RtcSession } from '@/lib/whip'
import { attachHls } from '@/lib/hls'
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
    let session: RtcSession | null = null
    let detachHls: (() => void) | null = null
    let cancelled = false

    // HLS fallback (hls.js / native) if the sub-second WebRTC play can't establish.
    const fallbackToHls = () => {
      if (cancelled || !hlsUrl || !el) return
      el.srcObject = null
      detachHls = attachHls(el, hlsUrl)
      el.play().catch(() => {})
      setPlaying(true)
    }

    console.info('[stream] viewer playing WHEP', whepUrl)
    whepPlay(
      whepUrl,
      (stream) => {
        if (cancelled) return
        console.info('[stream] WHEP track received')
        el.srcObject = stream
        el.play().catch(() => {})
        setPlaying(true)
      },
      (s) => console.info('[stream] WHEP connection state:', s),
    )
      .then((s) => {
        if (cancelled) s.close()
        else session = s
      })
      .catch((e) => {
        console.error('[stream] WHEP failed, trying HLS:', e)
        fallbackToHls()
      })

    return () => {
      cancelled = true
      session?.close()
      detachHls?.()
      if (el) {
        el.srcObject = null
        el.removeAttribute('src')
      }
      setPlaying(false)
    }
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

import { useEffect, useState, type RefObject } from 'react'
import { SoundOnIcon, SoundOffIcon, FullscreenIcon, PipIcon } from '@/components/Icons'

// Overlay controls for a LIVE WebRTC feed (phone / multi-angle). A live MediaStream isn't seekable,
// so there's no scrub/play-pause — just the three things a viewer actually wants:
//   • mute/unmute the VIDEO's own audio, INDEPENDENT of the AI-commentary toggle (so you can mute
//     commentary and keep the game audio, or vice-versa), #7
//   • fullscreen / expand,
//   • picture-in-picture (pop the video out) where the browser supports it. #6
// (True casting — Chromecast/AirPlay — isn't reliably available for WebRTC MediaStreams, so it's
// intentionally omitted rather than shown broken.)
export function LiveVideoControls({
  videoRef,
  muted,
  onToggleMute,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  muted: boolean
  onToggleMute: () => void
}) {
  const [pipOn, setPipOn] = useState(false)
  const pipSupported = typeof document !== 'undefined' && (document as Document).pictureInPictureEnabled

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const enter = () => setPipOn(true)
    const leave = () => setPipOn(false)
    v.addEventListener('enterpictureinpicture', enter)
    v.addEventListener('leavepictureinpicture', leave)
    return () => {
      v.removeEventListener('enterpictureinpicture', enter)
      v.removeEventListener('leavepictureinpicture', leave)
    }
  }, [videoRef])

  const fullscreen = () => {
    const v = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    if (!v) return
    // iOS Safari only fullscreens the <video> itself (webkitEnterFullscreen); everyone else supports
    // the standard requestFullscreen on the element.
    if (v.requestFullscreen) void v.requestFullscreen().catch(() => {})
    else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen()
  }

  const togglePip = async () => {
    const v = videoRef.current
    if (!v) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else await v.requestPictureInPicture()
    } catch {
      /* PiP unavailable / blocked */
    }
  }

  const btn = 'border-2 border-cream/40 bg-ink/70 p-1.5 text-cream/90'
  return (
    <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
      <button onClick={onToggleMute} aria-label={muted ? 'Unmute game audio' : 'Mute game audio'} className={btn}>
        {muted ? <SoundOffIcon className="h-4 w-4" /> : <SoundOnIcon className="h-4 w-4" />}
      </button>
      {pipSupported && (
        <button onClick={togglePip} aria-label={pipOn ? 'Exit picture-in-picture' : 'Picture-in-picture'} className={btn}>
          <PipIcon className="h-4 w-4" />
        </button>
      )}
      <button onClick={fullscreen} aria-label="Fullscreen" className={btn}>
        <FullscreenIcon className="h-4 w-4" />
      </button>
    </div>
  )
}

import { useEffect, useRef, useState, type RefObject } from 'react'

// Branded replacement for the browser's native <video> controls (which can't be styled). Drives an
// existing <video> element via its ref: play/pause, a scrub track with the BASEBALL (ball.png) as
// the handle — rolling as it moves — a gold "played" fill over a muted "buffered" fill, M:SS time,
// and fullscreen. Flat, hard-cornered, cream/ink/gold — "vintage athletic, rendered flat."
export function BrandedVideoControls({ videoRef }: { videoRef: RefObject<HTMLVideoElement | null> }) {
  const [playing, setPlaying] = useState(false)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [dragging, setDragging] = useState(false)
  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onTime = () => {
      if (!draggingRef.current) setCur(v.currentTime)
    }
    const onDur = () => setDur(isFinite(v.duration) ? v.duration : 0)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onProgress = () => {
      try {
        setBuffered(v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0)
      } catch {
        /* buffered not ready */
      }
    }
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('durationchange', onDur)
    v.addEventListener('loadedmetadata', onDur)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('progress', onProgress)
    onDur()
    onProgress()
    setPlaying(!v.paused)
    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('durationchange', onDur)
      v.removeEventListener('loadedmetadata', onDur)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('progress', onProgress)
    }
  }, [videoRef])

  const pct = dur ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0
  const bufPct = dur ? Math.min(100, (buffered / dur) * 100) : 0

  const seekTo = (clientX: number) => {
    const el = trackRef.current
    const v = videoRef.current
    if (!el || !v || !dur) return
    const rect = el.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const t = ratio * dur
    setCur(t)
    v.currentTime = t
  }
  const onPointerDown = (e: React.PointerEvent) => {
    draggingRef.current = true
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
    seekTo(e.clientX)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (draggingRef.current) seekTo(e.clientX)
  }
  const onPointerUp = (e: React.PointerEvent) => {
    draggingRef.current = false
    setDragging(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) void v.play().catch(() => {})
    else v.pause()
  }
  const fullscreen = () => {
    const v = videoRef.current
    // iOS Safari only exposes fullscreen on the video element itself (webkit API).
    const anyV = v as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    if (anyV?.requestFullscreen) void anyV.requestFullscreen().catch(() => {})
    else anyV?.webkitEnterFullscreen?.()
  }

  const fmt = (s: number) => {
    if (!isFinite(s) || s < 0) s = 0
    const m = Math.floor(s / 60)
    const ss = Math.floor(s % 60)
    return `${m}:${String(ss).padStart(2, '0')}`
  }

  return (
    <div className="flex items-center gap-3 border-x-2 border-b-2 border-ink bg-ink px-3 py-2 text-cream select-none">
      <button onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} className="shrink-0 text-gold">
        {playing ? (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <rect x="5" y="4" width="5" height="16" />
            <rect x="14" y="4" width="5" height="16" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M6 4l14 8-14 8z" />
          </svg>
        )}
      </button>

      <span className="shrink-0 font-data text-xs tabular-nums text-cream">{fmt(cur)}</span>

      {/* scrub track — flat cream rail, muted buffered fill, gold played fill, baseball handle */}
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="relative h-2.5 flex-1 cursor-pointer bg-cream/20"
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.floor(dur)}
        aria-valuenow={Math.floor(cur)}
      >
        <div className="absolute inset-y-0 left-0 bg-cream/25" style={{ width: `${bufPct}%` }} />
        <div className="absolute inset-y-0 left-0 bg-gold" style={{ width: `${pct}%` }} />
        {/* baseball playhead — rotates as it travels for a "rolling" feel */}
        <img
          src="/ball.png"
          alt=""
          draggable={false}
          className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 transition-transform"
          style={{
            left: `${pct}%`,
            transform: `translate(-50%, -50%) rotate(${cur * 40}deg) scale(${dragging ? 1.3 : 1})`,
          }}
        />
      </div>

      <span className="shrink-0 font-data text-xs tabular-nums text-muted-green">{fmt(dur)}</span>

      <button onClick={fullscreen} aria-label="Fullscreen" className="shrink-0 text-cream/80">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        </svg>
      </button>
    </div>
  )
}

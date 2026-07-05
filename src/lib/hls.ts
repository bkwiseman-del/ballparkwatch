import Hls from 'hls.js'

// Attach an HLS manifest to a <video>: native where supported (Safari/iOS), hls.js
// everywhere else (Chrome/Firefox/Android). Returns a cleanup that detaches/destroys.
// Used for the Cloudflare Stream VOD replay and the live HLS fallback.
// lowLatency: only for the LIVE HLS fallback. It must be OFF for VOD replay — enabling it
// on a finished (VOD) manifest makes hls.js chase a "live edge" that doesn't exist, causing
// constant playlist reloads / seeks (the "plays a second then reloads, flashing black" bug).
export function attachHls(
  video: HTMLVideoElement,
  url: string,
  // onVideoClock (live only): reports the REAL-WORLD wall-clock time (ms) the currently-shown
  // frame was captured, from HLS EXT-X-PROGRAM-DATE-TIME. This is how the scorebug syncs to the
  // exact video moment (like GameChanger) — no manual delay, self-correcting through drift and
  // pauses/seeks. Fires on an interval; the caller falls back to a manual delay if it never does.
  opts?: { onError?: () => void; lowLatency?: boolean; onVideoClock?: (dateMs: number) => void },
): () => void {
  const wantClock = !!(opts?.lowLatency && opts?.onVideoClock)
  const sane = (ms: number) => isFinite(ms) && ms > 1_000_000_000_000 // after 2001, i.e. a real date

  // Safari & iOS play HLS natively — just set src.
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url
    const onErr = () => opts?.onError?.()
    video.addEventListener('error', onErr)
    // Native HLS: getStartDate() is the stream's PROGRAM-DATE-TIME anchor; + currentTime = the
    // wall-clock of the frame on screen.
    const clkTimer = wantClock
      ? window.setInterval(() => {
          const start = (video as HTMLVideoElement & { getStartDate?: () => Date }).getStartDate?.()
          const base = start ? start.getTime() : NaN
          const ms = base + video.currentTime * 1000
          if (sane(ms)) opts!.onVideoClock!(ms)
        }, 1000)
      : undefined
    return () => {
      if (clkTimer) window.clearInterval(clkTimer)
      video.removeEventListener('error', onErr)
      video.removeAttribute('src')
      video.load()
    }
  }
  if (Hls.isSupported()) {
    const hls = new Hls({ enableWorker: true, lowLatencyMode: !!opts?.lowLatency })
    hls.loadSource(url)
    hls.attachMedia(video)
    let mediaRecover = 0
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return
      // Try to recover a media/decode glitch a couple of times before giving up (which,
      // for the VOD replay, hands off to the Supabase copy via onError).
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecover < 2) {
        mediaRecover++
        hls.recoverMediaError()
        return
      }
      opts?.onError?.()
    })
    // hls.js exposes `playingDate` — the Date of the frame at the playhead, from PROGRAM-DATE-TIME.
    const clkTimer = wantClock
      ? window.setInterval(() => {
          const d = (hls as unknown as { playingDate?: Date | null }).playingDate
          const ms = d ? d.getTime() : NaN
          if (sane(ms)) opts!.onVideoClock!(ms)
        }, 1000)
      : undefined
    return () => {
      if (clkTimer) window.clearInterval(clkTimer)
      try {
        hls.destroy()
      } catch {
        /* ignore */
      }
    }
  }
  // Last resort: set src and hope the browser copes.
  video.src = url
  return () => video.removeAttribute('src')
}

export const isHlsUrl = (url: string | null | undefined): boolean => !!url && url.includes('.m3u8')

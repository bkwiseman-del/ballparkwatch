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
  // onVideoClock (live only): reports the REAL-WORLD wall-clock (ms) of the frame on screen, so
  // the scorebug + commentary sync to the exact video moment (like GameChanger) with no manual
  // delay. Preferred source is HLS PROGRAM-DATE-TIME; Cloudflare's live HLS DOESN'T carry it, so
  // we fall back to deriving it from the player's live latency: clock ≈ now − (edge − playhead).
  // Self-correcting through drift; fires on an interval; caller falls back to a manual delay if
  // it never fires at all.
  opts?: { onError?: () => void; lowLatency?: boolean; onVideoClock?: (dateMs: number) => void },
): () => void {
  const wantClock = !!(opts?.lowLatency && opts?.onVideoClock)
  const sane = (ms: number) => isFinite(ms) && ms > 1_000_000_000_000 // after 2001, i.e. a real date

  // Safari & iOS play HLS natively — just set src.
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url
    const onErr = () => opts?.onError?.()
    video.addEventListener('error', onErr)
    const clkTimer = wantClock
      ? window.setInterval(() => {
          // Prefer the PROGRAM-DATE-TIME anchor if present…
          const start = (video as HTMLVideoElement & { getStartDate?: () => Date }).getStartDate?.()
          if (start && !Number.isNaN(start.getTime())) {
            const ms = start.getTime() + video.currentTime * 1000
            if (sane(ms)) return opts!.onVideoClock!(ms)
          }
          // …otherwise derive from live latency (seekable edge − playhead).
          const s = video.seekable
          if (!s.length) return
          const lat = s.end(s.length - 1) - video.currentTime
          if (lat > 0.2 && lat < 120) opts!.onVideoClock!(Date.now() - lat * 1000)
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
    const clkTimer = wantClock
      ? window.setInterval(() => {
          const h = hls as unknown as { playingDate?: Date | null; latency?: number }
          // Prefer PROGRAM-DATE-TIME…
          if (h.playingDate && sane(h.playingDate.getTime())) return opts!.onVideoClock!(h.playingDate.getTime())
          // …otherwise derive from hls.js's measured live latency.
          const lat = h.latency
          if (typeof lat === 'number' && lat > 0.2 && lat < 120) opts!.onVideoClock!(Date.now() - lat * 1000)
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

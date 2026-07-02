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
  opts?: { onError?: () => void; lowLatency?: boolean },
): () => void {
  // Safari & iOS play HLS natively — just set src.
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url
    const onErr = () => opts?.onError?.()
    video.addEventListener('error', onErr)
    return () => {
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
    return () => {
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

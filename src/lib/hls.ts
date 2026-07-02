import Hls from 'hls.js'

// Attach an HLS manifest to a <video>: native where supported (Safari/iOS), hls.js
// everywhere else (Chrome/Firefox/Android). Returns a cleanup that detaches/destroys.
// Used for the Cloudflare Stream VOD replay and the live HLS fallback.
export function attachHls(video: HTMLVideoElement, url: string): () => void {
  // Safari & iOS play HLS natively — just set src.
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url
    return () => {
      video.removeAttribute('src')
      video.load()
    }
  }
  if (Hls.isSupported()) {
    const hls = new Hls({ enableWorker: true, lowLatencyMode: true })
    hls.loadSource(url)
    hls.attachMedia(video)
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

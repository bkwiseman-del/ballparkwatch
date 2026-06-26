// Parse the many shapes of a YouTube link into a video id we can embed.
// Supports: youtu.be/<id>, watch?v=<id>, /live/<id>, /embed/<id>, /shorts/<id>,
// and a bare 11-char id. Channel "/live" handle URLs (no id) aren't supported —
// the user should paste the share link of the actual live stream.
export function parseYouTubeId(input: string): string | null {
  const raw = (input ?? '').trim()
  if (!raw) return null
  if (/^[\w-]{11}$/.test(raw)) return raw

  let url: URL
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`)
  } catch {
    return null
  }

  const host = url.hostname.replace(/^www\./, '')
  if (host === 'youtu.be') {
    return idOrNull(url.pathname.slice(1))
  }
  if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    const v = url.searchParams.get('v')
    if (v) return idOrNull(v)
    const m = url.pathname.match(/^\/(?:live|embed|shorts)\/([\w-]{11})/)
    if (m) return m[1]
  }
  return null
}

function idOrNull(s: string): string | null {
  return /^[\w-]{11}$/.test(s) ? s : null
}

export function youTubeEmbedUrl(id: string, opts: { autoplay?: boolean } = {}): string {
  const p = new URLSearchParams({
    playsinline: '1',
    modestbranding: '1',
    rel: '0',
  })
  if (opts.autoplay) p.set('autoplay', '1')
  return `https://www.youtube.com/embed/${id}?${p.toString()}`
}

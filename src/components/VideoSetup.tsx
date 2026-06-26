import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { supabase } from '@/lib/supabase'
import { parseYouTubeId } from '@/lib/youtube'
import { useBroadcastStatus, type BroadcastStatus } from '@/lib/phoneVideo'
import { YouTubeEmbed } from '@/components/VideoEmbed'
import type { Game } from '@/lib/types'

// Per-game video setup. Reachable both from game setup (when a camera is picked)
// and from the live scorer. Branches by source:
//  • External camera → YouTube: paste the live link + calibrate the broadcast
//    delay so the viewer's scorebug matches the delayed video.
//  • Another phone: reveal the private broadcaster link/QR (only the scorer can
//    start a stream) and show live health while it's running.
export function VideoSetup({
  game,
  onClose,
  onSaved,
}: {
  game: Game
  onClose: () => void
  onSaved?: (patch: { stat_delay_ms: number; video_config: Record<string, unknown> }) => void
}) {
  const isYouTube = game.video_source === 'youtube'
  const isPhone = game.video_source === 'phone_whip'
  const status = useBroadcastStatus(game.id, isPhone)

  const [url, setUrl] = useState(String(game.video_config?.youtube_url ?? ''))
  const [delayMs, setDelayMs] = useState(game.stat_delay_ms ?? 0)
  const [armedAt, setArmedAt] = useState<number | null>(null)
  const [samples, setSamples] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const videoId = parseYouTubeId(url)
  const avg = samples.length ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : null

  function tap() {
    const now = performance.now()
    if (armedAt === null) setArmedAt(now)
    else {
      setSamples((s) => [...s, Math.max(0, Math.round(now - armedAt))])
      setArmedAt(null)
    }
  }

  function nudge(deltaMs: number) {
    setDelayMs((d) => Math.max(0, Math.min(30000, d + deltaMs)))
  }

  async function save() {
    setSaving(true)
    setErr(null)
    const cfg: Record<string, unknown> = { ...(game.video_config ?? {}) }
    const u = url.trim()
    if (u) cfg.youtube_url = u
    else delete cfg.youtube_url
    const { error } = await supabase
      .from('games')
      .update({ stat_delay_ms: delayMs, video_config: cfg })
      .eq('id', game.id)
    setSaving(false)
    if (error) return setErr(error.message)
    onSaved?.({ stat_delay_ms: delayMs, video_config: cfg })
    setSavedMsg('Saved ✓')
    window.setTimeout(() => setSavedMsg(null), 1800)
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-cream text-ink">
      <div className="flex shrink-0 items-center justify-between border-b-2 border-gold bg-ink px-4 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))]">
        <span className="font-display text-lg text-cream">
          {isPhone ? 'Phone broadcast' : 'Video & sync'}
        </span>
        <button onClick={onClose} className="font-athletic text-cream">
          Done
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isPhone ? (
          <PhoneBroadcastSection token={game.share_token} status={status} />
        ) : isYouTube ? (
          <>
            <section className="mb-6">
              <h3 className="mb-1 font-display text-lg">Live video link</h3>
              <p className="mb-2 font-data text-[12px] text-muted-tan">
                Go live from your GoPro/DJI (or phone) to an unlisted YouTube stream, then paste the
                link here.
              </p>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://youtu.be/…"
                className="w-full border-2 border-ink bg-white px-3 py-2 font-data outline-none focus:border-board-green"
              />
              <div className="mt-3 border-2 border-ink">
                {videoId ? (
                  <YouTubeEmbed videoId={videoId} autoplay title="Preview" />
                ) : (
                  <div className="flex aspect-video items-center justify-center bg-ink/5 px-4 text-center font-data text-sm text-muted-tan">
                    {url.trim()
                      ? 'That doesn’t look like a YouTube link yet.'
                      : 'Paste a link to preview the feed.'}
                  </div>
                )}
              </div>
            </section>

            <LatencySection
              armedAt={armedAt}
              tap={tap}
              samples={samples}
              clear={() => setSamples([])}
              avg={avg}
              useMeasured={() => avg !== null && setDelayMs(avg)}
              delayMs={delayMs}
              setDelayMs={setDelayMs}
              nudge={nudge}
            />
          </>
        ) : (
          <p className="border-2 border-dashed border-ink/30 p-3 font-data text-sm text-muted-tan">
            This game is stats-only (no video).
          </p>
        )}

        {err && <p className="mt-3 font-data text-sm text-barn-red">{err}</p>}
      </div>

      {isYouTube && (
        <div className="flex items-center gap-3 border-t-2 border-ink bg-cream-off p-4">
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 bg-gold py-3 font-display text-ink disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {savedMsg && <span className="font-data text-sm text-board-green">{savedMsg}</span>}
        </div>
      )}
    </div>
  )
}

function PhoneBroadcastSection({ token, status }: { token: string; status: BroadcastStatus }) {
  const link = `${window.location.origin}/broadcast/${token}`
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    QRCode.toDataURL(link, { margin: 1, width: 320, color: { dark: '#1A2A4A', light: '#F4ECD8' } })
      .then(setQr)
      .catch(() => setQr(null))
  }, [link])

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <section>
      {/* live health */}
      <div
        className={`mb-4 flex items-center gap-2 border-2 px-3 py-2 ${
          status.live ? 'border-board-green bg-board-green/10' : 'border-ink/20 bg-ink/5'
        }`}
      >
        <span
          className={`h-2.5 w-2.5 rounded-full ${status.live ? 'animate-pulse bg-board-green' : 'bg-ink/30'}`}
        />
        <span className="font-athletic text-sm font-semibold uppercase tracking-wide">
          {status.live ? `Live · ${status.viewers} watching` : 'Not broadcasting'}
        </span>
      </div>

      <p className="mb-3 font-data text-[12px] text-muted-tan">
        Open this on the phone that will film the game. Only people you share it with can broadcast —
        viewers with the watch link can’t.
      </p>

      {qr && (
        <img src={qr} alt="Broadcast QR" className="mx-auto h-44 w-44 border-2 border-ink" draggable={false} />
      )}
      <div className="mt-3 w-full break-all border-2 border-ink bg-white px-3 py-2 text-center font-data text-xs">
        {link}
      </div>
      <div className="mt-2 flex gap-2">
        <button
          onClick={copy}
          className={`flex-1 border-2 border-ink py-2.5 font-display ${copied ? 'bg-board-green text-cream' : 'text-ink'}`}
        >
          {copied ? 'Copied ✓' : 'Copy link'}
        </button>
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="flex-1 border-2 border-ink py-2.5 text-center font-display text-ink"
        >
          Open here
        </a>
      </div>
    </section>
  )
}

function LatencySection({
  armedAt,
  tap,
  samples,
  clear,
  avg,
  useMeasured,
  delayMs,
  setDelayMs,
  nudge,
}: {
  armedAt: number | null
  tap: () => void
  samples: number[]
  clear: () => void
  avg: number | null
  useMeasured: () => void
  delayMs: number
  setDelayMs: (n: number) => void
  nudge: (d: number) => void
}) {
  return (
    <section>
      <h3 className="mb-1 font-display text-lg">Sync the scorebug to the video</h3>
      <p className="mb-3 font-data text-[12px] text-muted-tan">
        The video runs a few seconds behind real life. We can’t draw a marker into a YouTube/GoPro
        feed — only what the camera films travels through the delay — so a real play is the marker:
        mark the same moment <b>twice</b> (once live, once on the video) and we read the gap. A few
        reps gives a good average.
      </p>

      <button
        onClick={tap}
        className={`w-full border-2 border-ink py-6 font-display text-lg leading-tight ${
          armedAt === null ? 'bg-board-green text-cream' : 'bg-gold text-ink'
        }`}
      >
        {armedAt === null
          ? '① Watch the field — tap on the next pitch or hit'
          : '② Now watch the video — tap when that play appears'}
      </button>
      <p className="mt-1 text-center font-data text-[11px] text-muted-tan">
        {armedAt === null
          ? 'Mark a real moment as it happens out on the field.'
          : 'Tap the instant you see that same moment on the delayed video.'}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {samples.map((s, i) => (
          <span key={i} className="border border-ink/30 bg-white px-2 py-0.5 font-data text-xs">
            {(s / 1000).toFixed(1)}s
          </span>
        ))}
        {samples.length > 0 && (
          <button
            onClick={clear}
            className="font-athletic text-xs uppercase tracking-wide text-barn-red underline"
          >
            clear
          </button>
        )}
      </div>
      {avg !== null && (
        <div className="mt-2 flex items-center justify-between border-2 border-board-green bg-board-green/10 px-3 py-2">
          <span className="font-data text-sm">
            Measured: <b>{(avg / 1000).toFixed(1)}s</b>{' '}
            <span className="text-muted-tan">
              ({samples.length} tap{samples.length === 1 ? '' : 's'})
            </span>
          </span>
          <button onClick={useMeasured} className="bg-board-green px-3 py-1.5 font-display text-sm text-cream">
            Use this
          </button>
        </div>
      )}

      <div className="mt-5">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">
            Delay
          </span>
          <span className="font-display text-2xl tabular">{(delayMs / 1000).toFixed(1)}s</span>
        </div>
        <input
          type="range"
          min={0}
          max={30000}
          step={250}
          value={delayMs}
          onChange={(e) => setDelayMs(Number(e.target.value))}
          className="w-full accent-board-green"
        />
        <div className="mt-2 flex gap-2">
          <button onClick={() => nudge(-500)} className="flex-1 border-2 border-ink py-2 font-display text-sm">
            −0.5s
          </button>
          <button onClick={() => nudge(500)} className="flex-1 border-2 border-ink py-2 font-display text-sm">
            +0.5s
          </button>
        </div>
      </div>
    </section>
  )
}

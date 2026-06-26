import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { parseYouTubeId } from '@/lib/youtube'
import { YouTubeEmbed } from '@/components/VideoEmbed'
import type { Game } from '@/lib/types'

// The scorer's video + latency screen. Two jobs:
//  1. Point the game at the live video (for external camera → YouTube, paste the
//     link — you usually only get it once you're live at the field).
//  2. Measure the broadcast delay so the viewer's scorebug matches the video
//     they see. The video runs seconds behind real life; we hold the bug back by
//     the same amount. Measure it with a two-tap test: tap at a real play, then
//     tap again when that play shows up on the video — the gap is the delay.
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
  const [url, setUrl] = useState(String(game.video_config?.youtube_url ?? ''))
  const [delayMs, setDelayMs] = useState(game.stat_delay_ms ?? 0)

  // Two-tap calibration state.
  const [armedAt, setArmedAt] = useState<number | null>(null)
  const [samples, setSamples] = useState<number[]>([])

  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const videoId = parseYouTubeId(url)
  const avg = samples.length ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : null

  function tap() {
    const now = performance.now()
    if (armedAt === null) {
      setArmedAt(now) // ① real play happened
    } else {
      const measured = Math.max(0, Math.round(now - armedAt)) // ② saw it on video
      setSamples((s) => [...s, measured])
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
    if (isYouTube) {
      const u = url.trim()
      if (u) cfg.youtube_url = u
      else delete cfg.youtube_url
    }
    const { error } = await supabase
      .from('games')
      .update({ stat_delay_ms: delayMs, video_config: cfg })
      .eq('id', game.id)
    setSaving(false)
    if (error) {
      setErr(error.message)
      return
    }
    onSaved?.({ stat_delay_ms: delayMs, video_config: cfg })
    setSavedMsg('Saved ✓')
    window.setTimeout(() => setSavedMsg(null), 1800)
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-cream text-ink">
      <div className="flex items-center justify-between border-b-2 border-gold bg-ink px-4 py-2.5">
        <span className="font-display text-lg text-cream">Video &amp; sync</span>
        <button onClick={onClose} className="font-athletic text-cream">
          Done
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* ---- Video source ---- */}
        {isYouTube ? (
          <section className="mb-6">
            <h3 className="mb-1 font-display text-lg">Live video link</h3>
            <p className="mb-2 font-data text-[12px] text-muted-tan">
              Go live from your GoPro/DJI (or phone) to an unlisted YouTube stream, then paste
              the link here.
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
                  {url.trim() ? 'That doesn’t look like a YouTube link yet.' : 'Paste a link to preview the feed.'}
                </div>
              )}
            </div>
          </section>
        ) : game.video_source === 'phone_whip' ? (
          <section className="mb-6 border-2 border-dashed border-ink/30 p-3 font-data text-sm text-muted-tan">
            This game streams from another phone. Phone broadcasting is coming next — the delay
            tuner below already works for any video you’re showing viewers.
          </section>
        ) : (
          <section className="mb-6 border-2 border-dashed border-ink/30 p-3 font-data text-sm text-muted-tan">
            This game is stats-only (no video). You can still set a delay below if your viewers
            watch the game some other way.
          </section>
        )}

        {/* ---- Latency calibration ---- */}
        <section>
          <h3 className="mb-1 font-display text-lg">Sync the scorebug to the video</h3>
          <p className="mb-3 font-data text-[12px] text-muted-tan">
            The video runs a few seconds behind real life. We can’t draw a marker into a
            YouTube/GoPro feed — only what the camera films travels through the delay — so a real
            play is the marker: mark the same moment <b>twice</b> (once live, once on the video) and
            we read the gap. A few reps gives a good average.
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

          {/* Samples + measured average */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {samples.map((s, i) => (
              <span key={i} className="border border-ink/30 bg-white px-2 py-0.5 font-data text-xs">
                {(s / 1000).toFixed(1)}s
              </span>
            ))}
            {samples.length > 0 && (
              <button
                onClick={() => setSamples([])}
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
                <span className="text-muted-tan">({samples.length} tap{samples.length === 1 ? '' : 's'})</span>
              </span>
              <button
                onClick={() => setDelayMs(avg)}
                className="bg-board-green px-3 py-1.5 font-display text-sm text-cream"
              >
                Use this
              </button>
            </div>
          )}

          {/* Manual fine-tune */}
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

        {err && <p className="mt-3 font-data text-sm text-barn-red">{err}</p>}
      </div>

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
    </div>
  )
}

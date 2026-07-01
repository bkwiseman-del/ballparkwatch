import { useEffect, useState } from 'react'
import { pushSupported, pushEnabled, enablePush, disablePush } from '@/lib/push'

// A small banner to turn on push notifications (game starting, announcements, schedule
// changes). Hidden on unsupported browsers. On iOS this only works from the INSTALLED
// PWA — the enable step must be a user tap.
export function NotifyToggle() {
  const supported = pushSupported()
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    pushEnabled().then(setOn)
  }, [])

  if (!supported) return null

  async function enable() {
    setBusy(true)
    setErr(null)
    const e = await enablePush()
    setBusy(false)
    if (e) setErr(e)
    else setOn(true)
  }
  async function disable() {
    setBusy(true)
    await disablePush()
    setBusy(false)
    setOn(false)
  }

  return (
    <div className="mb-4 flex items-center justify-between gap-3 border-2 border-ink bg-cream-off px-3 py-2.5">
      <div className="min-w-0">
        <p className="font-athletic text-xs font-bold uppercase tracking-wide text-ink">
          {on ? '🔔 Notifications on' : 'Get game & team alerts'}
        </p>
        <p className="font-data text-[11px] text-muted-tan">
          {on ? 'Live games, announcements, and schedule changes.' : 'Know the moment a game goes live.'}
        </p>
        {err && <p className="mt-0.5 font-data text-[11px] text-barn-red">{err}</p>}
      </div>
      {on ? (
        <button
          onClick={disable}
          disabled={busy}
          className="shrink-0 font-athletic text-xs font-bold uppercase tracking-wide text-ink/40 hover:text-barn-red"
        >
          Turn off
        </button>
      ) : (
        <button
          onClick={enable}
          disabled={busy}
          className="shrink-0 bg-gold px-3 py-2 font-display text-sm text-ink disabled:opacity-60"
        >
          {busy ? '…' : 'Enable'}
        </button>
      )}
    </div>
  )
}

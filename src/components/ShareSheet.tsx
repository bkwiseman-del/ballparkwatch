import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

// Share the no-account viewer link: native share sheet, copy, or a QR code to
// scan at the field.
export function ShareSheet({
  url,
  title,
  onClose,
}: {
  url: string
  title: string
  onClose: () => void
}) {
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const canShare = typeof navigator !== 'undefined' && !!navigator.share

  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: '#1A2A4A', light: '#F4ECD8' } })
      .then(setQr)
      .catch(() => setQr(null))
  }, [url])

  const nativeShare = async () => {
    try {
      await navigator.share({ title, text: `Watch ${title} live`, url })
    } catch {
      /* user cancelled */
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-sm border-t-2 border-gold bg-cream text-ink sm:border-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between bg-ink px-4 py-2.5">
          <span className="font-display text-lg text-cream">Share this game</span>
          <button onClick={onClose} className="font-athletic text-cream">
            ✕
          </button>
        </div>

        <div className="flex flex-col items-center gap-4 p-5">
          {qr && (
            <img
              src={qr}
              alt="QR code"
              className="h-44 w-44 border-2 border-ink"
              draggable={false}
            />
          )}
          <p className="text-center font-athletic text-[11px] uppercase tracking-[.12em] text-muted-tan">
            Parents scan at the field · no account needed
          </p>

          <div className="w-full break-all border-2 border-ink bg-white px-3 py-2 text-center font-data text-sm">
            {url}
          </div>

          <div className="flex w-full gap-2">
            {canShare && (
              <button onClick={nativeShare} className="flex-1 bg-gold py-3 font-display text-ink">
                Share ▸
              </button>
            )}
            <button
              onClick={copy}
              className={`flex-1 border-2 border-ink py-3 font-display ${copied ? 'bg-board-green text-cream' : 'text-ink'}`}
            >
              {copied ? 'Copied ✓' : 'Copy link'}
            </button>
          </div>

          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="font-athletic text-xs uppercase tracking-wide text-board-green underline"
          >
            Open viewer ↗
          </a>
        </div>
      </div>
    </div>
  )
}

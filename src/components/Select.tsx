import type { ReactNode } from 'react'

// The one dropdown control for the whole app. `appearance-none` kills the native iOS
// pill / Android chrome so the closed state is a consistent hard-cornered box that
// matches our text inputs; the caret is drawn by us. Tapping still opens the native
// picker (good mobile UX). `min-w-0` keeps it from blowing past its grid cell.
export function Select({
  value,
  onChange,
  children,
  className = '',
  accent = false,
}: {
  value: string
  onChange: (v: string) => void
  children: ReactNode
  className?: string
  accent?: boolean
}) {
  return (
    <div className={`relative w-full min-w-0 ${className}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full min-w-0 appearance-none rounded-none border-2 border-ink px-3 py-2 pr-9 font-data outline-none focus:border-board-green ${
          accent ? 'bg-ink text-gold' : 'bg-white text-ink'
        }`}
      >
        {children}
      </select>
      <span
        aria-hidden
        className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] ${
          accent ? 'text-gold' : 'text-ink'
        }`}
      >
        ▼
      </span>
    </div>
  )
}

// Matching text input so inputs and selects read as one family. `min-w-0` prevents
// date/number inputs from overflowing their column on iOS.
export const fieldClass =
  'w-full min-w-0 appearance-none rounded-none border-2 border-ink bg-white px-3 py-2 font-data text-ink outline-none focus:border-board-green'

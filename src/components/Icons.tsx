// Flat, monochrome line icons that match the "rendered flat" design language:
// hard corners (miter joins, square caps), no fill, currentColor so they take
// the surrounding text color. Use these instead of emoji — iOS renders emoji
// (and even some Unicode arrows) as colored glyphs, which breaks the flat look.

type IconProps = { className?: string }

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'square' as const,
  strokeLinejoin: 'miter' as const,
}

export function CameraIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M3 8h4l2-2.5h6L17 8h4v12H3z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </svg>
  )
}

export function UploadIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M12 15V3" />
      <path d="M7 8l5-5 5 5" />
      <path d="M4 15v5h16v-5" />
    </svg>
  )
}

// External-link / "opens elsewhere" affordance — replaces the ↗ glyph.
export function ArrowUpRightIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M7 17L17 7" />
      <path d="M8 7h9v9" />
    </svg>
  )
}

export function SoundOnIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M16 9a3 3 0 0 1 0 6" />
      <path d="M18.5 7a6 6 0 0 1 0 10" />
    </svg>
  )
}

export function SoundOffIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M16 9l5 6" />
      <path d="M21 9l-5 6" />
    </svg>
  )
}

import type { Bases } from '@/lib/engine'

// Shared baseball field. 300x300 SVG space, diamond is a 45°-rotated square.
// Geometry per the design spec. No explicit foul lines (the base-path edges
// already read as them). Occupied bases show a gold runner chip.
const cx = 150
const cy = 162
const h = 92

const HOME = { x: cx, y: cy + h }
const FIRST = { x: cx + h, y: cy }
const SECOND = { x: cx, y: cy - h }
const THIRD = { x: cx - h, y: cy }

// inner (grass) diamond — pull each vertex ~14px toward center
function toward(p: { x: number; y: number }, by = 14) {
  const dx = cx - p.x
  const dy = cy - p.y
  const len = Math.hypot(dx, dy)
  return { x: p.x + (dx / len) * by, y: p.y + (dy / len) * by }
}

const poly = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${p.y}`).join(' ')

export function FieldDiamond({
  runners,
  className = '',
  batter = false,
}: {
  runners: Bases
  className?: string
  batter?: boolean
}) {
  const outer = [HOME, FIRST, SECOND, THIRD]
  const inner = outer.map((p) => toward(p))

  return (
    <svg viewBox="0 0 300 300" className={className} role="img" aria-label="Field">
      {/* background */}
      <rect width="300" height="300" fill="#2C5234" />
      {/* outfield band (lighter green) */}
      <path d="M 30 168 A 120 120 0 0 1 270 168 L 270 150 A 120 120 0 0 0 30 150 Z" fill="#326139" />
      <ellipse cx={cx} cy={cy - 12} rx="118" ry="92" fill="#326139" opacity="0.0" />

      {/* infield dirt */}
      <polygon points={poly(outer)} fill="#b07a3e" />
      {/* infield grass */}
      <polygon points={poly(inner)} fill="#2C5234" />
      {/* base paths */}
      <polygon points={poly(outer)} fill="none" stroke="#e9ddc2" strokeWidth="2.5" />

      {/* pitcher's mound */}
      <circle cx={cx} cy={cy} r="12" fill="#b07a3e" />
      <rect x={cx - 4} y={cy - 2} width="8" height="4" fill="#F4ECD8" />

      {/* bases (14x14 rotated 45°) */}
      <Base p={SECOND} occupied={runners.second} />
      <Base p={FIRST} occupied={runners.first} />
      <Base p={THIRD} occupied={runners.third} />
      <HomePlate />

      {/* runner chips */}
      {runners.first && <Runner p={FIRST} />}
      {runners.second && <Runner p={SECOND} />}
      {runners.third && <Runner p={THIRD} />}
      {batter && <circle cx={HOME.x} cy={HOME.y - 2} r="9" fill="#A6342E" stroke="#F4ECD8" strokeWidth="1.5" />}
    </svg>
  )
}

function Base({ p, occupied }: { p: { x: number; y: number }; occupied: boolean }) {
  return (
    <rect
      x={p.x - 7}
      y={p.y - 7}
      width="14"
      height="14"
      transform={`rotate(45 ${p.x} ${p.y})`}
      fill={occupied ? '#C9A14A' : '#F4ECD8'}
    />
  )
}

function HomePlate() {
  const { x, y } = HOME
  return (
    <polygon
      points={`${x - 7},${y - 4} ${x + 7},${y - 4} ${x + 7},${y + 2} ${x},${y + 8} ${x - 7},${y + 2}`}
      fill="#F4ECD8"
    />
  )
}

function Runner({ p }: { p: { x: number; y: number } }) {
  return <circle cx={p.x} cy={p.y} r="9" fill="#C9A14A" stroke="#1A2A4A" strokeWidth="1.5" />
}

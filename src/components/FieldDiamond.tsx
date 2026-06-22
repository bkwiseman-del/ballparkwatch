import type { Bases } from '@/lib/engine'

// Shared baseball field. 300x300 SVG space, diamond is a 45°-rotated square.
// Bases hold player ids; pass `nameOf` to label runner chips and `onRunnerTap`
// to make them interactive (scorer advancement / steals).
const cx = 150
const cy = 162
const h = 92

const HOME = { x: cx, y: cy + h }
const FIRST = { x: cx + h, y: cy }
const SECOND = { x: cx, y: cy - h }
const THIRD = { x: cx - h, y: cy }

function toward(p: { x: number; y: number }, by = 14) {
  const dx = cx - p.x
  const dy = cy - p.y
  const len = Math.hypot(dx, dy)
  return { x: p.x + (dx / len) * by, y: p.y + (dy / len) * by }
}

const poly = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${p.y}`).join(' ')

export type BaseName = 'first' | 'second' | 'third'

export function FieldDiamond({
  bases,
  nameOf,
  onRunnerTap,
  batterLabel,
  className = '',
}: {
  bases: Bases
  nameOf?: (id: string) => string | null
  onRunnerTap?: (base: BaseName, id: string) => void
  batterLabel?: string | null
  className?: string
}) {
  const outer = [HOME, FIRST, SECOND, THIRD]
  const inner = outer.map((p) => toward(p))
  const label = (id: string | null) => (id && nameOf ? nameOf(id) : null)

  return (
    <svg viewBox="0 0 300 300" className={className} role="img" aria-label="Field">
      <rect width="300" height="300" fill="#2C5234" />
      <path d="M 30 168 A 120 120 0 0 1 270 168 L 270 150 A 120 120 0 0 0 30 150 Z" fill="#326139" />

      <polygon points={poly(outer)} fill="#b07a3e" />
      <polygon points={poly(inner)} fill="#2C5234" />
      <polygon points={poly(outer)} fill="none" stroke="#e9ddc2" strokeWidth="2.5" />

      <circle cx={cx} cy={cy} r="12" fill="#b07a3e" />
      <rect x={cx - 4} y={cy - 2} width="8" height="4" fill="#F4ECD8" />

      <BaseSquare p={SECOND} occupied={!!bases.second} />
      <BaseSquare p={FIRST} occupied={!!bases.first} />
      <BaseSquare p={THIRD} occupied={!!bases.third} />
      <HomePlate />

      <Runner base="third" p={THIRD} id={bases.third} label={label(bases.third)} onTap={onRunnerTap} />
      <Runner base="second" p={SECOND} id={bases.second} label={label(bases.second)} onTap={onRunnerTap} />
      <Runner base="first" p={FIRST} id={bases.first} label={label(bases.first)} onTap={onRunnerTap} />

      {batterLabel !== undefined && (
        <g>
          <circle cx={HOME.x} cy={HOME.y - 2} r="9" fill="#A6342E" stroke="#F4ECD8" strokeWidth="1.5" />
          {batterLabel && (
            <RunnerLabel x={HOME.x} y={HOME.y + 16} text={batterLabel} bg="#A6342E" fg="#F4ECD8" />
          )}
        </g>
      )}
    </svg>
  )
}

function BaseSquare({ p, occupied }: { p: { x: number; y: number }; occupied: boolean }) {
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

function Runner({
  base,
  p,
  id,
  label,
  onTap,
}: {
  base: BaseName
  p: { x: number; y: number }
  id: string | null
  label: string | null
  onTap?: (base: BaseName, id: string) => void
}) {
  if (!id) return null
  const interactive = !!onTap
  return (
    <g
      onClick={interactive ? () => onTap!(base, id) : undefined}
      style={interactive ? { cursor: 'pointer' } : undefined}
    >
      <circle cx={p.x} cy={p.y} r="11" fill="#C9A14A" stroke="#1A2A4A" strokeWidth="2" />
      {label && <RunnerLabel x={p.x} y={p.y - 16} text={label} bg="#C9A14A" fg="#1A2A4A" />}
    </g>
  )
}

function RunnerLabel({ x, y, text, bg, fg }: { x: number; y: number; text: string; bg: string; fg: string }) {
  const w = Math.max(28, text.length * 7 + 10)
  return (
    <g>
      <rect x={x - w / 2} y={y - 11} width={w} height="16" fill={bg} />
      <text
        x={x}
        y={y + 1}
        textAnchor="middle"
        fontSize="10"
        fontWeight="700"
        fill={fg}
        style={{ fontFamily: "'Saira Condensed', sans-serif" }}
      >
        {text}
      </text>
    </g>
  )
}

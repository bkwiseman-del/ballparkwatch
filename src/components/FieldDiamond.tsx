import type { Bases } from '@/lib/engine'

// Shared baseball field, matching the design prototype: a fan of fair territory
// (home → outfield arc) with foul lines, dirt infield diamond, grass, bases, and
// gold runner chips. Bases hold player ids; pass `nameOf` to label chips and
// `onRunnerTap` to make them interactive.
const HOME = { x: 170, y: 330 }
const FIRST = { x: 256, y: 256 }
const SECOND = { x: 170, y: 182 }
const THIRD = { x: 84, y: 256 }

export type BaseName = 'first' | 'second' | 'third'
export type Fielder = { pos: string | null; name: string }

// where each defensive position stands on the field
const FIELDER_POS: Record<string, { x: number; y: number }> = {
  P: { x: 170, y: 282 },
  C: { x: 170, y: 352 },
  '1B': { x: 270, y: 238 },
  '2B': { x: 206, y: 214 },
  SS: { x: 132, y: 214 },
  '3B': { x: 68, y: 238 },
  LF: { x: 96, y: 104 },
  CF: { x: 170, y: 64 },
  RF: { x: 244, y: 104 },
}

export function FieldDiamond({
  bases,
  nameOf,
  onRunnerTap,
  batterLabel,
  fielders,
  className = '',
}: {
  bases: Bases
  nameOf?: (id: string) => string | null
  onRunnerTap?: (base: BaseName, id: string) => void
  batterLabel?: string | null
  fielders?: Fielder[]
  className?: string
}) {
  const label = (id: string | null) => (id && nameOf ? nameOf(id) : null)
  return (
    <svg viewBox="18 16 304 348" className={className} role="img" aria-label="Field">
      <rect x="0" y="0" width="340" height="410" fill="#2C5234" />

      {/* outfield (fair territory fan) */}
      <path d="M170 330 L40 200 A176 176 0 0 1 300 200 Z" fill="#326139" />
      {/* foul lines */}
      <line x1="170" y1="330" x2="44" y2="204" stroke="#e9ddc2" strokeWidth="2.5" />
      <line x1="170" y1="330" x2="296" y2="204" stroke="#e9ddc2" strokeWidth="2.5" />

      {/* infield dirt + grass */}
      <polygon points="170,330 256,256 170,182 84,256" fill="#b07a3e" />
      <polygon points="170,318 242,256 170,194 98,256" fill="#2C5234" />
      {/* base paths */}
      <polygon points="170,330 256,256 170,182 84,256" fill="none" stroke="#e9ddc2" strokeWidth="3" />

      {/* fielders (defense) */}
      {fielders?.map((f) => {
        const p = f.pos ? FIELDER_POS[f.pos] : undefined
        if (!p) return null
        return <FielderDot key={f.pos} p={p} pos={f.pos!} name={f.name} />
      })}

      {/* mound */}
      <circle cx="170" cy="256" r="13" fill="#b07a3e" />
      <rect x="166" y="253" width="8" height="4" fill="#F4ECD8" />

      {/* bases */}
      <BaseSquare p={SECOND} occupied={!!bases.second} />
      <BaseSquare p={FIRST} occupied={!!bases.first} />
      <BaseSquare p={THIRD} occupied={!!bases.third} />
      <polygon
        points={`${HOME.x - 8},${HOME.y - 4} ${HOME.x + 8},${HOME.y - 4} ${HOME.x + 8},${HOME.y + 3} ${HOME.x},${HOME.y + 10} ${HOME.x - 8},${HOME.y + 3}`}
        fill="#F4ECD8"
        stroke="#1A2A4A"
        strokeWidth="1.5"
      />

      {/* runners */}
      <Runner base="third" p={THIRD} id={bases.third} label={label(bases.third)} onTap={onRunnerTap} />
      <Runner base="second" p={SECOND} id={bases.second} label={label(bases.second)} onTap={onRunnerTap} />
      <Runner base="first" p={FIRST} id={bases.first} label={label(bases.first)} onTap={onRunnerTap} />

      {batterLabel !== undefined && (
        <g>
          <circle cx={HOME.x} cy={HOME.y + 1} r="10" fill="#A6342E" stroke="#F4ECD8" strokeWidth="1.5" />
          {batterLabel && <Pill x={HOME.x} y={HOME.y + 22} text={batterLabel} bg="#A6342E" fg="#F4ECD8" />}
        </g>
      )}
    </svg>
  )
}

function FielderDot({ p, pos, name }: { p: { x: number; y: number }; pos: string; name: string }) {
  const last = name.trim().split(/\s+/).pop() ?? name
  return (
    <g>
      <text
        x={p.x}
        y={p.y - 15}
        textAnchor="middle"
        fontSize="11"
        fontWeight="600"
        fill="#F4ECD8"
        paintOrder="stroke"
        stroke="#2C5234"
        strokeWidth="3"
        strokeLinejoin="round"
        style={{ fontFamily: "'Saira Condensed', sans-serif" }}
      >
        {last}
      </text>
      <circle cx={p.x} cy={p.y} r="11" fill="#1A2A4A" />
      <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#F4ECD8"
        style={{ fontFamily: "'Saira Condensed', sans-serif" }}>
        {pos}
      </text>
    </g>
  )
}

function BaseSquare({ p, occupied }: { p: { x: number; y: number }; occupied: boolean }) {
  return (
    <rect
      x={p.x - 8}
      y={p.y - 8}
      width="16"
      height="16"
      transform={`rotate(45 ${p.x} ${p.y})`}
      fill={occupied ? '#C9A14A' : '#F4ECD8'}
      stroke="#1A2A4A"
      strokeWidth="1.5"
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
      <circle cx={p.x} cy={p.y} r="13" fill="#C9A14A" stroke="#1A2A4A" strokeWidth="2.5" />
      {label && <Pill x={p.x} y={p.y - 20} text={label} bg="#C9A14A" fg="#1A2A4A" />}
    </g>
  )
}

function Pill({ x, y, text, bg, fg }: { x: number; y: number; text: string; bg: string; fg: string }) {
  const w = Math.max(34, text.length * 8 + 12)
  return (
    <g>
      <rect x={x - w / 2} y={y - 12} width={w} height="18" fill={bg} />
      <text
        x={x}
        y={y + 1}
        textAnchor="middle"
        fontSize="11"
        fontWeight="700"
        fill={fg}
        style={{ fontFamily: "'Saira Condensed', sans-serif" }}
      >
        {text}
      </text>
    </g>
  )
}

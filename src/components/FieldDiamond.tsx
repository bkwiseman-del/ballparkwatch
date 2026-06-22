import type { Bases } from '@/lib/engine'

// Shared baseball field, matching the design prototype: a fan of fair territory
// (home → outfield arc) with foul lines, dirt infield diamond, grass, bases, and
// gold runner chips. Bases hold player ids; pass `nameOf` to label chips and
// `onRunnerTap` to make them interactive.
// Perfect square rotated 45° (equal half-diagonal h=74 in x and y).
const HOME = { x: 170, y: 330 }
const FIRST = { x: 244, y: 256 }
const SECOND = { x: 170, y: 182 }
const THIRD = { x: 96, y: 256 }

export type BaseName = 'first' | 'second' | 'third'
export type Fielder = { pos: string | null; name: string }
// Spray viz: ball contact point + optional throw path (fielder positions).
// `nonce` keys the animation so it replays for each new play.
export type SprayViz = {
  contact: { x: number; y: number }
  throws?: { x: number; y: number }[]
  nonce: number
}

export const POS_BY_NUM: Record<number, string> = {
  1: 'P', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF',
}

// where each defensive position stands on the field (kept off the bags so
// runner chips don't collide)
export const FIELDER_POS: Record<string, { x: number; y: number }> = {
  P: { x: 170, y: 272 },
  C: { x: 170, y: 356 },
  '1B': { x: 298, y: 240 },
  '2B': { x: 214, y: 196 },
  SS: { x: 126, y: 196 },
  '3B': { x: 42, y: 240 },
  LF: { x: 90, y: 98 },
  CF: { x: 170, y: 58 },
  RF: { x: 250, y: 98 },
}

export function FieldDiamond({
  bases,
  nameOf,
  onRunnerTap,
  batterLabel,
  fielders,
  spray,
  onFieldTap,
  marker,
  className = '',
}: {
  bases: Bases
  nameOf?: (id: string) => string | null
  onRunnerTap?: (base: BaseName, id: string) => void
  batterLabel?: string | null
  fielders?: Fielder[]
  spray?: SprayViz | null
  onFieldTap?: (p: { x: number; y: number }) => void
  marker?: { x: number; y: number } | null
  className?: string
}) {
  const label = (id: string | null) => (id && nameOf ? nameOf(id) : null)
  const handleTap = onFieldTap
    ? (e: React.MouseEvent<SVGSVGElement>) => {
        const r = e.currentTarget.getBoundingClientRect()
        const x = 18 + ((e.clientX - r.left) / r.width) * 304
        const y = 16 + ((e.clientY - r.top) / r.height) * 348
        onFieldTap({ x: Math.round(x), y: Math.round(y) })
      }
    : undefined
  return (
    <svg
      viewBox="18 16 304 348"
      className={className}
      role="img"
      aria-label="Field"
      onClick={handleTap}
      style={onFieldTap ? { cursor: 'crosshair' } : undefined}
    >
      <rect x="0" y="0" width="340" height="410" fill="#2C5234" />

      {/* outfield (fair territory fan) */}
      <path d="M170 330 L40 200 A176 176 0 0 1 300 200 Z" fill="#326139" />
      {/* foul lines */}
      <line x1="170" y1="330" x2="44" y2="204" stroke="#e9ddc2" strokeWidth="2.5" />
      <line x1="170" y1="330" x2="296" y2="204" stroke="#e9ddc2" strokeWidth="2.5" />

      {/* infield dirt + grass */}
      <polygon points="170,330 244,256 170,182 96,256" fill="#b07a3e" />
      <polygon points="170,318 232,256 170,194 108,256" fill="#2C5234" />
      {/* base paths */}
      <polygon points="170,330 244,256 170,182 96,256" fill="none" stroke="#e9ddc2" strokeWidth="3" />

      {/* mound */}
      <circle cx="170" cy="256" r="13" fill="#b07a3e" />
      <rect x="166" y="253" width="8" height="4" fill="#F4ECD8" />

      {/* fielders (defense) — compact chips */}
      {fielders?.map((f) => {
        const p = f.pos ? FIELDER_POS[f.pos] : undefined
        if (!p) return null
        return <FielderDot key={f.pos} p={p} pos={f.pos!} name={f.name} />
      })}

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
      <Runner base="third" p={THIRD} id={bases.third} label={label(bases.third)} onTap={onRunnerTap} below />
      <Runner base="second" p={SECOND} id={bases.second} label={label(bases.second)} onTap={onRunnerTap} />
      <Runner base="first" p={FIRST} id={bases.first} label={label(bases.first)} onTap={onRunnerTap} below />

      {batterLabel !== undefined && (
        <g>
          <circle cx={HOME.x} cy={HOME.y + 1} r="10" fill="#A6342E" stroke="#F4ECD8" strokeWidth="1.5" />
          {batterLabel && <Pill x={HOME.x + 52} y={HOME.y + 1} text={batterLabel} bg="#A6342E" fg="#F4ECD8" />}
        </g>
      )}

      {/* static landing marker (scorer pick) */}
      {marker && (
        <g>
          <line x1={HOME.x} y1={HOME.y} x2={marker.x} y2={marker.y} stroke="#C9A14A" strokeWidth="2.5" strokeDasharray="6 5" />
          <circle cx={marker.x} cy={marker.y} r="6.5" fill="#F4ECD8" stroke="#C9A14A" strokeWidth="2.5" />
        </g>
      )}

      {/* transient spray — ball travels home → contact, then each throw in order */}
      {spray && <AnimatedSpray key={spray.nonce} viz={spray} home={HOME} />}
    </svg>
  )
}

// Compact single chip per fielder: "POS Name" (e.g. "SS Webb").
function FielderDot({ p, pos, name }: { p: { x: number; y: number }; pos: string; name: string }) {
  const last = name.trim().split(/\s+/).pop() ?? name
  const text = `${pos} ${last}`
  const w = text.length * 5.6 + 10
  const h = 16
  return (
    <g>
      <rect x={p.x - w / 2} y={p.y - h / 2} width={w} height={h} fill="#1A2A4A" opacity="0.92" />
      <text
        x={p.x}
        y={p.y + 4}
        textAnchor="middle"
        fontSize="10.5"
        fontWeight="600"
        style={{ fontFamily: "'Saira Condensed', sans-serif" }}
      >
        <tspan fill="#C9A14A">{pos} </tspan>
        <tspan fill="#F4ECD8">{last}</tspan>
      </text>
    </g>
  )
}

function AnimatedSpray({ viz, home }: { viz: SprayViz; home: { x: number; y: number } }) {
  const pts = [home, viz.contact, ...(viz.throws ?? [])]
  let len = 0
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  const d = `M ${pts[0].x} ${pts[0].y} ` + pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')
  const dur = `${(0.45 * (pts.length - 1) + 0.25).toFixed(2)}s`
  return (
    <g>
      <path d={d} fill="none" stroke="#C9A14A" strokeWidth="2.5" strokeDasharray={len} strokeDashoffset={len}>
        <animate attributeName="stroke-dashoffset" from={len} to="0" dur={dur} fill="freeze" />
      </path>
      {pts.slice(1).map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3.5" fill="#C9A14A" />
      ))}
      <circle r="6.5" fill="#F4ECD8" stroke="#C9A14A" strokeWidth="2.5">
        <animateMotion dur={dur} fill="freeze" path={d} />
      </circle>
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
  below = false,
}: {
  base: BaseName
  p: { x: number; y: number }
  id: string | null
  label: string | null
  onTap?: (base: BaseName, id: string) => void
  below?: boolean
}) {
  if (!id) return null
  const interactive = !!onTap
  return (
    <g
      onClick={interactive ? () => onTap!(base, id) : undefined}
      style={interactive ? { cursor: 'pointer' } : undefined}
    >
      <circle cx={p.x} cy={p.y} r="13" fill="#C9A14A" stroke="#1A2A4A" strokeWidth="2.5" />
      {label && <Pill x={p.x} y={below ? p.y + 24 : p.y - 20} text={label} bg="#C9A14A" fg="#1A2A4A" />}
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

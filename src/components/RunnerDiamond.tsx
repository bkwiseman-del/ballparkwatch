// Small scorebug diamond. Matches the spec SVG (40x40 viewBox, rotated 45°,
// 11px base squares). Occupied base = gold fill; empty = cream outline; home
// plate = solid cream. After rotate(45° about center) the corner squares map to:
//   (6,6)→2B (top) · (22,6)→1B (right) · (22,22)→home (bottom) · (6,22)→3B (left)
export function RunnerDiamond({
  runners,
  size = 30,
  emptyStroke = '#F4ECD8',
}: {
  runners: { first: boolean; second: boolean; third: boolean }
  size?: number
  emptyStroke?: string
}) {
  const base = (occupied: boolean, x: number, y: number) =>
    occupied ? (
      <rect x={x} y={y} width="11" height="11" fill="#C9A14A" />
    ) : (
      <rect x={x} y={y} width="11" height="11" fill="none" stroke={emptyStroke} strokeWidth="1.5" />
    )
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <g transform="rotate(45 20 20)">
        {base(runners.second, 6, 6)}
        {base(runners.first, 22, 6)}
        {base(runners.third, 6, 22)}
        {/* home plate: solid cream */}
        <rect x="22" y="22" width="11" height="11" fill={emptyStroke} />
      </g>
    </svg>
  )
}

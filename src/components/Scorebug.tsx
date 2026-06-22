import type { ScoreboardState } from '@/lib/scoreboard'
import { halfArrow, halfLabel } from '@/lib/scoreboard'
import { RunnerDiamond } from './RunnerDiamond'

type Variant = 'dark' | 'light'

// Compact overlay scorebug — rides over video and appears in stats panels.
// Flat panel, hard edges, block numerals. Home team + runners in scoring
// position render in gold; filled red dots = outs.
export function Scorebug({
  state,
  variant = 'dark',
  className = '',
}: {
  state: ScoreboardState
  variant?: Variant
  className?: string
}) {
  const dark = variant === 'dark'
  const panel = dark ? 'bg-field-green text-cream border-gold' : 'bg-cream text-ink border-ink'
  const rule = dark ? 'rgba(244,236,216,.22)' : 'rgba(26,42,74,.25)'
  const homeAccent = dark ? 'text-gold' : 'text-barn-red'
  const subLabel = dark ? 'text-muted-green' : 'text-muted-tan'
  const outEmpty = dark ? '#F4ECD8' : '#1A2A4A'

  return (
    <div
      className={`inline-flex items-stretch border-2 font-athletic ${panel} ${className}`}
    >
      {/* team/score column */}
      <div className="flex min-w-[96px] flex-col">
        <div
          className="flex items-center justify-between gap-3.5 px-[11px] py-[5px]"
          style={{ borderBottom: `1px solid ${rule}` }}
        >
          <span className="text-base font-semibold tracking-[.06em]">{state.away.code}</span>
          <span className="tabular text-lg font-bold">{state.away.score}</span>
        </div>
        <div className="flex items-center justify-between gap-3.5 px-[11px] py-[5px]">
          <span className={`text-base font-semibold tracking-[.06em] ${homeAccent}`}>
            {state.home.code}
          </span>
          <span className={`tabular text-lg font-bold ${homeAccent}`}>{state.home.score}</span>
        </div>
      </div>

      {/* inning */}
      <Cell borderColor={dark ? '#C9A14A' : '#1A2A4A'} borderWidth={2}>
        <span className="text-[17px] font-bold leading-none">
          {halfArrow(state.half)}
          {state.inning}
        </span>
        <span className={`text-[9px] tracking-[.14em] ${subLabel}`}>{halfLabel(state.half)}</span>
      </Cell>

      {/* count */}
      <Cell borderColor={rule}>
        <span className="tabular text-[17px] font-bold leading-none">
          {state.balls}–{state.strikes}
        </span>
        <span className={`text-[9px] tracking-[.12em] ${subLabel}`}>B–S</span>
      </Cell>

      {/* outs */}
      <Cell borderColor={rule}>
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-[9px] w-[9px] rounded-full"
              style={
                i < state.outs
                  ? { background: '#A6342E' }
                  : { border: `1.5px solid ${outEmpty}`, boxSizing: 'border-box' }
              }
            />
          ))}
        </div>
        <span className={`text-[9px] tracking-[.12em] ${subLabel}`}>OUT</span>
      </Cell>

      {/* runners */}
      <div
        className="flex items-center justify-center px-[11px]"
        style={{ borderLeft: `1px solid ${rule}` }}
      >
        <RunnerDiamond runners={state.runners} emptyStroke={dark ? '#F4ECD8' : '#1A2A4A'} />
      </div>
    </div>
  )
}

function Cell({
  children,
  borderColor,
  borderWidth = 1,
}: {
  children: React.ReactNode
  borderColor: string
  borderWidth?: number
}) {
  return (
    <div
      className="flex flex-col items-center justify-center px-3"
      style={{ borderLeft: `${borderWidth}px solid ${borderColor}` }}
    >
      {children}
    </div>
  )
}

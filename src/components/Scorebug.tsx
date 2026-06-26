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

// Thin single-row bug that spans the full width of the video frame — minimal
// vertical footprint for overlaying across the bottom of a live broadcast.
export function ScorebugBar({ state }: { state: ScoreboardState }) {
  return (
    <div className="flex w-full items-center gap-2.5 bg-night-green/90 px-3 py-1 font-athletic text-cream backdrop-blur-sm">
      <BarPair code={state.away.code} score={state.away.score} />
      <BarPair code={state.home.code} score={state.home.score} home />

      <span className="mx-0.5 h-4 w-px bg-gold/30" />

      {/* inning + half */}
      <span className="tabular text-sm font-bold leading-none">
        {halfArrow(state.half)}
        {state.inning}
      </span>

      {/* count */}
      <span className="flex items-baseline gap-1">
        <span className="text-[9px] tracking-[.1em] text-muted-green">B–S</span>
        <span className="tabular text-sm font-bold leading-none">
          {state.balls}–{state.strikes}
        </span>
      </span>

      {/* outs */}
      <span className="flex items-center gap-1">
        <span className="flex gap-0.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-2 w-2 rounded-full"
              style={
                i < state.outs
                  ? { background: '#A6342E' }
                  : { border: '1.5px solid #F4ECD8', boxSizing: 'border-box' }
              }
            />
          ))}
        </span>
        <span className="text-[9px] tracking-[.1em] text-muted-green">OUT</span>
      </span>

      <span className="ml-auto">
        <RunnerDiamond runners={state.runners} size={20} emptyStroke="#F4ECD8" />
      </span>
    </div>
  )
}

function BarPair({ code, score, home = false }: { code: string; score: number; home?: boolean }) {
  const accent = home ? 'text-gold' : 'text-cream'
  return (
    <span className="flex items-baseline gap-1">
      <span className={`text-sm font-semibold tracking-[.05em] ${accent}`}>{code}</span>
      <span className={`tabular text-base font-bold leading-none ${accent}`}>{score}</span>
    </span>
  )
}

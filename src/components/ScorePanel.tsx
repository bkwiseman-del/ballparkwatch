import type { ScoreboardState } from '@/lib/scoreboard'
import { halfArrow, halfLabel } from '@/lib/scoreboard'
import { RunnerDiamond } from './RunnerDiamond'

// Full-width viewer score panel (design's /watch score panel): two team rows with
// code badge + full name + score, then a state strip (inning / count / outs /
// runners). Spans the full screen width — not inset.
export function ScorePanel({ state }: { state: ScoreboardState }) {
  return (
    <div className="border-y-2 border-gold bg-field-green text-cream">
      <TeamRow code={state.away.code} name={state.away.name} score={state.away.score} />
      <div className="h-px bg-gold/25" />
      <TeamRow code={state.home.code} name={state.home.name} score={state.home.score} home />

      <div className="flex items-center justify-between border-t-2 border-gold/40 bg-night-green px-4 py-2.5 font-athletic">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-bold leading-none">
            {halfArrow(state.half)}
            {state.inning}
          </span>
          <span className="text-[10px] tracking-[.14em] text-muted-green">{halfLabel(state.half)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] tracking-[.12em] text-muted-green">B–S</span>
          <span className="tabular text-xl font-bold leading-none">
            {state.balls}–{state.strikes}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] tracking-[.12em] text-muted-green">OUT</span>
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-2.5 w-2.5 rounded-full"
                style={i < state.outs ? { background: '#A6342E' } : { border: '1.5px solid #F4ECD8', boxSizing: 'border-box' }}
              />
            ))}
          </div>
        </div>
        <RunnerDiamond runners={state.runners} size={32} />
      </div>
    </div>
  )
}

function TeamRow({
  code,
  name,
  score,
  home = false,
}: {
  code: string
  name?: string
  score: number
  home?: boolean
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 ${home ? 'bg-[#244129]' : ''}`}>
      <span
        className={`px-2 py-0.5 font-athletic text-sm font-bold tracking-[.06em] ${
          home ? 'bg-gold text-ink' : 'bg-ink text-cream'
        }`}
      >
        {code}
      </span>
      <span className="flex-1 truncate font-display text-base">{name}</span>
      <span className={`tabular font-athletic text-2xl font-bold ${home ? 'text-gold' : 'text-cream'}`}>
        {score}
      </span>
    </div>
  )
}

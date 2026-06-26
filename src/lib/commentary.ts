import { applyEvent, INITIAL_LIVE, type GameEventRow, type LiveGame } from './engine'
import { buildPlayByPlay } from './stats'

// Builds GameChanger-style play-by-play lines from the event log: the batter up,
// balls/strikes on each pitch, the play result, outs, and inning summaries with
// the score. The viewer turns these into spoken commentary (one TTS clip each).

type NameOf = (id: string | null | undefined) => string | null
type Slot = { name: string; jersey: string | null }
type Lineups = { away: Slot[]; home: Slot[] }

export type CommentaryLine = { key: string; text: string }

const ONES = ['', 'one', 'two', 'three']
const ORD = [
  '', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th',
]
const ord = (n: number) => ORD[n] ?? `${n}th`

function batterUp(state: LiveGame, lineups: Lineups): string | null {
  const key = state.half === 'top' ? 'away' : 'home'
  const order = lineups[key]
  if (!order.length) return null
  const idx = (key === 'away' ? state.awayBatterIdx : state.homeBatterIdx) % order.length
  const b = order[idx]
  if (!b?.name) return null
  return `Now batting, ${b.name}.`
}

function outsLine(state: LiveGame): string | null {
  if (state.outs <= 0 || state.outs >= 3) return null
  return state.outs === 1 ? 'One out.' : 'Two outs.'
}

function scoreSummary(state: LiveGame): string {
  const a = state.awayScore
  const h = state.homeScore
  if (a === h) return `We're tied up, ${a} to ${a}.`
  return `${h > a ? 'Home' : 'Away'} leads it, ${Math.max(a, h)} to ${Math.min(a, h)}.`
}

function inningLine(before: LiveGame, after: LiveGame): string {
  // top → bottom = middle of the inning; bottom → top = end, new inning.
  const head =
    before.half === 'top'
      ? `Middle of the ${ord(after.inning)}.`
      : `That's the end of the ${ord(before.inning)}.`
  return `${head} ${scoreSummary(after)}`
}

function linesFor(
  ev: GameEventRow,
  before: LiveGame,
  after: LiveGame,
  play: Map<number, string>,
  lineups: Lineups,
): string[] {
  const text = play.get(ev.seq)
  const out: (string | null)[] = []
  switch (ev.event_type) {
    case 'game_start':
      out.push('Play ball!', batterUp(after, lineups))
      break
    case 'pitch_ball':
      out.push(after.balls >= 1 && after.balls <= 3 ? `Ball ${ONES[after.balls]}.` : 'Ball.')
      break
    case 'pitch_strike':
      out.push(after.strikes >= 1 && after.strikes <= 2 ? `Strike ${ONES[after.strikes]}.` : 'Strike.')
      break
    case 'pitch_foul':
      out.push('Foul ball.')
      break
    case 'walk':
      out.push(text ?? 'Ball four — a walk.', batterUp(after, lineups))
      break
    case 'strikeout':
      out.push(text ?? 'Strikeout.', outsLine(after), batterUp(after, lineups))
      break
    case 'single':
    case 'double':
    case 'triple':
    case 'home_run':
    case 'error':
    case 'fielders_choice':
      out.push(text ?? null, batterUp(after, lineups))
      break
    case 'groundout':
    case 'flyout':
    case 'lineout':
      out.push(text ?? null, outsLine(after), batterUp(after, lineups))
      break
    case 'stolen_base':
    case 'caught_stealing':
    case 'runner_advance':
    case 'picked_off':
      out.push(text ?? null)
      break
    case 'inning_change':
      out.push(inningLine(before, after), batterUp(after, lineups))
      break
    case 'game_end':
      out.push(`That's the ballgame! ${scoreSummary(after)}`)
      break
  }
  return out.filter((s): s is string => !!s && s.trim().length > 0)
}

// All commentary lines for events newer than `sinceSeq`, in order.
export function freshCommentary(
  events: GameEventRow[],
  sinceSeq: number,
  nameOf: NameOf,
  lineups: Lineups,
): CommentaryLine[] {
  const sorted = [...events].sort((a, b) => a.seq - b.seq)
  const play = new Map(buildPlayByPlay(events, nameOf).map((p) => [p.seq, p.text]))
  const res: CommentaryLine[] = []
  let state: LiveGame = { ...INITIAL_LIVE }
  for (const ev of sorted) {
    const before = state
    const after = applyEvent(before, ev)
    state = after
    if (ev.seq <= sinceSeq) continue
    linesFor(ev, before, after, play, lineups).forEach((text, i) => {
      res.push({ key: i === 0 ? String(ev.seq) : `${ev.seq}.${i}`, text })
    })
  }
  return res
}

import { applyEvent, INITIAL_LIVE, type GameEventRow, type LiveGame } from './engine'
import { buildPlayByPlay } from './stats'

// Builds an ordered list of audio "cues" per event, GameChanger-style: the
// sound FX first (pitch, then catch / hit / etc.), then the spoken lines —
// the batter up, the pitch call + count, the play, outs, and inning summaries.
// Batted-ball plays are flagged kind:'play' so the server can voice them as a
// natural full sentence rather than a terse stat snippet.

type NameOf = (id: string | null | undefined) => string | null
type Slot = { name: string; jersey: string | null }
type Lineups = { away: Slot[]; home: Slot[] }

export type VoiceKind = 'pitch' | 'play' | 'info' | 'summary'
export type Cue =
  | { type: 'fx'; name: string }
  | { type: 'voice'; key: string; text: string; kind: VoiceKind }

const ONES = ['', 'one', 'two', 'three']
const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th']
const ord = (n: number) => ORD[n] ?? `${n}th`
const bw = (n: number) => (n === 0 ? 'oh' : (ONES[n] ?? String(n)))

function nextBatterName(state: LiveGame, lineups: Lineups): string | null {
  const key = state.half === 'top' ? 'away' : 'home'
  const order = lineups[key]
  if (!order.length) return null
  const idx = (key === 'away' ? state.awayBatterIdx : state.homeBatterIdx) % order.length
  return order[idx]?.name ?? null
}

function batterUp(state: LiveGame, lineups: Lineups): string | null {
  const n = nextBatterName(state, lineups)
  return n ? `Now batting, ${n}.` : null
}

function outsLine(state: LiveGame): string | null {
  if (state.outs <= 0 || state.outs >= 3) return null
  return state.outs === 1 ? 'One out.' : 'Two outs.'
}

function scoreSummary(s: LiveGame): string {
  const a = s.awayScore
  const h = s.homeScore
  if (a === h) return `We're tied up, ${a} to ${a}.`
  return `${h > a ? 'Home' : 'Away'} leads it, ${Math.max(a, h)} to ${Math.min(a, h)}.`
}

function fullCount(s: LiveGame): boolean {
  return s.balls === 3 && s.strikes === 2
}

// FX sequence for an event — plays before the spoken lines.
function fxCues(eventType: string): string[] {
  switch (eventType) {
    case 'pitch_ball':
    case 'pitch_strike':
    case 'walk':
    case 'strikeout':
      return ['pitch', 'catch']
    case 'pitch_foul':
      return ['pitch', 'foul']
    case 'single':
    case 'double':
    case 'triple':
    case 'home_run':
    case 'error':
    case 'fielders_choice':
      return ['pitch', 'hit']
    case 'groundout':
    case 'flyout':
    case 'lineout':
      return ['pitch', 'hit', 'catch']
    case 'stolen_base':
    case 'caught_stealing':
    case 'runner_advance':
    case 'picked_off':
      return ['slide']
    default:
      return []
  }
}

type Line = { text: string; kind: VoiceKind }

function voiceFor(
  ev: GameEventRow,
  _before: LiveGame,
  after: LiveGame,
  play: Map<number, string>,
  lineups: Lineups,
): Line[] {
  const text = play.get(ev.seq)
  const out: (Line | null)[] = []
  const info = (t: string | null): Line | null => (t ? { text: t, kind: 'info' } : null)
  const playLine = (t: string | undefined): Line | null => (t ? { text: t, kind: 'play' } : null)

  switch (ev.event_type) {
    case 'game_start':
      out.push({ text: 'Play ball!', kind: 'info' }, info(batterUp(after, lineups)))
      break
    case 'pitch_ball':
      out.push({
        text: fullCount(after) ? 'Ball three, a full count.' : `Ball ${bw(after.balls)}.`,
        kind: 'pitch',
      })
      break
    case 'pitch_strike':
      out.push({
        text: fullCount(after) ? 'Strike two, a full count.' : `Strike ${bw(after.strikes)}.`,
        kind: 'pitch',
      })
      break
    case 'pitch_foul':
      out.push({ text: 'Fouled away.', kind: 'pitch' })
      break
    case 'walk':
      out.push({ text: 'Ball four — he takes his base.', kind: 'info' }, info(batterUp(after, lineups)))
      break
    case 'strikeout':
      out.push(
        { text: 'Strike three, he is out!', kind: 'info' },
        info(outsLine(after)),
        info(batterUp(after, lineups)),
      )
      break
    case 'single':
    case 'double':
    case 'triple':
    case 'home_run':
    case 'error':
    case 'fielders_choice':
      out.push(playLine(text), info(batterUp(after, lineups)))
      break
    case 'groundout':
    case 'flyout':
    case 'lineout':
      out.push(playLine(text), info(outsLine(after)), info(batterUp(after, lineups)))
      break
    case 'stolen_base':
    case 'caught_stealing':
    case 'runner_advance':
    case 'picked_off':
      out.push(playLine(text))
      break
    // inning_change is handled in freshCues (it needs runs-this-half).
    case 'game_end':
      out.push({ text: `That's the ballgame! ${scoreSummary(after)}`, kind: 'info' })
      break
  }
  return out.filter((l): l is Line => !!l && l.text.trim().length > 0)
}

// A structured recap of a just-completed half-inning — the server voices this
// (kind 'summary') as a natural couple of sentences.
function inningSummary(
  before: LiveGame,
  after: LiveGame,
  runsThisHalf: number,
  lineups: Lineups,
): string {
  const battingTop = before.half === 'top'
  const team = battingTop ? 'the away team' : 'the home team'
  const half = `${battingTop ? 'top' : 'bottom'} of the ${ord(before.inning)}`
  const scored =
    runsThisHalf === 0
      ? `${team} were held scoreless`
      : `${team} put up ${runsThisHalf} run${runsThisHalf === 1 ? '' : 's'}`
  const next = nextBatterName(after, lineups)
  const score = `The score is now away ${after.awayScore}, home ${after.homeScore}.`
  const upNext = next ? ` Leading off next is ${next}.` : ''
  return `End of the ${half}. ${scored} that half. ${score}${upNext}`
}

// All audio cues for events newer than `sinceSeq`, in order.
export function freshCues(
  events: GameEventRow[],
  sinceSeq: number,
  nameOf: NameOf,
  lineups: Lineups,
): Cue[] {
  const sorted = [...events].sort((a, b) => a.seq - b.seq)
  const play = new Map(buildPlayByPlay(events, nameOf).map((p) => [p.seq, p.text]))
  const cues: Cue[] = []
  let state: LiveGame = { ...INITIAL_LIVE }
  let halfAway = 0 // score at the start of the current half-inning
  let halfHome = 0
  for (const ev of sorted) {
    const before = state
    const after = applyEvent(before, ev)
    state = after
    const isInning = ev.event_type === 'inning_change'
    const runsThisHalf = isInning
      ? before.half === 'top'
        ? before.awayScore - halfAway
        : before.homeScore - halfHome
      : 0

    if (ev.seq > sinceSeq) {
      for (const name of fxCues(ev.event_type)) cues.push({ type: 'fx', name })
      if (isInning) {
        cues.push({ type: 'voice', key: String(ev.seq), text: inningSummary(before, after, runsThisHalf, lineups), kind: 'summary' })
      } else {
        voiceFor(ev, before, after, play, lineups).forEach((l, i) => {
          cues.push({ type: 'voice', key: i === 0 ? String(ev.seq) : `${ev.seq}.${i}`, text: l.text, kind: l.kind })
        })
      }
    }
    if (isInning) {
      halfAway = after.awayScore
      halfHome = after.homeScore
    }
  }
  return cues
}

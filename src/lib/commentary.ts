import { applyEvent, INITIAL_LIVE, occupancy, type GameEventRow, type LiveGame } from './engine'
import { buildPlayByPlay } from './stats'

// Builds an ordered list of audio "cues" per event, GameChanger-style: the
// sound FX first (pitch, then catch / hit / etc.), then the spoken lines —
// the batter up, the pitch call + count, the play, outs, and inning summaries.
// Batted-ball plays are flagged kind:'play' so the server can voice them as a
// natural full sentence rather than a terse stat snippet.

type NameOf = (id: string | null | undefined) => string | null
type Slot = { name: string; jersey: string | null }
type Lineups = { away: Slot[]; home: Slot[] }
// Spoken team names (so commentary says "Riverside leads it", not "Away leads it").
type Teams = { away: string; home: string }

export type VoiceKind = 'pitch' | 'play' | 'info' | 'summary'
// A spoken line. (Sound FX are handled separately via fxCues — they play
// immediately, synced to the action, not queued behind commentary.)
export type Cue = { key: string; text: string; kind: VoiceKind }

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
  if (state.outs >= 3) return null // inning's over; the recap covers who's next
  const n = nextBatterName(state, lineups)
  return n ? `Now batting, ${n}.` : null
}

// Leadoff batter of the next half (the other team).
function nextHalfLeadoff(state: LiveGame, lineups: Lineups): string | null {
  const nextKey = state.half === 'top' ? 'home' : 'away'
  const order = lineups[nextKey]
  if (!order.length) return null
  const idx = (nextKey === 'away' ? state.awayBatterIdx : state.homeBatterIdx) % order.length
  return order[idx]?.name ?? null
}

// The situation between batters: who's on base and how many outs.
function situationLine(state: LiveGame): string | null {
  if (state.outs >= 3) return null
  const o = occupancy(state.bases)
  const names: string[] = []
  if (o.first) names.push('first')
  if (o.second) names.push('second')
  if (o.third) names.push('third')
  // Only worth saying when there are runners on, or with two outs.
  if (names.length === 0 && state.outs < 2) return null
  const outs = state.outs === 0 ? 'nobody out' : state.outs === 1 ? 'one out' : 'two outs'
  let bases: string
  if (names.length === 0) bases = 'Bases empty'
  else if (names.length === 3) bases = 'Bases loaded'
  else {
    const list = names.length === 2 ? `${names[0]} and ${names[1]}` : names[0]
    bases = `${names.length === 2 ? 'Runners' : 'Runner'} on ${list}`
  }
  return `${bases}, ${outs}.`
}

// Lines for a new batter stepping in: who's up, then the situation.
function plateLines(state: LiveGame, lineups: Lineups): { text: string; kind: VoiceKind }[] {
  const lines: { text: string; kind: VoiceKind }[] = []
  const b = batterUp(state, lineups)
  if (b) lines.push({ text: b, kind: 'info' })
  const s = situationLine(state)
  if (s) lines.push({ text: s, kind: 'info' })
  return lines
}

function scoreSummary(s: LiveGame, teams: Teams): string {
  const a = s.awayScore
  const h = s.homeScore
  if (a === h) return `We're tied up, ${a} to ${a}.`
  return `${h > a ? teams.home : teams.away} leads it, ${Math.max(a, h)} to ${Math.min(a, h)}.`
}

function fullCount(s: LiveGame): boolean {
  return s.balls === 3 && s.strikes === 2
}

// Sound-FX steps for an event. Each step is a set of sounds layered together;
// steps play one after another (e.g. pitch, then the crack + cheer). Plays
// immediately, synced to the live action — independent of the spoken lines.
export function fxCues(eventType: string): string[][] {
  switch (eventType) {
    case 'pitch_ball':
    case 'pitch_strike':
    case 'walk':
    case 'strikeout':
      return [['pitch'], ['catch']]
    case 'pitch_foul':
      return [['pitch'], ['foul']]
    case 'hit_by_pitch':
      return [['pitch']]
    case 'single':
    case 'double':
    case 'triple':
    case 'home_run':
      return [['pitch'], ['hit', 'cheer']] // crack of the bat + crowd cheer
    case 'error':
    case 'fielders_choice':
      return [['pitch'], ['hit']]
    case 'groundout':
    case 'flyout':
    case 'lineout':
      return [['pitch'], ['hit'], ['catch']]
    case 'stolen_base':
    case 'caught_stealing':
    case 'runner_advance':
    case 'picked_off':
      return [['slide']]
    default:
      return []
  }
}

type Line = { text: string; kind: VoiceKind }

function voiceFor(
  ev: GameEventRow,
  before: LiveGame,
  after: LiveGame,
  play: Map<number, string>,
  lineups: Lineups,
  teams: Teams,
): Line[] {
  const text = play.get(ev.seq)
  const out: (Line | null)[] = []
  const playLine = (t: string | undefined): Line | null => (t ? { text: t, kind: 'play' } : null)
  const plate = () => plateLines(after, lineups)
  const scored = after.awayScore + after.homeScore > before.awayScore + before.homeScore
  // After a play that scored, announce the score, then the next batter.
  const afterPlay = (): Line[] => [
    ...(scored ? [{ text: scoreSummary(after, teams), kind: 'info' as VoiceKind }] : []),
    ...plateLines(after, lineups),
  ]

  switch (ev.event_type) {
    case 'game_start':
      out.push(
        { text: `Welcome to today's game — ${teams.away} taking on ${teams.home}.`, kind: 'info' },
        { text: 'Play ball!', kind: 'info' },
        ...plate(),
      )
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
      out.push({ text: 'Ball four — he takes his base.', kind: 'info' }, ...afterPlay())
      break
    case 'hit_by_pitch':
      out.push(playLine(text) ?? { text: 'Hit by the pitch — he takes his base.', kind: 'info' }, ...afterPlay())
      break
    case 'strikeout':
      out.push({ text: 'Strike three, he is out!', kind: 'info' }, ...plate())
      break
    case 'single':
    case 'double':
    case 'triple':
    case 'home_run':
    case 'error':
    case 'fielders_choice':
      out.push(playLine(text), ...afterPlay())
      break
    case 'groundout':
    case 'flyout':
    case 'lineout':
      out.push(playLine(text), ...afterPlay())
      break
    case 'stolen_base':
    case 'runner_advance':
      // A steal/advance home scores a run — call it (the batter is unchanged).
      out.push(playLine(text))
      if (scored) out.push({ text: scoreSummary(after, teams), kind: 'info' }, ...(situationLine(after) ? [{ text: situationLine(after)!, kind: 'info' as VoiceKind }] : []))
      break
    case 'caught_stealing':
    case 'picked_off':
      out.push(playLine(text))
      break
    case 'inning_change':
      // Start of a new half-inning. (The end-of-half recap fires separately on
      // the 3rd out — see freshCues.)
      out.push(
        { text: `It's the ${after.half === 'top' ? 'top' : 'bottom'} of the ${ord(after.inning)}.`, kind: 'info' },
        ...plate(),
      )
      break
    case 'game_end':
      out.push({ text: `That's the ballgame! ${scoreSummary(after, teams)}`, kind: 'info' })
      break
  }
  return out.filter((l): l is Line => !!l && l.text.trim().length > 0)
}

// A structured recap of a half-inning that just ended on the 3rd out — the
// server voices this (kind 'summary') as a natural couple of sentences.
function inningRecap(state: LiveGame, runsThisHalf: number, lineups: Lineups, teams: Teams): string {
  const battingTop = state.half === 'top'
  const team = battingTop ? teams.away : teams.home
  const half = `${battingTop ? 'top' : 'bottom'} of the ${ord(state.inning)}`
  const scored =
    runsThisHalf === 0
      ? `${team} were held scoreless`
      : `${team} put up ${runsThisHalf} run${runsThisHalf === 1 ? '' : 's'}`
  const next = nextHalfLeadoff(state, lineups)
  const score = `The score is now ${teams.away} ${state.awayScore}, ${teams.home} ${state.homeScore}.`
  return `That's the end of the ${half}. ${scored} that half. ${score}${next ? ` Leading off next, ${next}.` : ''}`
}

// All audio cues for events newer than `sinceSeq`, in order.
export function freshCues(
  events: GameEventRow[],
  sinceSeq: number,
  nameOf: NameOf,
  lineups: Lineups,
  teams: Teams,
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
    // The half ends the moment the 3rd out is recorded (the "end of inning"
    // screen), NOT when the next half is started.
    const halfEnded = before.outs < 3 && after.outs >= 3 && ev.event_type !== 'game_end'
    const runsThisHalf = halfEnded
      ? after.half === 'top'
        ? after.awayScore - halfAway
        : after.homeScore - halfHome
      : 0

    if (ev.seq > sinceSeq) {
      voiceFor(ev, before, after, play, lineups, teams).forEach((l, i) => {
        cues.push({ key: i === 0 ? String(ev.seq) : `${ev.seq}.${i}`, text: l.text, kind: l.kind })
      })
      if (halfEnded) {
        cues.push({ key: `${ev.seq}-sum`, text: inningRecap(after, runsThisHalf, lineups, teams), kind: 'summary' })
      }
    }
    if (halfEnded) {
      halfAway = after.awayScore
      halfHome = after.homeScore
    }
  }
  return cues
}

import { applyEvent, INITIAL_LIVE, occupancy, type GameEventRow, type LiveGame } from './engine'
import { buildPlayByPlay } from './stats'
import { speakableName } from './names'

// Builds an ordered list of audio "cues" per event, GameChanger-style: the
// sound FX first (pitch, then catch / hit / etc.), then the spoken lines —
// the batter up, the pitch call + count, the play, outs, and inning summaries.
// Batted-ball plays are flagged kind:'play' so the server can voice them as a
// natural full sentence rather than a terse stat snippet.

type NameOf = (id: string | null | undefined) => string | null
type Slot = { name: string; jersey: string | null; id?: string }
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

// Spoken intro for a batter — as much as we know: "number 24 Carson S.", "number 24",
// "Carson S.", or null. slot.name is already the FINAL public identity from the server (floored,
// full if the team opted in, a kept "Player 1" label, or a "#24" number). speakableName drops the
// "#24"/empty case so the booth never reads a bare number as a name (the jersey line covers it) and
// never speaks more than the overlay shows.
function announce(slot: Slot | undefined): string | null {
  if (!slot) return null
  const parts: string[] = []
  if (slot.jersey) parts.push(`number ${slot.jersey}`)
  const name = speakableName(slot.name)
  if (name) parts.push(name)
  return parts.length ? parts.join(' ') : null
}

function nextBatterSlot(state: LiveGame, lineups: Lineups): Slot | undefined {
  const key = state.half === 'top' ? 'away' : 'home'
  const order = lineups[key]
  if (!order.length) return undefined
  const idx = (key === 'away' ? state.awayBatterIdx : state.homeBatterIdx) % order.length
  return order[idx]
}

function batterUp(state: LiveGame, lineups: Lineups): string | null {
  if (state.outs >= 3) return null // inning's over; the recap covers who's next
  const n = announce(nextBatterSlot(state, lineups))
  return n ? `Now batting, ${n}.` : null
}

// Leadoff batter of the next half (the other team).
function nextHalfLeadoff(state: LiveGame, lineups: Lineups): string | null {
  const nextKey = state.half === 'top' ? 'home' : 'away'
  const order = lineups[nextKey]
  if (!order.length) return null
  const idx = (nextKey === 'away' ? state.awayBatterIdx : state.homeBatterIdx) % order.length
  return announce(order[idx])
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

// A batter's running line for THIS game — accumulated as freshCues replays the log — so the
// announcer can add "he's oh for one today" when a hitter comes up for a 2nd+ plate appearance.
type DayStat = { ab: number; h: number; bb: number; hbp: number; doubles: number; triples: number; hr: number; k: number }
// A batter is charged an official AB on these (reaching on error / fielder's choice included; walk +
// HBP are plate appearances but NOT at-bats — mirrors stats.ts AB_TYPES).
const AB_EVENTS = new Set<string>([
  'single', 'double', 'triple', 'home_run', 'strikeout', 'groundout', 'flyout', 'infield_fly',
  'lineout', 'error', 'fielders_choice',
])
const HIT_EVENTS = new Set<string>(['single', 'double', 'triple', 'home_run'])
// Words for the "H for AB" line — spoken, never bare digits ("oh for two", not "0 for 2").
const FORW = ['oh', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']
const forW = (n: number) => FORW[n] ?? String(n)
const timesW = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${forW(n)} times`)

function tallyDay(d: DayStat, type: string): DayStat {
  if (AB_EVENTS.has(type)) d.ab += 1
  if (HIT_EVENTS.has(type)) d.h += 1
  if (type === 'double') d.doubles += 1
  else if (type === 'triple') d.triples += 1
  else if (type === 'home_run') d.hr += 1
  else if (type === 'strikeout') d.k += 1
  else if (type === 'walk') d.bb += 1
  else if (type === 'hit_by_pitch') d.hbp += 1
  return d
}

// "Carson S. is one for two today, with a double." — null on a batter's FIRST time up (no line yet).
function dayLineText(name: string | null, d: DayStat | undefined): string | null {
  if (!d) return null
  const who = name || 'He'
  if (d.ab === 0) {
    const on = d.bb + d.hbp
    if (on === 0) return null
    if (d.bb && !d.hbp) return `${who} has walked ${timesW(d.bb)} today.`
    return `${who} has reached base ${timesW(on)} today.`
  }
  let s = `${who} is ${forW(d.h)} for ${forW(d.ab)} today`
  if (d.hr) s += ', with a home run'
  else if (d.triples) s += ', with a triple'
  else if (d.doubles) s += ', with a double'
  return `${s}.`
}

// Lines for a new batter stepping in: who's up, their day line (2nd+ PA), then the situation.
function plateLines(
  state: LiveGame,
  lineups: Lineups,
  dayLineFor?: (slot: Slot | undefined) => string | null,
): { text: string; kind: VoiceKind }[] {
  const lines: { text: string; kind: VoiceKind }[] = []
  const b = batterUp(state, lineups)
  if (b) lines.push({ text: b, kind: 'info' })
  if (b && dayLineFor) {
    const dl = dayLineFor(nextBatterSlot(state, lineups))
    if (dl) lines.push({ text: dl, kind: 'info' })
  }
  const s = situationLine(state)
  if (s) lines.push({ text: s, kind: 'info' })
  return lines
}

// Speak scores as WORDS, never bare digits. ElevenLabs mangles a digit that abuts another number —
// e.g. a team ending in a numeral ("Test Team 1") next to the score ("0") is heard as "one nero".
// Words remove the adjacency entirely; "nothing" is also idiomatic baseball for zero.
const SCORE_ONES = [
  'nothing', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
]
const SCORE_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
function sayScore(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n)
  if (n < 20) return SCORE_ONES[n]
  if (n < 100) {
    const t = Math.floor(n / 10)
    const o = n % 10
    return o ? `${SCORE_TENS[t]}-${SCORE_ONES[o]}` : SCORE_TENS[t]
  }
  return String(n)
}

function scoreSummary(s: LiveGame, teams: Teams): string {
  const a = s.awayScore
  const h = s.homeScore
  if (a === h) return a === 0 ? `We're still scoreless.` : `We're tied up, ${sayScore(a)} to ${sayScore(a)}.`
  return `${h > a ? teams.home : teams.away} leads it, ${sayScore(Math.max(a, h))} to ${sayScore(Math.min(a, h))}.`
}

// Game-over phrasing: a winner WINS (not "leads").
function finalSummary(s: LiveGame, teams: Teams): string {
  const a = s.awayScore
  const h = s.homeScore
  if (a === h) return a === 0 ? `It ends in a scoreless tie.` : `It ends in a ${sayScore(a)} to ${sayScore(a)} tie.`
  return `${h > a ? teams.home : teams.away} wins, ${sayScore(Math.max(a, h))} to ${sayScore(Math.min(a, h))}.`
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
      return [['pitch'], ['hit'], ['cheer']] // pitch, crack of the bat, THEN the crowd
    case 'manual_run':
      return [['cheer']] // scoreboard-mode run (no detailed play → no crack)
    case 'manual_out':
      return [['catch']] // scoreboard-mode out — a glove pop, no play-by-play
    case 'home_run':
      return [['pitch'], ['hit', 'cheer']] // crack of the bat + crowd cheer
    case 'error':
    case 'fielders_choice':
      return [['pitch'], ['hit']]
    case 'groundout':
    case 'flyout':
    case 'infield_fly':
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
  dayLineFor?: (slot: Slot | undefined) => string | null,
): Line[] {
  const text = play.get(ev.seq)
  const out: (Line | null)[] = []
  const playLine = (t: string | undefined): Line | null => (t ? { text: t, kind: 'play' } : null)
  const plate = () => plateLines(after, lineups, dayLineFor)
  const scored = after.awayScore + after.homeScore > before.awayScore + before.homeScore
  // After a play that scored, announce the score, then the next batter.
  const afterPlay = (): Line[] => [
    ...(scored ? [{ text: scoreSummary(after, teams), kind: 'info' as VoiceKind }] : []),
    ...plateLines(after, lineups, dayLineFor),
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
    case 'infield_fly':
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
    case 'manual_run':
      out.push({
        text: `${ev.payload?.team === 'home' ? teams.home : teams.away} pushes a run across. ${scoreSummary(after, teams)}`,
        kind: 'info',
      })
      break
    case 'game_end':
      out.push({ text: `That's the ballgame! ${finalSummary(after, teams)}`, kind: 'info' })
      break
  }
  return out.filter((l): l is Line => !!l && l.text.trim().length > 0)
}

// A structured recap of a half-inning that just ended on the 3rd out — the
// server voices this (kind 'summary') as a natural couple of sentences.
function inningRecap(state: LiveGame, runsThisHalf: number, lineups: Lineups, teams: Teams): string {
  const battingTop = state.half === 'top'
  const team = battingTop ? teams.away : teams.home
  // Top half ending = the middle of the inning; bottom half ending = the inning is
  // complete, so call it "the end of the Nth inning" (not "the bottom of the Nth").
  const marker = battingTop
    ? `That's the middle of the ${ord(state.inning)}.`
    : `That's the end of the ${ord(state.inning)} inning.`
  const scored =
    runsThisHalf === 0
      ? `${team} were held scoreless`
      : `${team} put up ${runsThisHalf} run${runsThisHalf === 1 ? '' : 's'}`
  const next = nextHalfLeadoff(state, lineups)
  const score = `The score is now ${teams.away} ${sayScore(state.awayScore)}, ${teams.home} ${sayScore(state.homeScore)}.`
  return `${marker} ${scored} that half. ${score}${next ? ` Leading off next, ${next}.` : ''}`
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
  // Per-batter running line for this game (keyed by player id). Accumulated for EVERY event below
  // (even ones before sinceSeq) so a hitter's day line is complete when they come up again.
  const day = new Map<string, DayStat>()
  const dayLineFor = (slot: Slot | undefined): string | null => {
    if (!slot?.id) return null // no identity → can't look up the line (e.g. legacy/ghost slot)
    return dayLineText(nameOf(slot.id) || null, day.get(slot.id))
  }
  const isPA = (t: string) => AB_EVENTS.has(t) || t === 'walk' || t === 'hit_by_pitch'
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
      voiceFor(ev, before, after, play, lineups, teams, dayLineFor).forEach((l, i) => {
        cues.push({ key: i === 0 ? String(ev.seq) : `${ev.seq}.${i}`, text: l.text, kind: l.kind })
      })
      if (halfEnded) {
        cues.push({ key: `${ev.seq}-sum`, text: inningRecap(after, runsThisHalf, lineups, teams), kind: 'summary' })
      }
    }
    // Tally AFTER emitting, so the coming-up batter's day line reflects only PRIOR plate appearances.
    if (ev.batter_id && isPA(ev.event_type)) {
      const d = day.get(ev.batter_id) ?? { ab: 0, h: 0, bb: 0, hbp: 0, doubles: 0, triples: 0, hr: 0, k: 0 }
      day.set(ev.batter_id, tallyDay(d, ev.event_type))
    }
    if (halfEnded) {
      halfAway = after.awayScore
      halfHome = after.homeScore
    }
  }
  return cues
}

import { applyEvent, INITIAL_LIVE, type EventType, type GameEventRow, type LiveGame } from './engine'
import type { Half } from './types'

// ---------------------------------------------------------------------------
// Box score (line score) — derived by replaying the event log and bucketing
// runs by the inning/half that was batting when they scored.
// ---------------------------------------------------------------------------
export type TeamBox = {
  runsByInning: number[] // index 0 = inning 1
  r: number
  h: number
  e: number
}

export type BoxScore = {
  innings: number
  away: TeamBox
  home: TeamBox
}

const HIT_TYPES: EventType[] = ['single', 'double', 'triple', 'home_run']

export function computeBoxScore(events: GameEventRow[]): BoxScore {
  const away: TeamBox = { runsByInning: [], r: 0, h: 0, e: 0 }
  const home: TeamBox = { runsByInning: [], r: 0, h: 0, e: 0 }
  let state: LiveGame = INITIAL_LIVE
  let maxInning = 1

  const sorted = events.slice().sort((a, b) => a.seq - b.seq)
  for (const ev of sorted) {
    const before = state
    const after = applyEvent(before, ev)
    const battingTop = before.half === 'top'
    const team = battingTop ? away : home
    const inningIdx = Math.max(0, before.inning - 1)

    // runs scored during this event go to the team that was batting
    const dRuns = battingTop
      ? after.awayScore - before.awayScore
      : after.homeScore - before.homeScore
    if (dRuns > 0) {
      ensure(team.runsByInning, inningIdx)
      team.runsByInning[inningIdx] += dRuns
      team.r += dRuns
    }

    if (HIT_TYPES.includes(ev.event_type)) team.h += 1
    // an error is charged to the fielding (defending) team
    if (ev.event_type === 'error') (battingTop ? home : away).e += 1

    maxInning = Math.max(maxInning, before.inning, after.inning)
    state = after
  }

  // pad inning arrays to the innings played so the grid lines up
  ensure(away.runsByInning, maxInning - 1)
  ensure(home.runsByInning, maxInning - 1)
  return { innings: maxInning, away, home }
}

function ensure(arr: number[], idx: number) {
  while (arr.length <= idx) arr.push(0)
}

// ---------------------------------------------------------------------------
// Per-player batting lines — grouped by batter, attributed to the team that was
// batting (derived by replay). AB excludes walks/HBP.
// ---------------------------------------------------------------------------
export type BattingLine = {
  playerId: string
  name: string
  ab: number
  h: number
  doubles: number
  triples: number
  hr: number
  bb: number
  k: number
  avg: number // H / AB
}

export type BattingLines = { away: BattingLine[]; home: BattingLine[] }

const AB_TYPES: EventType[] = [
  'single', 'double', 'triple', 'home_run',
  'strikeout', 'groundout', 'flyout', 'lineout', 'error', 'fielders_choice',
]

export function computeBattingLines(
  events: GameEventRow[],
  batterName: (batterId: string) => string | null,
): BattingLines {
  // playerId -> { team, line }
  const acc = new Map<string, { top: boolean; line: BattingLine }>()
  let state: LiveGame = INITIAL_LIVE

  const sorted = events.slice().sort((a, b) => a.seq - b.seq)
  for (const ev of sorted) {
    const before = state
    state = applyEvent(before, ev)
    const id = ev.batter_id
    if (!id) continue
    let entry = acc.get(id)
    if (!entry) {
      entry = {
        top: before.half === 'top',
        line: { playerId: id, name: batterName(id) ?? '—', ab: 0, h: 0, doubles: 0, triples: 0, hr: 0, bb: 0, k: 0, avg: 0 },
      }
      acc.set(id, entry)
    }
    const l = entry.line
    if (AB_TYPES.includes(ev.event_type)) l.ab += 1
    if (HIT_TYPES.includes(ev.event_type)) l.h += 1
    if (ev.event_type === 'double') l.doubles += 1
    if (ev.event_type === 'triple') l.triples += 1
    if (ev.event_type === 'home_run') l.hr += 1
    if (ev.event_type === 'walk') l.bb += 1
    if (ev.event_type === 'strikeout') l.k += 1
  }

  const away: BattingLine[] = []
  const home: BattingLine[] = []
  for (const { top, line } of acc.values()) {
    line.avg = line.ab > 0 ? line.h / line.ab : 0
    ;(top ? away : home).push(line)
  }
  return { away, home }
}

// ".333" style, no leading zero
export function formatAvg(avg: number): string {
  if (avg <= 0) return '.000'
  return avg.toFixed(3).replace(/^0/, '')
}

// ---------------------------------------------------------------------------
// Play-by-play — human descriptions of the notable (non-pitch) events.
// ---------------------------------------------------------------------------
export type PlayKind = 'scoring' | 'out' | 'hit' | 'neutral'

export type PlayLine = {
  seq: number
  inning: number
  half: Half
  text: string
  kind: PlayKind
}

// Events that belong in the play feed (pitches are excluded).
const FEED_TYPES = new Set<EventType>([
  'single', 'double', 'triple', 'home_run', 'walk', 'hit_by_pitch', 'strikeout',
  'groundout', 'flyout', 'lineout', 'error', 'fielders_choice', 'inning_change',
  'game_start', 'game_end',
])

export function buildPlayByPlay(
  events: GameEventRow[],
  batterName: (batterId: string | null | undefined) => string | null,
): PlayLine[] {
  const lines: PlayLine[] = []
  let state: LiveGame = INITIAL_LIVE
  const sorted = events.slice().sort((a, b) => a.seq - b.seq)

  for (const ev of sorted) {
    const before = state
    const after = applyEvent(before, ev)
    if (FEED_TYPES.has(ev.event_type)) {
      const scored = after.awayScore + after.homeScore > before.awayScore + before.homeScore
      lines.push({
        seq: ev.seq,
        inning: before.inning,
        half: before.half,
        text: describe(ev, before, after, batterName(ev.batter_id)),
        kind: playKind(ev.event_type, scored),
      })
    }
    state = after
  }
  return lines.reverse() // newest first
}

function playKind(type: EventType, scored: boolean): PlayKind {
  if (scored || type === 'home_run') return 'scoring'
  if (type === 'strikeout') return 'out'
  if (type === 'groundout' || type === 'flyout' || type === 'lineout' || type === 'fielders_choice')
    return 'out'
  if (HIT_TYPES.includes(type) || type === 'walk' || type === 'hit_by_pitch' || type === 'error')
    return 'hit'
  return 'neutral'
}

function describe(
  ev: GameEventRow,
  before: LiveGame,
  after: LiveGame,
  name: string | null,
): string {
  const who = name ?? 'Batter'
  const runs = after.awayScore + after.homeScore - (before.awayScore + before.homeScore)
  const rbi = runs > 0 ? ` (${runs} run${runs === 1 ? '' : 's'})` : ''
  switch (ev.event_type) {
    case 'game_start':
      return 'Play ball!'
    case 'game_end':
      return 'Final.'
    case 'inning_change':
      return after.half === 'top'
        ? `End of the ${ordinal(before.inning)} — middle break.`
        : `Middle of the ${ordinal(before.inning)}.`
    case 'single':
      return `${who} singles${rbi}.`
    case 'double':
      return `${who} doubles${rbi}.`
    case 'triple':
      return `${who} triples${rbi}.`
    case 'home_run':
      return `${who} homers${rbi}.`
    case 'walk':
      return `${who} walks.`
    case 'hit_by_pitch':
      return `${who} hit by pitch.`
    case 'strikeout':
      return `${who} strikes out.`
    case 'groundout':
      return `${who} grounds out.`
    case 'flyout':
      return `${who} flies out.`
    case 'lineout':
      return `${who} lines out.`
    case 'error':
      return `${who} reaches on an error${rbi}.`
    case 'fielders_choice':
      return `${who} reaches on a fielder's choice.`
    default:
      return who
  }
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

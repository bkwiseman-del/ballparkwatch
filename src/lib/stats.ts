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
  r: number // runs scored
  h: number
  rbi: number
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
// A run scoring on these is an RBI for the batter (not on errors or steals).
const RBI_TYPES = new Set<EventType>([
  'single', 'double', 'triple', 'home_run', 'walk', 'hit_by_pitch',
  'groundout', 'flyout', 'lineout', 'fielders_choice',
])

// The player ids that scored on this event (for crediting runs / earned runs).
function scorersOf(ev: GameEventRow, before: LiveGame, runs: number): string[] {
  const res = ev.payload?.resolution
  const ids: string[] = []
  if (res) {
    if (ev.batter_id && res.batter === 4) ids.push(ev.batter_id)
    for (const [pid, dest] of Object.entries(res.runners ?? {})) if (dest === 4) ids.push(pid)
  } else if ((ev.event_type === 'stolen_base' || ev.event_type === 'runner_advance') && ev.payload?.runner) {
    if (Number(ev.payload?.to) === 4) ids.push(ev.payload.runner)
  } else if ((ev.event_type === 'walk' || ev.event_type === 'hit_by_pitch') && runs > 0 && before.bases.third) {
    ids.push(before.bases.third) // forced home from third
  }
  return ids
}

export function computeBattingLines(
  events: GameEventRow[],
  batterName: (batterId: string) => string | null,
): BattingLines {
  // playerId -> { team, line }
  const acc = new Map<string, { top: boolean; line: BattingLine }>()
  const ensure = (id: string, top: boolean) => {
    let e = acc.get(id)
    if (!e) {
      e = {
        top,
        line: { playerId: id, name: batterName(id) ?? '—', ab: 0, r: 0, h: 0, rbi: 0, doubles: 0, triples: 0, hr: 0, bb: 0, k: 0, avg: 0 },
      }
      acc.set(id, e)
    }
    return e.line
  }
  let state: LiveGame = INITIAL_LIVE

  const sorted = events.slice().sort((a, b) => a.seq - b.seq)
  for (const ev of sorted) {
    const before = state
    state = applyEvent(before, ev)
    const runs = state.awayScore + state.homeScore - (before.awayScore + before.homeScore)

    const id = ev.batter_id
    if (id) {
      const l = ensure(id, before.half === 'top')
      if (AB_TYPES.includes(ev.event_type)) l.ab += 1
      if (HIT_TYPES.includes(ev.event_type)) l.h += 1
      if (ev.event_type === 'double') l.doubles += 1
      if (ev.event_type === 'triple') l.triples += 1
      if (ev.event_type === 'home_run') l.hr += 1
      if (ev.event_type === 'walk') l.bb += 1
      if (ev.event_type === 'strikeout') l.k += 1
      if (runs > 0 && RBI_TYPES.has(ev.event_type)) l.rbi += runs
    }
    // Credit the run to whoever crossed the plate (runners are on the batting team).
    if (runs > 0) {
      for (const sid of scorersOf(ev, before, runs)) ensure(sid, before.half === 'top').r += 1
    }
  }

  const away: BattingLine[] = []
  const home: BattingLine[] = []
  for (const { top, line } of acc.values()) {
    line.avg = line.ab > 0 ? line.h / line.ab : 0
    ;(top ? away : home).push(line)
  }
  return { away, home }
}

// ---------------------------------------------------------------------------
// Pitching lines — IP / H / R / ER / BB / SO per pitcher. The fielding team's
// current pitcher (the player at position P, following substitutions) is charged.
// ---------------------------------------------------------------------------
export type PitchingLine = {
  playerId: string
  name: string
  outs: number // IP = outs / 3
  h: number
  r: number
  er: number
  bb: number
  k: number
}
export type PitchingLines = { away: PitchingLine[]; home: PitchingLine[] }
export type StartPositions = { away: Record<string, string | null>; home: Record<string, string | null> }

export function computePitchingLines(
  events: GameEventRow[],
  start: StartPositions,
  nameOf: (id: string) => string | null,
): PitchingLines {
  const startingP = (m: Record<string, string | null>) =>
    Object.entries(m).find(([, pos]) => pos === 'P')?.[0] ?? null
  const curP: { away: string | null; home: string | null } = {
    away: startingP(start.away),
    home: startingP(start.home),
  }
  const acc = new Map<string, { team: 'away' | 'home'; line: PitchingLine }>()
  const ensure = (id: string, team: 'away' | 'home') => {
    let e = acc.get(id)
    if (!e) {
      e = { team, line: { playerId: id, name: nameOf(id) ?? '—', outs: 0, h: 0, r: 0, er: 0, bb: 0, k: 0 } }
      acc.set(id, e)
    }
    return e.line
  }
  const errReached = new Set<string>() // runners who reached on error → their runs are unearned
  let state: LiveGame = INITIAL_LIVE

  const skipOuts = new Set<EventType>(['inning_change', 'end_half', 'game_end', 'game_start', 'substitution'])
  for (const ev of events.slice().sort((a, b) => a.seq - b.seq)) {
    const before = state
    const after = applyEvent(before, ev)

    if (ev.event_type === 'substitution') {
      const team = ev.payload?.team as 'away' | 'home' | undefined
      for (const mv of (ev.payload?.moves ?? []) as { in_id: string; position?: string }[]) {
        if (mv.position === 'P' && team) curP[team] = mv.in_id
      }
    }
    if (ev.event_type === 'inning_change' || ev.event_type === 'end_half') errReached.clear()

    const fielding: 'away' | 'home' = before.half === 'top' ? 'home' : 'away'
    const pid = curP[fielding]
    if (pid) {
      const l = ensure(pid, fielding)
      if (!skipOuts.has(ev.event_type)) l.outs += Math.max(0, after.outs - before.outs)
      if (HIT_TYPES.includes(ev.event_type)) l.h += 1
      if (ev.event_type === 'walk') l.bb += 1
      if (ev.event_type === 'strikeout') l.k += 1
      const runs = after.awayScore + after.homeScore - (before.awayScore + before.homeScore)
      if (runs > 0) {
        l.r += runs
        const scorers = scorersOf(ev, before, runs)
        const unearned = scorers.filter((s) => errReached.has(s)).length
        l.er += Math.max(0, runs - unearned)
      }
    }
    if (ev.event_type === 'error' && ev.batter_id) errReached.add(ev.batter_id)
    state = after
  }

  const away: PitchingLine[] = []
  const home: PitchingLine[] = []
  for (const { team, line } of acc.values()) (team === 'away' ? away : home).push(line)
  return { away, home }
}

// Outs → "3.1" innings-pitched display (thirds).
export function formatIp(outs: number): string {
  return `${Math.floor(outs / 3)}.${outs % 3}`
}

// Pitch count per team's pitcher. The home pitcher throws in the top halves,
// the away pitcher in the bottom halves. Each of these events is one pitch.
const PITCH_COUNTED = new Set<EventType>([
  'pitch_ball', 'pitch_strike', 'pitch_foul',
  'single', 'double', 'triple', 'home_run', 'walk', 'hit_by_pitch', 'strikeout',
  'groundout', 'flyout', 'lineout', 'error', 'fielders_choice',
])

export function pitchCounts(events: GameEventRow[]): { home: number; away: number } {
  let state: LiveGame = INITIAL_LIVE
  let home = 0
  let away = 0
  for (const ev of events.slice().sort((a, b) => a.seq - b.seq)) {
    const before = state
    state = applyEvent(before, ev)
    if (PITCH_COUNTED.has(ev.event_type)) {
      if (before.half === 'top') home += 1 // home team is pitching
      else away += 1
    }
  }
  return { home, away }
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

type NameOf = (id: string | null | undefined) => string | null

// Events that belong in the play feed (pitches are excluded).
const FEED_TYPES = new Set<EventType>([
  'single', 'double', 'triple', 'home_run', 'walk', 'hit_by_pitch', 'strikeout',
  'groundout', 'flyout', 'lineout', 'error', 'fielders_choice',
  'runner_advance', 'stolen_base', 'caught_stealing', 'picked_off',
  'inning_change', 'game_start', 'game_end',
])

export function buildPlayByPlay(events: GameEventRow[], nameOf: NameOf): PlayLine[] {
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
        text: describe(ev, before, after, nameOf),
        kind: playKind(ev.event_type, scored),
      })
    }
    state = after
  }
  return lines.reverse() // newest first
}

function playKind(type: EventType, scored: boolean): PlayKind {
  if (scored || type === 'home_run') return 'scoring'
  if (['strikeout', 'groundout', 'flyout', 'lineout', 'fielders_choice', 'caught_stealing', 'picked_off'].includes(type))
    return 'out'
  if (HIT_TYPES.includes(type) || ['walk', 'hit_by_pitch', 'error', 'stolen_base'].includes(type))
    return 'hit'
  return 'neutral'
}

const POS_LABEL: Record<number, string> = {
  1: 'pitcher', 2: 'catcher', 3: 'first', 4: 'second', 5: 'third',
  6: 'short', 7: 'left', 8: 'center', 9: 'right',
}
function baseWord(b: number): string {
  return b === 1 ? 'first' : b === 2 ? 'second' : b === 3 ? 'third' : 'home'
}

// Secondary outcomes (runners scoring/advancing/out) from the per-runner advances.
function detailFrom(advances: { id: string; from: number; to: number }[] | undefined, nameOf: NameOf): string {
  if (!advances) return ''
  const parts: string[] = []
  for (const a of advances) {
    if (a.to === a.from) continue // held
    const nm = nameOf(a.id) ?? 'Runner'
    if (a.to === 4) parts.push(`${nm} scores`)
    else if (a.to === 0) parts.push(`${nm} out`)
    else parts.push(`${nm} to ${baseWord(a.to)}`)
  }
  return parts.join(', ')
}

function describe(ev: GameEventRow, before: LiveGame, after: LiveGame, nameOf: NameOf): string {
  const who = nameOf(ev.batter_id) ?? 'Batter'
  const f = ev.payload?.fielders
  const seq = f && f.length ? f.join('–') : ''
  const detail = detailFrom(ev.payload?.advances, nameOf)
  const withDetail = (base: string) => (detail ? `${base}; ${detail}.` : `${base}.`)

  switch (ev.event_type) {
    case 'game_start':
      return 'Play ball!'
    case 'game_end':
      return 'Final.'
    case 'inning_change':
      return after.half === 'top'
        ? `End of the ${ordinal(before.inning)}.`
        : `Middle of the ${ordinal(before.inning)}.`
    case 'single':
      return withDetail(`${who} singles`)
    case 'double':
      return withDetail(`${who} doubles`)
    case 'triple':
      return withDetail(`${who} triples`)
    case 'home_run':
      return withDetail(`${who} homers`)
    case 'walk':
      return withDetail(`${who} walks`)
    case 'hit_by_pitch':
      return withDetail(`${who} hit by pitch`)
    case 'strikeout':
      return `${who} strikes out.`
    case 'groundout':
      return withDetail(
        f && f.length > 1 ? `${who} grounds into ${seq}` : f && f.length === 1 ? `${who} grounds out to ${POS_LABEL[f[0]]}` : `${who} grounds out`,
      )
    case 'flyout':
      return withDetail(f && f.length ? `${who} flies out to ${POS_LABEL[f[0]]}` : `${who} flies out`)
    case 'lineout':
      return withDetail(f && f.length ? `${who} lines out to ${POS_LABEL[f[0]]}` : `${who} lines out`)
    case 'error':
      return withDetail(`${who} reaches on an error${f && f.length ? ` by ${POS_LABEL[f[0]]}` : ''}`)
    case 'fielders_choice':
      return withDetail(`${who} reaches on a fielder's choice${seq ? ` (${seq})` : ''}`)
    // baserunning
    case 'stolen_base':
      return `${nameOf(ev.payload?.runner) ?? 'Runner'} steals ${baseWord(Number(ev.payload?.to))}.`
    case 'runner_advance':
      return Number(ev.payload?.to) === 4
        ? `${nameOf(ev.payload?.runner) ?? 'Runner'} scores.`
        : `${nameOf(ev.payload?.runner) ?? 'Runner'} to ${baseWord(Number(ev.payload?.to))}.`
    case 'caught_stealing':
      return `${nameOf(ev.payload?.runner) ?? 'Runner'} caught stealing.`
    case 'picked_off':
      return `${nameOf(ev.payload?.runner) ?? 'Runner'} picked off.`
    default:
      return who
  }
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

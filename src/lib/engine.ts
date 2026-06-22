import type { Half } from './types'

// ---------------------------------------------------------------------------
// Event taxonomy. game_events.event_type stores one of these; payload holds
// detail. PA-completing in-play results carry a `resolution` payload describing
// exactly where the batter and every runner ended up.
// ---------------------------------------------------------------------------
export type EventType =
  | 'game_start'
  | 'game_end'
  | 'inning_change'
  | 'pitch_ball'
  | 'pitch_strike'
  | 'pitch_foul'
  | 'pitch_in_play'
  | 'single'
  | 'double'
  | 'triple'
  | 'home_run'
  | 'walk'
  | 'hit_by_pitch'
  | 'strikeout'
  | 'groundout'
  | 'flyout'
  | 'lineout'
  | 'error'
  | 'fielders_choice'
  // mid-at-bat baserunning (do not end the at-bat)
  | 'runner_advance'
  | 'stolen_base'
  | 'caught_stealing'
  | 'picked_off'

// Destination of a base path: 0 = out, 1/2/3 = base, 4 = scored (home).
export type Dest = 0 | 1 | 2 | 3 | 4

// Where the batter and each existing runner (by player id) ended up on a play.
export type Resolution = {
  batter: Dest
  runners: Record<string, Dest>
}

export type EventPayload = {
  resolution?: Resolution
  // per-runner movement for play-by-play detail (from/to bases; 0=out, 4=home)
  advances?: { id: string; from: number; to: Dest }[]
  // mid-AB baserunning
  runner?: string
  to?: Dest
  // strike classification: 'swinging' | 'looking' | 'foul_tip'
  kind?: string
  // fielders involved (e.g. [6,4,3]) and rbi credited — for stats/PBP
  fielders?: number[]
  rbi?: number
  // free-form landing point for hits, or zone label for outs
  spray?: { x: number; y: number }
  location?: string
  [k: string]: unknown
}

export type GameEventInput = {
  event_type: EventType
  payload?: EventPayload
}

export type GameEventRow = GameEventInput & { seq: number; batter_id?: string | null }

// ---------------------------------------------------------------------------
// Live projected state. Bases hold the *player id* on each base (or null).
// ---------------------------------------------------------------------------
export type Bases = { first: string | null; second: string | null; third: string | null }

export type LiveGame = {
  status: 'scheduled' | 'live' | 'final'
  inning: number
  half: Half
  outs: number
  balls: number
  strikes: number
  awayScore: number
  homeScore: number
  bases: Bases
  awayBatterIdx: number
  homeBatterIdx: number
}

export const INITIAL_LIVE: LiveGame = {
  status: 'scheduled',
  inning: 1,
  half: 'top',
  outs: 0,
  balls: 0,
  strikes: 0,
  awayScore: 0,
  homeScore: 0,
  bases: { first: null, second: null, third: null },
  awayBatterIdx: 0,
  homeBatterIdx: 0,
}

export const EVENT_LABELS: Record<EventType, string> = {
  game_start: 'Game start',
  game_end: 'Game end',
  inning_change: 'Inning change',
  pitch_ball: 'Ball',
  pitch_strike: 'Strike',
  pitch_foul: 'Foul',
  pitch_in_play: 'In play',
  single: 'Single',
  double: 'Double',
  triple: 'Triple',
  home_run: 'Home run',
  walk: 'Walk',
  hit_by_pitch: 'Hit by pitch',
  strikeout: 'Strikeout',
  groundout: 'Groundout',
  flyout: 'Flyout',
  lineout: 'Lineout',
  error: 'Error',
  fielders_choice: "Fielder's choice",
  runner_advance: 'Runner advance',
  stolen_base: 'Stolen base',
  caught_stealing: 'Caught stealing',
  picked_off: 'Picked off',
}

// Event-type groupings used across the app.
export const PITCH_TYPES: EventType[] = ['pitch_ball', 'pitch_strike', 'pitch_foul', 'pitch_in_play']
export const HIT_TYPES: EventType[] = ['single', 'double', 'triple', 'home_run']
export const IN_PLAY_RESULTS: EventType[] = [
  'single', 'double', 'triple', 'home_run', 'groundout', 'flyout', 'lineout', 'error', 'fielders_choice',
]
// Events that end a plate appearance (advance the batting order).
export const PA_ENDING: EventType[] = [...IN_PLAY_RESULTS, 'walk', 'hit_by_pitch', 'strikeout']

// Default bases reached for the batter on a clean in-play result.
const RESULT_BATTER_DEST: Partial<Record<EventType, Dest>> = {
  single: 1,
  double: 2,
  triple: 3,
  home_run: 4,
  error: 1,
  fielders_choice: 1,
  groundout: 0,
  flyout: 0,
  lineout: 0,
}

// ---------------------------------------------------------------------------
// Reducer. Replaying the whole log is cheap and makes undo trivial.
// ---------------------------------------------------------------------------
export function project(events: GameEventRow[]): LiveGame {
  return events
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .reduce(applyEvent, clone(INITIAL_LIVE))
}

export function applyEvent(prev: LiveGame, e: GameEventRow): LiveGame {
  const s = clone(prev)
  const batterId = e.batter_id ?? null
  switch (e.event_type) {
    case 'game_start':
      s.status = 'live'
      break
    case 'game_end':
      s.status = 'final'
      break
    case 'inning_change':
      nextHalf(s)
      break

    case 'pitch_ball':
      s.balls += 1
      if (s.balls >= 4) {
        forcedAdvance(s, batterId)
        endAtBat(s)
      }
      break
    case 'pitch_strike':
      s.strikes += 1
      if (s.strikes >= 3) {
        recordOut(s)
        endAtBat(s)
      }
      break
    case 'pitch_foul':
      if (s.strikes < 2) s.strikes += 1
      break
    case 'pitch_in_play':
      break

    case 'walk':
    case 'hit_by_pitch':
      forcedAdvance(s, batterId)
      endAtBat(s)
      break

    case 'single':
    case 'double':
    case 'triple':
    case 'home_run':
    case 'error':
    case 'fielders_choice':
    case 'groundout':
    case 'flyout':
    case 'lineout':
      applyResolution(s, e)
      endAtBat(s)
      break

    case 'strikeout':
      recordOut(s)
      endAtBat(s)
      break

    // --- mid-at-bat baserunning (no PA change, no count reset) ---
    case 'stolen_base':
    case 'runner_advance': {
      const pid = e.payload?.runner
      const to = e.payload?.to
      if (pid && to != null) moveRunner(s, pid, to)
      break
    }
    case 'caught_stealing':
    case 'picked_off': {
      const pid = e.payload?.runner
      if (pid) {
        removeRunner(s, pid)
        recordOut(s)
        if (s.outs >= 3) clearBases(s)
      }
      break
    }
  }
  return s
}

// ---- resolution ----------------------------------------------------------

// Apply an explicit per-runner resolution. Falls back to automatic advancement
// (legacy behaviour) when no resolution payload is present, so events scored
// before this model still project correctly.
function applyResolution(s: LiveGame, e: GameEventRow) {
  const res = e.payload?.resolution
  const batterId = e.batter_id ?? null
  if (!res) {
    autoAdvanceByType(s, e.event_type, batterId)
    return
  }
  const old = s.bases
  const next: Bases = { first: null, second: null, third: null }
  let runs = 0

  const place = (pid: string, dest: Dest) => {
    if (dest === 0) {
      recordOut(s)
    } else if (dest === 4) {
      runs += 1
    } else {
      setBase(next, dest, pid)
    }
  }

  // existing runners
  for (const base of [1, 2, 3] as const) {
    const pid = getBase(old, base)
    if (!pid) continue
    const dest = res.runners[pid] ?? (base as Dest) // default: hold
    place(pid, dest)
  }
  // batter
  if (batterId) place(batterId, res.batter)

  s.bases = next
  addRuns(s, runs)
}

// Legacy auto-advance: everyone moves by the hit value; outs are batter-out.
function autoAdvanceByType(s: LiveGame, type: EventType, batterId: string | null) {
  const dest = RESULT_BATTER_DEST[type]
  if (dest === 0 || dest === undefined) {
    // an out (or unknown) — batter out, runners hold
    if (dest === 0) recordOut(s)
    return
  }
  const n = dest // 1..4
  const old = s.bases
  const next: Bases = { first: null, second: null, third: null }
  let runs = 0
  const advance = (pid: string, from: number) => {
    const nb = from + n
    if (nb >= 4) runs += 1
    else setBase(next, nb as Dest, pid)
  }
  for (const base of [3, 2, 1] as const) {
    const pid = getBase(old, base)
    if (pid) advance(pid, base)
  }
  if (batterId) {
    if (n >= 4) runs += 1
    else setBase(next, n as Dest, batterId)
  } else if (n >= 4) {
    // no batter id recorded (legacy) but a HR still scores the batter
    runs += 1
  }
  s.bases = next
  addRuns(s, runs)
}

// Walk / HBP: batter to first, forced runners cascade only.
function forcedAdvance(s: LiveGame, batterId: string | null) {
  const { first, second, third } = s.bases
  let runs = 0
  let nf: string | null, ns: string | null, nt: string | null
  if (!first) {
    nf = batterId
    ns = second
    nt = third
  } else if (!second) {
    nf = batterId
    ns = first
    nt = third
  } else if (!third) {
    nf = batterId
    ns = first
    nt = second
  } else {
    nf = batterId
    ns = first
    nt = second
    runs = 1 // bases loaded: runner on third forced home
  }
  s.bases = { first: nf, second: ns, third: nt }
  addRuns(s, runs)
}

// ---- helpers -------------------------------------------------------------

function moveRunner(s: LiveGame, pid: string, to: Dest) {
  removeRunner(s, pid)
  if (to === 4) addRuns(s, 1)
  else if (to >= 1 && to <= 3) setBase(s.bases, to, pid)
}

function removeRunner(s: LiveGame, pid: string) {
  if (s.bases.first === pid) s.bases.first = null
  if (s.bases.second === pid) s.bases.second = null
  if (s.bases.third === pid) s.bases.third = null
}

function getBase(b: Bases, base: number): string | null {
  return base === 1 ? b.first : base === 2 ? b.second : base === 3 ? b.third : null
}
function setBase(b: Bases, base: Dest, pid: string) {
  if (base === 1) b.first = pid
  else if (base === 2) b.second = pid
  else if (base === 3) b.third = pid
}

function addRuns(s: LiveGame, runs: number) {
  if (runs <= 0) return
  if (s.half === 'top') s.awayScore += runs
  else s.homeScore += runs
}

function recordOut(s: LiveGame) {
  s.outs += 1
}

function clearBases(s: LiveGame) {
  s.bases = { first: null, second: null, third: null }
}

function endAtBat(s: LiveGame) {
  s.balls = 0
  s.strikes = 0
  if (s.half === 'top') s.awayBatterIdx += 1
  else s.homeBatterIdx += 1
  if (s.outs >= 3) clearBases(s)
}

function nextHalf(s: LiveGame) {
  if (s.half === 'top') {
    s.half = 'bottom'
  } else {
    s.half = 'top'
    s.inning += 1
  }
  s.outs = 0
  s.balls = 0
  s.strikes = 0
  clearBases(s)
}

export function currentBatterSlot(s: LiveGame, lineupLength: number): number | null {
  if (lineupLength <= 0) return null
  const idx = s.half === 'top' ? s.awayBatterIdx : s.homeBatterIdx
  return idx % lineupLength
}

// Occupancy booleans for components that only need on/off (e.g. the scorebug).
export function occupancy(b: Bases) {
  return { first: !!b.first, second: !!b.second, third: !!b.third }
}

function clone(s: LiveGame): LiveGame {
  return { ...s, bases: { ...s.bases } }
}

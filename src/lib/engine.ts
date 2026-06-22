import type { Half } from './types'

// ---------------------------------------------------------------------------
// Event taxonomy. game_events.event_type stores one of these; payload holds
// detail (fielders, RBIs, runner overrides) for later phases.
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

export type GameEventInput = {
  event_type: EventType
  payload?: Record<string, unknown>
}

// A stored event row (subset we need to replay).
export type GameEventRow = GameEventInput & { seq: number; batter_id?: string | null }

// ---------------------------------------------------------------------------
// Live projected state. game_state.snapshot holds this so viewers read one row.
// ---------------------------------------------------------------------------
export type Bases = { first: boolean; second: boolean; third: boolean }

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
  // Completed plate appearances per team = index into the batting order. The UI
  // mods by the lineup length to find the current batter / on-deck.
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
  bases: { first: false, second: false, third: false },
  awayBatterIdx: 0,
  homeBatterIdx: 0,
}

// Human label for the undo strip.
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
}

// ---------------------------------------------------------------------------
// Reducer. Replaying the whole log is cheap (a game is hundreds of events) and
// makes undo trivial: drop the last event and re-project.
// ---------------------------------------------------------------------------
export function project(events: GameEventRow[]): LiveGame {
  return events
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .reduce(applyEvent, clone(INITIAL_LIVE))
}

export function applyEvent(prev: LiveGame, e: GameEventInput): LiveGame {
  const s = clone(prev)
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
        walkAdvance(s)
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
      // Placeholder pitch marker; the result arrives as its own event.
      break

    case 'walk':
    case 'hit_by_pitch':
      walkAdvance(s)
      endAtBat(s)
      break

    case 'single':
      batterReaches(s, 1)
      endAtBat(s)
      break
    case 'double':
      batterReaches(s, 2)
      endAtBat(s)
      break
    case 'triple':
      batterReaches(s, 3)
      endAtBat(s)
      break
    case 'home_run':
      batterReaches(s, 4)
      endAtBat(s)
      break

    case 'error':
      // Simplified: batter reaches first, no out.
      batterReaches(s, 1)
      endAtBat(s)
      break
    case 'fielders_choice':
      // Simplified: one out recorded, batter safe at first, runners hold.
      recordOut(s)
      s.bases.first = true
      endAtBat(s)
      break

    case 'strikeout':
    case 'groundout':
    case 'flyout':
    case 'lineout':
      recordOut(s)
      endAtBat(s)
      break
  }
  return s
}

// --- helpers ---------------------------------------------------------------

function batterReaches(s: LiveGame, numBases: number) {
  // Advance existing runners by numBases; any passing home scores.
  const occupied: number[] = []
  if (s.bases.third) occupied.push(3)
  if (s.bases.second) occupied.push(2)
  if (s.bases.first) occupied.push(1)
  s.bases = { first: false, second: false, third: false }
  let runs = 0
  for (const b of occupied) {
    const nb = b + numBases
    if (nb >= 4) runs += 1
    else setBase(s.bases, nb, true)
  }
  // Place the batter (numBases 4 = home run = scores).
  if (numBases >= 4) runs += 1
  else setBase(s.bases, numBases, true)
  addRuns(s, runs)
}

function walkAdvance(s: LiveGame) {
  // Force only: batter to 1B; cascade forced runners.
  if (s.bases.first) {
    if (s.bases.second) {
      if (s.bases.third) addRuns(s, 1)
      s.bases.third = true
    }
    s.bases.second = true
  }
  s.bases.first = true
}

function setBase(b: Bases, base: number, val: boolean) {
  if (base === 1) b.first = val
  else if (base === 2) b.second = val
  else if (base === 3) b.third = val
}

function addRuns(s: LiveGame, runs: number) {
  if (runs <= 0) return
  if (s.half === 'top') s.awayScore += runs
  else s.homeScore += runs
}

function recordOut(s: LiveGame) {
  s.outs += 1
}

// End the current at-bat: reset the count and advance the batting order for the
// team that was hitting. If 3 outs, clear bases (the operator advances the inning
// explicitly with an inning_change event).
function endAtBat(s: LiveGame) {
  s.balls = 0
  s.strikes = 0
  if (s.half === 'top') s.awayBatterIdx += 1
  else s.homeBatterIdx += 1
  if (s.outs >= 3) {
    s.bases = { first: false, second: false, third: false }
  }
}

// The 0-based current-batter slot for the team now at bat, given lineup length.
export function currentBatterSlot(s: LiveGame, lineupLength: number): number | null {
  if (lineupLength <= 0) return null
  const idx = s.half === 'top' ? s.awayBatterIdx : s.homeBatterIdx
  return idx % lineupLength
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
  s.bases = { first: false, second: false, third: false }
}

function clone(s: LiveGame): LiveGame {
  return { ...s, bases: { ...s.bases } }
}

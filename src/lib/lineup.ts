import { applyEvent, INITIAL_LIVE, PITCH_TYPES, type GameEventRow, type LiveGame } from './engine'

// A batting-order slot: which player, playing which position, right now.
export type Slot = { playerId: string; position: string | null }

export type Sub = {
  seq: number
  team: 'away' | 'home'
  outId: string
  inId: string
  position: string | null
}

// Pull substitution events out of the log, in order.
export function extractSubs(events: GameEventRow[]): Sub[] {
  return events
    .filter((e) => e.event_type === 'substitution')
    .map((e) => ({
      seq: e.seq,
      team: e.payload?.team as 'away' | 'home',
      outId: e.payload?.out_id as string,
      inId: e.payload?.in_id as string,
      position: (e.payload?.position as string | undefined) ?? null,
    }))
    .filter((s) => !!s.team && !!s.inId)
    .sort((a, b) => a.seq - b.seq)
}

// Project the current batting order + positions for one team from its starters
// plus the substitutions affecting it (applied in seq order).
export function projectSlots(initial: Slot[], subs: Sub[], team: 'away' | 'home'): Slot[] {
  const slots = initial.map((s) => ({ ...s }))
  for (const sub of subs) {
    if (sub.team !== team) continue
    const idx = slots.findIndex((s) => s.playerId === sub.outId)
    if (idx !== -1) {
      slots[idx] = { playerId: sub.inId, position: sub.position }
    } else {
      // out player not found (e.g. a position-only change): update in-place
      const i2 = slots.findIndex((s) => s.playerId === sub.inId)
      if (i2 !== -1) slots[i2].position = sub.position
    }
  }
  return slots
}

export function pitcherOf(slots: Slot[]): string | null {
  return slots.find((s) => s.position === 'P')?.playerId ?? null
}

// The seq at/after which the team's current pitcher has been pitching (0 if the
// starter is still in). Used to scope the live pitch count to the current arm.
export function currentPitcherEntrySeq(events: GameEventRow[], team: 'away' | 'home'): number {
  const pitcherSubs = extractSubs(events).filter((s) => s.team === team && s.position === 'P')
  return pitcherSubs.length ? pitcherSubs[pitcherSubs.length - 1].seq : 0
}

// Pitches thrown since `sinceSeq` while `team` was in the field (home pitches in
// the top, away in the bottom). Replays to know each event's half.
export function pitchesSince(events: GameEventRow[], team: 'away' | 'home', sinceSeq: number): number {
  let state: LiveGame = INITIAL_LIVE
  let count = 0
  for (const ev of events.slice().sort((a, b) => a.seq - b.seq)) {
    const before = state
    state = applyEvent(before, ev)
    if (ev.seq <= sinceSeq) continue
    if (!isPitch(ev.event_type)) continue
    const fielding = before.half === 'top' ? 'home' : 'away'
    if (fielding === team) count += 1
  }
  return count
}

const PA_PITCHES = new Set([
  'single', 'double', 'triple', 'home_run', 'walk', 'hit_by_pitch', 'strikeout',
  'groundout', 'flyout', 'lineout', 'error', 'fielders_choice',
])
function isPitch(t: string): boolean {
  return PITCH_TYPES.includes(t as never) || PA_PITCHES.has(t)
}

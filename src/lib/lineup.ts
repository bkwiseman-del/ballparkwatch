import { applyEvent, INITIAL_LIVE, PITCH_TYPES, type GameEventRow, type LiveGame } from './engine'

// A batting-order slot: which player, playing which position, right now.
export type Slot = { playerId: string; position: string | null }

// One change within a substitution. If outId is set and differs from inId, inId
// (a bench player) takes outId's batting slot at `position`. Otherwise it's a
// position change for inId, who's already in the lineup (e.g. SS → P).
export type Move = { outId?: string; inId: string; position: string | null }
export type Sub = { seq: number; team: 'away' | 'home'; moves: Move[] }

// Pull substitution events out of the log, in order. Supports the multi-move
// shape (payload.moves) and the legacy single out/in/position shape.
export function extractSubs(events: GameEventRow[]): Sub[] {
  return events
    .filter((e) => e.event_type === 'substitution')
    .map((e): Sub => {
      const team = e.payload?.team as 'away' | 'home'
      const raw = e.payload?.moves as { out_id?: string; in_id?: string; position?: string }[] | undefined
      let moves: Move[]
      if (Array.isArray(raw)) {
        moves = raw
          .filter((m) => !!m.in_id)
          .map((m) => ({ outId: m.out_id, inId: m.in_id as string, position: m.position ?? null }))
      } else if (e.payload?.in_id) {
        moves = [{ outId: e.payload.out_id as string | undefined, inId: e.payload.in_id as string, position: (e.payload.position as string) ?? null }]
      } else {
        moves = []
      }
      return { seq: e.seq, team, moves }
    })
    .filter((s) => !!s.team && s.moves.length > 0)
    .sort((a, b) => a.seq - b.seq)
}

// Project the current batting order + positions for one team from its starters
// plus the substitutions affecting it (applied in seq order).
export function projectSlots(initial: Slot[], subs: Sub[], team: 'away' | 'home'): Slot[] {
  const slots = initial.map((s) => ({ ...s }))
  for (const sub of subs) {
    if (sub.team !== team) continue
    for (const m of sub.moves) {
      if (m.outId && m.outId !== m.inId) {
        // bench player replaces the outgoing player in their batting slot
        const idx = slots.findIndex((s) => s.playerId === m.outId)
        if (idx !== -1) slots[idx] = { playerId: m.inId, position: m.position }
        else {
          const i2 = slots.findIndex((s) => s.playerId === m.inId)
          if (i2 !== -1) slots[i2].position = m.position
        }
      } else {
        // position change for a player already in the lineup
        const i = slots.findIndex((s) => s.playerId === m.inId)
        if (i !== -1) slots[i].position = m.position
      }
    }
  }
  return slots
}

export function pitcherOf(slots: Slot[]): string | null {
  return slots.find((s) => s.position === 'P')?.playerId ?? null
}

// The seq at/after which the team's current pitcher has been pitching (0 if the
// starter is still in). Any sub that puts someone at P counts as a change.
export function currentPitcherEntrySeq(events: GameEventRow[], team: 'away' | 'home'): number {
  const pitcherSubs = extractSubs(events).filter(
    (s) => s.team === team && s.moves.some((m) => m.position === 'P'),
  )
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

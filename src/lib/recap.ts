import { computeBoxScore, computeBattingLines, buildPlayByPlay, type BattingLine } from './stats'
import type { GameEventRow } from './engine'
import type { Recap } from './types'
import { supabase } from './supabase'

export type { Recap }

type TeamInfo = { name: string; code: string | null }
type NameOf = (id: string | null | undefined) => string | null

// Build a compact, model-friendly summary of a finished game from the event
// log — final/line score, scoring plays in order, and the standout hitters.
export function buildRecapSummary(
  events: GameEventRow[],
  teams: { away: TeamInfo; home: TeamInfo },
  nameOf: NameOf,
) {
  const box = computeBoxScore(events)
  const lines = computeBattingLines(events, (id) => nameOf(id) ?? '—')
  const plays = buildPlayByPlay(events, nameOf)

  const scoringPlays = plays
    .filter((p) => p.kind === 'scoring')
    .reverse() // buildPlayByPlay is newest-first; recap reads best chronologically
    .map((p) => ({ inning: p.inning, half: p.half, text: p.text }))

  const notable = (ls: BattingLine[]) =>
    ls
      .filter((l) => l.h >= 2 || l.hr > 0 || l.triples > 0 || l.doubles > 0)
      .sort((a, b) => b.hr - a.hr || b.h - a.h)
      .slice(0, 5)
      .map((l) => ({
        name: l.name,
        ab: l.ab,
        h: l.h,
        doubles: l.doubles,
        triples: l.triples,
        hr: l.hr,
        bb: l.bb,
        k: l.k,
      }))

  const winner = box.away.r > box.home.r ? 'away' : box.home.r > box.away.r ? 'home' : 'tie'

  return {
    innings: box.innings,
    winner,
    away: team(teams.away, box.away),
    home: team(teams.home, box.home),
    scoringPlays,
    topHitters: { away: notable(lines.away), home: notable(lines.home) },
  }
}

function team(info: TeamInfo, box: { r: number; h: number; e: number; runsByInning: number[] }) {
  return {
    name: info.name,
    code: info.code,
    runs: box.r,
    hits: box.h,
    errors: box.e,
    runsByInning: box.runsByInning,
  }
}

// Send the summary to the recap Edge Function and return the generated recap.
export async function generateRecap(summary: unknown): Promise<Recap> {
  const { data, error } = await supabase.functions.invoke('recap', { body: { summary } })
  if (error) {
    let msg = error.message
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const b = await ctx.json()
        if (b?.error) msg = b.error
      } catch {
        /* keep generic */
      }
    }
    throw new Error(msg || 'Recap failed.')
  }
  if (!data?.headline || !data?.body) throw new Error('No recap was returned.')
  return { headline: String(data.headline), body: String(data.body) }
}

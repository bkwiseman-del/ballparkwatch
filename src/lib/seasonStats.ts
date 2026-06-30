import { supabase } from './supabase'
import type { GameEventRow } from './engine'
import {
  computeBattingLines,
  computeBoxScore,
  computePitchingLines,
  type BattingLine,
  type PitchingLine,
  type StartPositions,
} from './stats'

// Season rollups for a team — record + per-player batting/pitching, summed across
// all the team's FINAL games by replaying each game's event log (the projections
// engine; stats.ts). Client-side for now; the plan calls for a materialized
// player_season_stats rollup once game volume warrants it (docs/bandbox-plan.md §6).

export type SeasonRecord = { gp: number; w: number; l: number; t: number; rf: number; ra: number }
export type SeasonBatting = BattingLine & { g: number }
export type SeasonPitching = PitchingLine & { g: number }
export type TeamSeason = {
  record: SeasonRecord
  batting: SeasonBatting[]
  pitching: SeasonPitching[]
}

const EMPTY: SeasonRecord = { gp: 0, w: 0, l: 0, t: 0, rf: 0, ra: 0 }

export async function loadTeamSeason(teamId: string): Promise<TeamSeason> {
  const { data: gamesData } = await supabase
    .from('games')
    .select('id, home_team_id, away_team_id, status')
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
  const games = (gamesData ?? []).filter((g) => g.status === 'final')

  const { data: pl } = await supabase
    .from('players')
    .select('id, name')
    .eq('team_id', teamId)
  const nameById = new Map((pl ?? []).map((p) => [p.id as string, p.name as string]))
  const nameOf = (id: string | null | undefined) => (id ? nameById.get(id) ?? null : null)

  const record: SeasonRecord = { ...EMPTY }
  const bat = new Map<string, SeasonBatting>()
  const pit = new Map<string, SeasonPitching>()

  await Promise.all(
    games.map(async (g) => {
      const side: 'home' | 'away' = g.home_team_id === teamId ? 'home' : 'away'
      const [{ data: evData }, { data: lu }] = await Promise.all([
        supabase.from('game_events').select('*').eq('game_id', g.id),
        supabase.from('lineup_entries').select('player_id, team_id, position, is_starter').eq('game_id', g.id),
      ])
      const events = (evData ?? []) as GameEventRow[]
      if (!events.length) return

      // Record + runs for/against from the box score.
      const box = computeBoxScore(events)
      const rf = side === 'home' ? box.home.r : box.away.r
      const ra = side === 'home' ? box.away.r : box.home.r
      record.gp += 1
      record.rf += rf
      record.ra += ra
      if (rf > ra) record.w += 1
      else if (rf < ra) record.l += 1
      else record.t += 1

      // Starting positions (for pitcher attribution) keyed by side.
      const start: StartPositions = { away: {}, home: {} }
      for (const e of lu ?? []) {
        if (!e.is_starter) continue
        const sd: 'home' | 'away' = e.team_id === g.home_team_id ? 'home' : 'away'
        start[sd][e.player_id as string] = (e.position as string) ?? null
      }

      // Batting + pitching — keep only THIS team's side, sum by player.
      const bl = computeBattingLines(events, nameOf)
      for (const line of side === 'home' ? bl.home : bl.away) addBatting(bat, line)
      const pls = computePitchingLines(events, start, nameOf)
      for (const line of side === 'home' ? pls.home : pls.away) addPitching(pit, line)
    }),
  )

  return {
    record,
    batting: [...bat.values()].sort((a, b) => b.ab - a.ab || b.h - a.h),
    pitching: [...pit.values()].sort((a, b) => b.outs - a.outs),
  }
}

function addBatting(map: Map<string, SeasonBatting>, l: BattingLine) {
  const t = map.get(l.playerId)
  if (!t) {
    map.set(l.playerId, { ...l, g: 1 })
    return
  }
  t.g += 1
  t.ab += l.ab
  t.r += l.r
  t.h += l.h
  t.rbi += l.rbi
  t.doubles += l.doubles
  t.triples += l.triples
  t.hr += l.hr
  t.bb += l.bb
  t.k += l.k
  t.hbp += l.hbp
  t.sb += l.sb
  t.avg = t.ab > 0 ? t.h / t.ab : 0
}

function addPitching(map: Map<string, SeasonPitching>, l: PitchingLine) {
  const t = map.get(l.playerId)
  if (!t) {
    map.set(l.playerId, { ...l, g: 1 })
    return
  }
  t.g += 1
  t.outs += l.outs
  t.h += l.h
  t.r += l.r
  t.er += l.er
  t.bb += l.bb
  t.k += l.k
}

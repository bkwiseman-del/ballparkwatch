import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Game, Team } from '@/lib/types'

// A team's games (manage view): schedule/results with links to lineup, scoring, and
// the viewer. Game creation still lives on the Setup dashboard's Games tab.
export function TeamSchedule({ team }: { team: Team }) {
  const [games, setGames] = useState<Game[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [scores, setScores] = useState<Map<string, { home: number; away: number }>>(new Map())
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('games')
      .select('*')
      .or(`home_team_id.eq.${team.id},away_team_id.eq.${team.id}`)
      .order('scheduled_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) return setErr(error.message)
        const gs = (data ?? []) as Game[]
        setGames(gs)
        const ids = gs.map((g) => g.id)
        if (ids.length) {
          supabase
            .from('game_state')
            .select('game_id, home_score, away_score')
            .in('game_id', ids)
            .then(({ data: st }) =>
              setScores(new Map((st ?? []).map((s) => [s.game_id as string, { home: s.home_score, away: s.away_score }]))),
            )
        }
      })
    supabase
      .from('teams')
      .select('id, name')
      .then(({ data }) => setNames(new Map((data ?? []).map((t) => [t.id as string, t.name as string]))))
  }, [team.id])

  if (err) return <p className="font-data text-sm text-barn-red">{err}</p>
  if (games.length === 0)
    return (
      <p className="border-2 border-dashed border-ink/30 px-4 py-3 font-data text-sm text-muted-tan">
        No games yet. Create one from the Games tab on the dashboard.
      </p>
    )

  return (
    <ul className="mx-auto flex max-w-2xl flex-col gap-3">
      {games.map((g) => {
        const home = g.home_team_id === team.id
        const oppId = home ? g.away_team_id : g.home_team_id
        const opp = names.get(oppId) ?? 'Opponent'
        const st = scores.get(g.id)
        const final = g.status === 'final'
        const my = st ? (home ? st.home : st.away) : null
        const oppScore = st ? (home ? st.away : st.home) : null
        return (
          <li key={g.id} className="border-2 border-ink bg-cream-off p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-display text-lg">
                  <span className="text-muted-tan">{home ? 'vs' : 'at'}</span> {opp}
                </p>
                <p className="font-athletic text-[11px] uppercase tracking-wide text-muted-tan">
                  {g.scheduled_at ? when(g.scheduled_at) : g.status}
                  {g.location ? ` · ${g.location}` : ''}
                </p>
              </div>
              {final && my != null ? (
                <span
                  className={`shrink-0 font-display text-lg tabular ${
                    my > (oppScore ?? 0) ? 'text-board-green' : my < (oppScore ?? 0) ? 'text-barn-red' : 'text-muted-tan'
                  }`}
                >
                  {my > (oppScore ?? 0) ? 'W' : my < (oppScore ?? 0) ? 'L' : 'T'} {my}-{oppScore}
                </span>
              ) : (
                <span className="shrink-0 font-athletic text-xs uppercase tracking-wide text-barn-red">{g.status}</span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {!final && (
                <>
                  <Link to={`/lineup/${g.id}`} className="border-2 border-ink px-3 py-1.5 font-display text-sm text-ink">
                    Lineup
                  </Link>
                  <Link to={`/score/${g.id}`} className="bg-board-green px-3 py-1.5 font-display text-sm text-cream">
                    Score ▸
                  </Link>
                </>
              )}
              <Link to={`/watch/${g.id}`} className="border-2 border-ink px-3 py-1.5 font-display text-sm text-ink">
                {final ? 'Recap' : 'Watch'}
              </Link>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { HeaderWordmark } from '@/components/Logo'
import type { Game, LineupEntry, Player, Team } from '@/lib/types'

const POSITIONS_LIST = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'EH']
// The nine fielding spots can each be held by only one player; DH/EH can repeat.
const UNIQUE_POSITIONS = new Set(['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'])

export default function Lineup() {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const [game, setGame] = useState<Game | null>(null)
  const [away, setAway] = useState<Team | null>(null)
  const [home, setHome] = useState<Team | null>(null)
  const [rosters, setRosters] = useState<Record<string, Player[]>>({})
  const [order, setOrder] = useState<Record<string, string[]>>({}) // teamId -> [playerId]
  const [positions, setPositions] = useState<Record<string, Record<string, string>>>({}) // teamId -> playerId -> pos
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!gameId) return
    ;(async () => {
      const { data: g, error: gErr } = await supabase.from('games').select('*').eq('id', gameId).single()
      if (gErr) return setError(gErr.message), setLoading(false)
      const [a, h, existing] = await Promise.all([
        supabase.from('teams').select('*').eq('id', g.away_team_id).single(),
        supabase.from('teams').select('*').eq('id', g.home_team_id).single(),
        supabase.from('lineup_entries').select('*').eq('game_id', gameId),
      ])
      const [ap, hp] = await Promise.all([
        supabase.from('players').select('*').eq('team_id', g.away_team_id).order('jersey_number'),
        supabase.from('players').select('*').eq('team_id', g.home_team_id).order('jersey_number'),
      ])
      setGame(g as Game)
      setAway(a.data as Team)
      setHome(h.data as Team)
      setRosters({
        [g.away_team_id]: (ap.data ?? []) as Player[],
        [g.home_team_id]: (hp.data ?? []) as Player[],
      })
      const init: Record<string, string[]> = { [g.away_team_id]: [], [g.home_team_id]: [] }
      for (const e of (existing.data ?? []) as LineupEntry[]) {
        init[e.team_id] = init[e.team_id] ?? []
        init[e.team_id].push(e.player_id)
      }
      // keep existing batting order
      const allEntries = (existing.data ?? []) as LineupEntry[]
      const posInit: Record<string, Record<string, string>> = {
        [g.away_team_id]: {},
        [g.home_team_id]: {},
      }
      for (const tid of Object.keys(init)) {
        const ents = allEntries
          .filter((e) => e.team_id === tid)
          .sort((x, y) => (x.batting_order ?? 0) - (y.batting_order ?? 0))
        init[tid] = ents.map((e) => e.player_id)
        const roster = (tid === g.away_team_id ? ap.data : hp.data) as Player[] | null
        for (const e of ents) {
          const def = (roster ?? []).find((p) => p.id === e.player_id)?.default_position
          posInit[tid][e.player_id] = e.position ?? def ?? ''
        }
      }
      setOrder(init)
      setPositions(posInit)
      setLoading(false)
    })()
  }, [gameId])

  async function save() {
    if (!gameId || !game) return
    setError(null)
    // Replace lineup for both teams.
    const del = await supabase.from('lineup_entries').delete().eq('game_id', gameId)
    if (del.error) return setError(del.error.message)
    const rows: Omit<LineupEntry, 'id'>[] = []
    for (const teamId of [game.away_team_id, game.home_team_id]) {
      ;(order[teamId] ?? []).forEach((playerId, i) => {
        const pos =
          positions[teamId]?.[playerId] ||
          rosters[teamId]?.find((p) => p.id === playerId)?.default_position ||
          null
        rows.push({
          game_id: gameId,
          team_id: teamId,
          player_id: playerId,
          batting_order: i + 1,
          position: pos,
          is_starter: true,
        })
      })
    }
    if (rows.length) {
      const ins = await supabase.from('lineup_entries').insert(rows)
      if (ins.error) return setError(ins.error.message)
    }
    setSaved(true)
    setTimeout(() => navigate(`/score/${gameId}`), 700)
  }

  if (loading) return <Centered>Loading lineup…</Centered>
  if (error && !game) return <Centered>{error}</Centered>
  if (!game || !away || !home) return <Centered>Game not found</Centered>

  return (
    <div className="min-h-full bg-cream text-ink">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b-2 border-gold bg-ink px-4 py-2.5 text-cream">
        <HeaderWordmark />
        <Link to="/setup" className="font-athletic text-sm uppercase tracking-wide text-gold">
          ← Setup
        </Link>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-5">
        <h1 className="mb-1 font-display text-2xl">Lineups &amp; Positions</h1>
        <p className="mb-5 font-data text-sm text-muted-tan">
          Tap players to add them in batting order (drag ⠿ or ▲▼ to reorder, ✕ to remove). Set each
          player's defensive position with the dropdown — adjust any time, including between innings.
        </p>

        {error && (
          <p className="mb-4 border-2 border-barn-red bg-barn-red/10 px-3 py-2 font-data text-sm text-barn-red">
            {error}
          </p>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          <TeamLineup
            team={away}
            roster={rosters[game.away_team_id] ?? []}
            order={order[game.away_team_id] ?? []}
            setOrder={(o) => setOrder((prev) => ({ ...prev, [game.away_team_id]: o }))}
            positions={positions[game.away_team_id] ?? {}}
            setPosition={(pid, pos) =>
              setPositions((prev) => ({
                ...prev,
                [game.away_team_id]: { ...(prev[game.away_team_id] ?? {}), [pid]: pos },
              }))
            }
          />
          <TeamLineup
            team={home}
            roster={rosters[game.home_team_id] ?? []}
            order={order[game.home_team_id] ?? []}
            setOrder={(o) => setOrder((prev) => ({ ...prev, [game.home_team_id]: o }))}
            positions={positions[game.home_team_id] ?? {}}
            setPosition={(pid, pos) =>
              setPositions((prev) => ({
                ...prev,
                [game.home_team_id]: { ...(prev[game.home_team_id] ?? {}), [pid]: pos },
              }))
            }
            accent
          />
        </div>

        <div className="mt-6 flex gap-2">
          <button onClick={save} className="flex-1 bg-gold py-3 font-display text-ink">
            {saved ? 'Saved ✓' : 'Save Lineups ▸'}
          </button>
          <Link
            to={`/score/${gameId}`}
            className="border-2 border-ink px-4 py-3 font-display text-ink"
          >
            Go to Score
          </Link>
        </div>
      </div>
    </div>
  )
}

function TeamLineup({
  team,
  roster,
  order,
  setOrder,
  positions,
  setPosition,
  accent = false,
}: {
  team: Team
  roster: Player[]
  order: string[]
  setOrder: (o: string[]) => void
  positions: Record<string, string>
  setPosition: (playerId: string, pos: string) => void
  accent?: boolean
}) {
  const byId = useMemo(() => new Map(roster.map((p) => [p.id, p])), [roster])
  const available = roster.filter((p) => !order.includes(p.id))
  const [dragId, setDragId] = useState<string | null>(null)

  function move(from: number, to: number) {
    if (to < 0 || to >= order.length || from === to) return
    const next = order.slice()
    const [m] = next.splice(from, 1)
    next.splice(to, 0, m)
    setOrder(next)
  }

  return (
    <section className="border-2 border-ink bg-cream-off">
      <div className={`px-4 py-2.5 ${accent ? 'bg-ink text-gold' : 'bg-white text-ink'} border-b-2 border-ink`}>
        <h2 className="font-display text-lg">{team.name}</h2>
      </div>

      {/* Batting order */}
      <ol className="flex flex-col">
        {order.map((pid, i) => {
          const p = byId.get(pid)
          // Fielding positions already held by OTHER players in this lineup.
          const takenElsewhere = new Set(
            order
              .filter((o) => o !== pid)
              .map((o) => positions[o] ?? byId.get(o)?.default_position ?? '')
              .filter(Boolean),
          )
          return (
            <li
              key={pid}
              draggable
              onDragStart={() => setDragId(pid)}
              onDragOver={(e) => {
                e.preventDefault()
                if (dragId && dragId !== pid) move(order.indexOf(dragId), i)
              }}
              onDragEnd={() => setDragId(null)}
              className={`flex items-center gap-2 px-3 py-2 ${i > 0 ? 'border-t border-ink/12' : ''} ${
                dragId === pid ? 'opacity-50' : ''
              }`}
            >
              <span className="cursor-grab select-none px-1 text-ink/30" title="Drag to reorder">
                ⠿
              </span>
              <span className="w-5 text-right font-athletic text-base font-bold text-ink">{i + 1}</span>
              <span className="w-7 text-right font-athletic text-lg font-bold text-barn-red">
                {p?.jersey_number ?? '—'}
              </span>
              <span className="font-display text-base">{p?.name ?? '?'}</span>
              <select
                value={positions[pid] ?? p?.default_position ?? ''}
                onChange={(e) => setPosition(pid, e.target.value)}
                className="ml-auto border border-ink/30 bg-white px-1 py-1 font-athletic text-xs"
                title="Defensive position"
              >
                <option value="">POS</option>
                {POSITIONS_LIST.map((pos) => {
                  const taken = UNIQUE_POSITIONS.has(pos) && takenElsewhere.has(pos)
                  return (
                    <option key={pos} value={pos} disabled={taken}>
                      {pos}
                      {taken ? ' • taken' : ''}
                    </option>
                  )
                })}
              </select>
              <span className="flex flex-col leading-none">
                <button
                  onClick={() => move(i, i - 1)}
                  disabled={i === 0}
                  className="px-1 text-ink disabled:opacity-20"
                  title="Move up"
                >
                  ▲
                </button>
                <button
                  onClick={() => move(i, i + 1)}
                  disabled={i === order.length - 1}
                  className="px-1 text-ink disabled:opacity-20"
                  title="Move down"
                >
                  ▼
                </button>
              </span>
              <button
                onClick={() => setOrder(order.filter((x) => x !== pid))}
                className="px-1.5 font-athletic text-barn-red"
                title="Move to bench (won't bat)"
              >
                ✕
              </button>
            </li>
          )
        })}
        {order.length === 0 && (
          <li className="px-4 py-3 font-data text-sm text-muted-tan">No batters yet.</li>
        )}
      </ol>

      {/* Bench — roster players sitting out (continuous batting order: everyone in
          the order bats each time through; benched players don't bat). */}
      {available.length > 0 && (
        <div className="border-t-2 border-ink p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">
              Bench · won’t bat — tap to add
            </p>
            <button
              onClick={() => setOrder([...order, ...available.map((p) => p.id)])}
              className="font-athletic text-xs font-semibold uppercase tracking-wide text-board-green underline"
            >
              Add all
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {available.map((p) => (
              <button
                key={p.id}
                onClick={() => setOrder([...order, p.id])}
                className="border-2 border-dashed border-ink/50 bg-white px-2.5 py-1.5 font-data text-sm text-muted-tan"
              >
                <b className="text-barn-red">{p.jersey_number ?? '—'}</b> {p.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {roster.length === 0 && (
        <p className="px-4 py-3 font-data text-sm text-muted-tan">
          No roster — add players to this team first.
        </p>
      )}
    </section>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-cream p-6 text-center font-athletic text-muted-tan">
      {children}
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { scanLineupImage } from '@/lib/scanLineup'
import { HeaderWordmark } from '@/components/Logo'
import type { Game, LineupEntry, Player, Team } from '@/lib/types'

// BENCH = bats (continuous order) but isn't in the field this rotation.
const POSITIONS_LIST = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'EH', 'BENCH']
// The nine fielding spots can each be held by only one player; DH/EH/BENCH repeat.
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
  const [dirty, setDirty] = useState(false) // unsaved edits since load/save

  // Warn before a browser refresh/close/back with unsaved lineup changes.
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  // Confirm before leaving via an in-app link if there are unsaved changes.
  function leaveGuard(to: string) {
    if (dirty && !window.confirm('You have unsaved lineup changes. Leave without saving?')) return
    navigate(to)
  }

  // Cream screen: paint the body cream so iOS doesn't show the dark night-green in
  // the safe-area strips (the home indicator area). Restore on leave.
  useEffect(() => {
    const prev = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#F4ECD8'
    return () => {
      document.body.style.backgroundColor = prev
    }
  }, [])

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

  // Add a player to a team's roster WITHOUT leaving the lineup screen, then drop them
  // straight into the batting order. This is the fix for "I had to go to another screen
  // just to add a kid who showed up."
  async function addPlayer(teamId: string, name: string, jersey: string): Promise<void> {
    setError(null)
    const jn = jersey.replace(/[^0-9]/g, '')
    const { data, error: e } = await supabase
      .from('players')
      .insert({ team_id: teamId, name: name.trim(), jersey_number: jn ? Number(jn) : null })
      .select('*')
      .single()
    if (e) return setError(e.message)
    const pl = data as Player
    setRosters((prev) => ({ ...prev, [teamId]: [...(prev[teamId] ?? []), pl] }))
    setOrder((prev) => ({ ...prev, [teamId]: [...(prev[teamId] ?? []), pl.id] }))
    setDirty(true)
  }

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
    setDirty(false)
    setTimeout(() => navigate(`/score/${gameId}`), 700)
  }

  if (loading) return <Centered>Loading lineup…</Centered>
  if (error && !game) return <Centered>{error}</Centered>
  if (!game || !away || !home) return <Centered>Game not found</Centered>

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-cream text-ink">
      <header className="flex shrink-0 items-center justify-between border-b-2 border-gold bg-ink px-4 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] text-cream">
        <HeaderWordmark />
        <button
          onClick={() => leaveGuard('/setup')}
          className="font-athletic text-sm uppercase tracking-wide text-gold"
        >
          ← Dashboard
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-3xl px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5">
        <h1 className="mb-1 font-display text-2xl">Lineups &amp; Positions</h1>
        <p className="mb-5 font-data text-sm text-muted-tan">
          Add everyone who’s playing to the batting order (drag ⠿ or ▲▼ to reorder). In a continuous
          order everyone bats — a player sitting on defense stays in the order with position{' '}
          <b>BENCH</b>. Leave a player out of the order only if they’re not here today.
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
            setOrder={(o) => {
              setDirty(true)
              setOrder((prev) => ({ ...prev, [game.away_team_id]: o }))
            }}
            positions={positions[game.away_team_id] ?? {}}
            setPosition={(pid, pos) => {
              setDirty(true)
              setPositions((prev) => ({
                ...prev,
                [game.away_team_id]: { ...(prev[game.away_team_id] ?? {}), [pid]: pos },
              }))
            }}
            onAddPlayer={(name, jersey) => addPlayer(game.away_team_id, name, jersey)}
          />
          <TeamLineup
            team={home}
            roster={rosters[game.home_team_id] ?? []}
            order={order[game.home_team_id] ?? []}
            setOrder={(o) => {
              setDirty(true)
              setOrder((prev) => ({ ...prev, [game.home_team_id]: o }))
            }}
            positions={positions[game.home_team_id] ?? {}}
            setPosition={(pid, pos) => {
              setDirty(true)
              setPositions((prev) => ({
                ...prev,
                [game.home_team_id]: { ...(prev[game.home_team_id] ?? {}), [pid]: pos },
              }))
            }}
            onAddPlayer={(name, jersey) => addPlayer(game.home_team_id, name, jersey)}
            accent
          />
        </div>

        </div>
      </div>

      {/* Sticky save bar — always visible so progress is never lost by scrolling
          past it. Shows an Unsaved flag until the lineup is saved. */}
      <div className="shrink-0 border-t-2 border-ink bg-cream-off px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <span
            className={`font-athletic text-xs font-bold uppercase tracking-[.12em] ${
              dirty ? 'text-barn-red' : 'text-board-green'
            }`}
          >
            {dirty ? '● Unsaved' : saved ? '✓ Saved' : 'Saved'}
          </span>
          <button
            onClick={save}
            className="flex-1 bg-gold py-4 font-display text-lg text-ink shadow-hard"
          >
            {saved && !dirty ? 'Saved ✓' : 'Save Lineups ▸'}
          </button>
          <button
            onClick={() => leaveGuard(`/score/${gameId}`)}
            className="border-2 border-ink px-4 py-4 font-display text-ink"
          >
            Score
          </button>
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
  onAddPlayer,
  accent = false,
}: {
  team: Team
  roster: Player[]
  order: string[]
  setOrder: (o: string[]) => void
  positions: Record<string, string>
  setPosition: (playerId: string, pos: string) => void
  onAddPlayer: (name: string, jersey: string) => Promise<void>
  accent?: boolean
}) {
  const byId = useMemo(() => new Map(roster.map((p) => [p.id, p])), [roster])
  const [adding, setAdding] = useState(false)
  const [nm, setNm] = useState('')
  const [jn, setJn] = useState('')
  const [busy, setBusy] = useState(false)
  const [scanMsg, setScanMsg] = useState<string | null>(null)
  const scanRef = useRef<HTMLInputElement>(null)
  async function submitAdd() {
    if (!nm.trim() || busy) return
    setBusy(true)
    await onAddPlayer(nm, jn)
    setBusy(false)
    setNm('')
    setJn('')
    // keep the form open so several new arrivals can be added back-to-back
  }
  // Build a roster from a photo/screenshot of a lineup — the fast way to fill in an
  // opponent (or your own team). Adds every player the scan reads into the order.
  async function onScan(file: File) {
    setScanMsg('Reading lineup…')
    try {
      const found = await scanLineupImage(file)
      for (const p of found) await onAddPlayer(p.name, p.number)
      setScanMsg(`Added ${found.length} player${found.length === 1 ? '' : 's'}.`)
    } catch (e) {
      setScanMsg(e instanceof Error ? e.message : 'Scan failed.')
    }
  }
  // Archived players drop out of the "add to lineup" pool, but anyone already in
  // this game's order still shows (history stays intact).
  const available = roster.filter((p) => !order.includes(p.id) && !p.archived_at)
  const [dragId, setDragId] = useState<string | null>(null)

  function move(from: number, to: number) {
    if (to < 0 || to >= order.length || from === to) return
    const next = order.slice()
    const [m] = next.splice(from, 1)
    next.splice(to, 0, m)
    setOrder(next)
  }

  // Pointer-based drag (HTML5 draggable doesn't fire on touch / iOS). The handle
  // captures the pointer; as it moves over another row we reorder live.
  function onHandleDown(e: React.PointerEvent, pid: string) {
    e.preventDefault()
    setDragId(pid)
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }
  function onHandleMove(e: React.PointerEvent, dragId: string | null) {
    if (!dragId) return
    const row = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest('[data-pid]')
    const overId = (row as HTMLElement | null)?.dataset.pid
    if (overId && overId !== dragId) move(order.indexOf(dragId), order.indexOf(overId))
  }
  function onHandleUp(e: React.PointerEvent) {
    setDragId(null)
    ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
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
              data-pid={pid}
              className={`flex items-center gap-2 px-3 py-2 ${i > 0 ? 'border-t border-ink/12' : ''} ${
                dragId === pid ? 'bg-gold/15 opacity-60' : ''
              } ${dragId ? 'select-none' : ''}`}
            >
              <span
                onPointerDown={(e) => onHandleDown(e, pid)}
                onPointerMove={(e) => onHandleMove(e, dragId)}
                onPointerUp={onHandleUp}
                className="-mx-1 cursor-grab touch-none select-none px-3 py-1 text-lg text-ink/40"
                title="Drag to reorder"
              >
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
                className="ml-auto appearance-none rounded-none border border-ink/30 bg-white px-1 py-1 font-athletic text-xs"
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

      {/* Not in the batting order — players not playing today (absent). In a
          continuous batting order EVERYONE present bats; a player who's only
          sitting on defense stays in the order with position BENCH. */}
      {available.length > 0 && (
        <div className="border-t-2 border-ink p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">
              Not playing today — tap to add
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
      {/* Add a player right here — no trip to another screen. Great for a kid who
          shows up late, a sub, or building a brand-new team's roster on the spot. */}
      <div className="border-t-2 border-ink p-3">
        {adding ? (
          <div className="flex items-center gap-2">
            <input
              value={jn}
              onChange={(e) => setJn(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
              placeholder="#"
              inputMode="numeric"
              className="w-12 appearance-none rounded-none border-2 border-ink bg-white px-1 py-2 text-center font-athletic text-sm outline-none focus:border-board-green"
            />
            <input
              value={nm}
              onChange={(e) => setNm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitAdd()}
              placeholder="Player name"
              autoFocus
              className="min-w-0 flex-1 appearance-none rounded-none border-2 border-ink bg-white px-2 py-2 font-data text-sm outline-none focus:border-board-green"
            />
            <button
              onClick={submitAdd}
              disabled={busy || !nm.trim()}
              className="shrink-0 bg-board-green px-3 py-2 font-display text-sm text-cream disabled:opacity-50"
            >
              Add
            </button>
            <button
              onClick={() => {
                setAdding(false)
                setNm('')
                setJn('')
              }}
              className="shrink-0 border-2 border-ink px-2.5 py-2 font-display text-sm text-ink"
              title="Done adding"
            >
              ✕
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <button
              onClick={() => setAdding(true)}
              className="font-athletic text-xs font-semibold uppercase tracking-[.1em] text-board-green"
            >
              {roster.length === 0 ? `+ Add the first player to ${team.name}` : '+ Add a player'}
            </button>
            <button
              onClick={() => scanRef.current?.click()}
              className="font-athletic text-xs font-semibold uppercase tracking-[.1em] text-board-green"
            >
              ⤒ Scan a lineup
            </button>
            <input
              ref={scanRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.currentTarget.value = ''
                if (f) onScan(f)
              }}
            />
            {scanMsg && <span className="font-data text-xs text-muted-tan">{scanMsg}</span>}
          </div>
        )}
      </div>
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

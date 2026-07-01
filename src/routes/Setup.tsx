import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthProvider'
import { HeaderWordmark } from '@/components/Logo'
import { downloadCsv, parseRosterCsv, rosterTemplateCsv } from '@/lib/csv'
import { scanLineupImage, type ScannedPlayer } from '@/lib/scanLineup'
import { CameraIcon, UploadIcon } from '@/components/Icons'
import { fieldClass } from '@/components/Select'
import type { Game, Handedness, Player, Team, VideoSource } from '@/lib/types'

type TeamRecord = { w: number; l: number; t: number; rf: number; ra: number }
type GState = { home: number; away: number; inning: number; half: string; outs: number }

export default function Setup() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [teams, setTeams] = useState<Team[]>([])
  const [games, setGames] = useState<Game[]>([])
  const [states, setStates] = useState<Map<string, GState>>(new Map())
  const [creating, setCreating] = useState(false)
  const [showAddTeam, setShowAddTeam] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasFollows, setHasFollows] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    setError(null)
    const [t, g, m] = await Promise.all([
      supabase.from('teams').select('*').order('is_favorite', { ascending: false }).order('name'),
      supabase.from('games').select('*').order('scheduled_at', { ascending: true, nullsFirst: false }),
      supabase.from('team_members').select('team_id, role').eq('user_id', user.id),
    ])
    if (t.error) return setError(t.error.message)
    if (g.error) return setError(g.error.message)

    // This is the OPERATOR dashboard. Teams-by-RLS now include teams you merely
    // follow as family, so split by role: show only teams you run here, and send a
    // family-only account to its following home instead.
    const OPERATOR = new Set(['owner', 'admin', 'scorer', 'broadcaster'])
    const roleBy = new Map((m.data ?? []).map((r) => [r.team_id as string, r.role as string]))
    const allTeams = t.data as Team[]
    const operated = allTeams.filter((tm) => OPERATOR.has(roleBy.get(tm.id) ?? 'owner'))
    setHasFollows(allTeams.some((tm) => roleBy.get(tm.id) === 'family'))
    if (operated.length === 0 && allTeams.some((tm) => roleBy.get(tm.id) === 'family')) {
      navigate('/following', { replace: true })
      return
    }
    const operatedIds = new Set(operated.map((tm) => tm.id))
    const gs = (g.data as Game[]).filter(
      (game) => operatedIds.has(game.home_team_id) || operatedIds.has(game.away_team_id),
    )
    setTeams(operated)
    setGames(gs)
    const { data: st } = await supabase
      .from('game_state')
      .select('game_id, home_score, away_score, inning, half, outs')
    setStates(
      new Map(
        (st ?? []).map((s) => [
          s.game_id as string,
          { home: s.home_score, away: s.away_score, inning: s.inning, half: String(s.half), outs: s.outs },
        ]),
      ),
    )
  }, [user, navigate])

  useEffect(() => {
    load()
  }, [load])

  // iOS standalone paints the safe-area strips (incl. the home indicator) with the
  // BODY background — which is the dark night-green — so a cream screen shows a green
  // strip. Make the body cream while this (cream) screen is up; restore on leave.
  useEffect(() => {
    const prev = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#F4ECD8'
    return () => {
      document.body.style.backgroundColor = prev
    }
  }, [])

  const favorites = teams.filter((t) => t.is_favorite)
  const favoriteIds = new Set(favorites.map((t) => t.id))
  const nameOf = (gid: string) => teams.find((t) => t.id === gid)?.name ?? 'TBD'
  const records = computeRecords(games, states)
  const upcoming = games.filter((g) => g.status !== 'final')
  // Hero = whatever needs you most: a live game, else the soonest scheduled one.
  const heroGame = games.find((g) => g.status === 'live') ?? games.find((g) => g.status === 'scheduled') ?? null
  // games are sorted by scheduled_at ascending → reverse the finals for "most recent".
  const recentFinals = games.filter((g) => g.status === 'final').reverse().slice(0, 4)

  // A team you manage. Just take a name, create it as one of "My Teams", and drop
  // straight into its hub to add the roster + details. (Opponents are NOT created
  // here — they're added inline while scheduling a game.)
  async function addTeam(name: string) {
    const { data, error } = await supabase
      .from('teams')
      .insert({ name: name.trim(), is_favorite: true, owner_id: user!.id })
      .select('id')
      .single()
    if (error) return setError(error.message)
    setShowAddTeam(false)
    navigate(`/team/${data.id}`)
  }
  async function toggleFav(team: Team) {
    const { error } = await supabase.from('teams').update({ is_favorite: !team.is_favorite }).eq('id', team.id)
    if (error) setError(error.message)
    else load()
  }

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-cream text-ink">
      <header className="flex shrink-0 items-center justify-between border-b-2 border-gold bg-ink px-4 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] text-cream">
        <HeaderWordmark />
        <div className="flex items-center gap-4">
          {hasFollows && (
            <Link to="/following" className="font-athletic text-sm uppercase tracking-wide text-gold hover:underline">
              Following
            </Link>
          )}
          <button onClick={signOut} className="font-athletic text-sm uppercase tracking-wide text-gold hover:underline">
            Sign out
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-3xl px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5">
          {error && (
            <p className="mb-4 border-2 border-barn-red bg-barn-red/10 px-3 py-2 font-data text-sm text-barn-red">{error}</p>
          )}

          {/* Hero: the live or next game (the reason you opened the app) */}
          <HeroGame
            game={heroGame}
            state={heroGame ? states.get(heroGame.id) : undefined}
            nameOf={nameOf}
            canSchedule={teams.length >= 2}
            onSchedule={() => setCreating(true)}
          />

          {creating && (
            <div className="mt-3">
              <CreateGameCard
                teams={teams}
                userId={user!.id}
                onError={setError}
                onCancel={() => setCreating(false)}
                onCreated={() => {
                  setCreating(false)
                  load()
                }}
              />
            </div>
          )}

          {/* My teams */}
          <section className="mt-8">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-display text-xl">My teams</h2>
              {favorites.length > 0 && (
                <button
                  onClick={() => setShowAddTeam((v) => !v)}
                  className="font-athletic text-xs font-bold uppercase tracking-wide text-board-green"
                >
                  {showAddTeam ? 'Close' : '+ Add team'}
                </button>
              )}
            </div>

            {(showAddTeam || favorites.length === 0) && (
              <div className="mb-3">
                {favorites.length === 0 && (
                  <p className="mb-2 font-data text-sm text-muted-tan">Add your team to start scoring and streaming.</p>
                )}
                <NewTeamForm onAdd={addTeam} />
              </div>
            )}

            {favorites.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {favorites.map((tm) => (
                  <TeamCard
                    key={tm.id}
                    team={tm}
                    record={records.get(tm.id)}
                    next={nextGameFor(upcoming, tm.id)}
                    nameOf={nameOf}
                    onOpen={() => navigate(`/team/${tm.id}`)}
                    onToggleFav={() => toggleFav(tm)}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Recent results */}
          {recentFinals.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-2 font-display text-xl">Recent results</h2>
              <ul className="flex flex-col gap-2">
                {recentFinals.map((g) => (
                  <RecentRow key={g.id} game={g} state={states.get(g.id)} favoriteIds={favoriteIds} nameOf={nameOf} />
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

// The home hero — a live game (resume scoring) or the next one, or a create CTA.
function HeroGame({
  game,
  state,
  nameOf,
  canSchedule,
  onSchedule,
}: {
  game: Game | null
  state?: GState
  nameOf: (id: string) => string
  canSchedule: boolean
  onSchedule: () => void
}) {
  if (!game) {
    return (
      <section className="border-2 border-dashed border-ink/30 px-6 py-8 text-center">
        <p className="font-display text-xl">No games on the calendar</p>
        <p className="mx-auto mt-1 max-w-xs font-data text-sm text-muted-tan">
          Schedule a game to score it, stream it, and let family watch from anywhere.
        </p>
        {canSchedule && (
          <button onClick={onSchedule} className="mt-4 bg-gold px-6 py-3 font-display text-ink">
            Schedule a game ▸
          </button>
        )}
      </section>
    )
  }
  const away = nameOf(game.away_team_id)
  const home = nameOf(game.home_team_id)
  const live = game.status === 'live'
  return (
    <section className={`border-2 ${live ? 'border-barn-red' : 'border-ink'} bg-ink p-5 text-cream`}>
      <div
        className={`flex items-center gap-2 font-athletic text-xs font-bold uppercase tracking-[.18em] ${
          live ? 'text-barn-red' : 'text-gold'
        }`}
      >
        {live && <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-barn-red" />}
        {live ? 'Live now' : 'Next up'}
      </div>

      {live ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <ScoreSide name={away} score={state?.away ?? 0} />
          <span className="shrink-0 font-data text-xs text-cream/50">
            {state ? `${state.half === 'top' ? '▲' : '▼'}${state.inning} · ${state.outs} out` : ''}
          </span>
          <ScoreSide name={home} score={state?.home ?? 0} right />
        </div>
      ) : (
        <>
          <p className="mt-2 font-display text-2xl leading-tight">
            {away} <span className="text-cream/50">at</span> {home}
          </p>
          <p className="mt-1 font-athletic text-sm uppercase tracking-wide text-cream/60">
            {game.scheduled_at ? formatWhen(game.scheduled_at) : 'Time TBD'}
            {game.location ? ` · ${game.location}` : ''}
          </p>
        </>
      )}

      <div className="mt-4 flex gap-2">
        <Link to={`/score/${game.id}`} className="flex-1 bg-board-green py-3 text-center font-display text-cream">
          {live ? 'Resume scoring ▸' : 'Start scoring ▸'}
        </Link>
        <Link
          to={`/game/${game.id}`}
          className="border-2 border-cream/40 px-6 py-3 text-center font-display text-cream"
        >
          Setup
        </Link>
      </div>
    </section>
  )
}

function ScoreSide({ name, score, right }: { name: string; score: number; right?: boolean }) {
  return (
    <div className={`min-w-0 flex-1 ${right ? 'text-right' : ''}`}>
      <div className="truncate font-display text-sm text-cream/80">{name}</div>
      <div className="font-display text-4xl tabular">{score}</div>
    </div>
  )
}

// Edit a game's details — home/away (searchable), date/time, location — from wherever
// you see the game (dashboard hero, schedule). This is the "who's home, what time"
// editor people were hunting for; video/camera lives behind its own button.
// The game details editor (home/away, date/time, location, delete). Rendered inline in
// the Game hub's Details tab AND wrapped as a quick modal from the dashboard hero.
export function GameDetailsForm({
  game,
  teams,
  userId,
  onSaved,
  onError,
  onDeleted,
}: {
  game: Game
  teams: Team[]
  userId: string
  onSaved?: () => void
  onError: (m: string) => void
  onDeleted?: () => void
}) {
  const [extraTeams, setExtraTeams] = useState<Team[]>([])
  const allTeams = [...teams, ...extraTeams]
  const [away, setAway] = useState(game.away_team_id)
  const [home, setHome] = useState(game.home_team_id)
  const [when, setWhen] = useState(toLocalInput(game.scheduled_at))
  const [loc, setLoc] = useState(game.location ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  async function createTeam(name: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('teams')
      .insert({ name: name.trim(), owner_id: userId, is_favorite: false })
      .select('*')
      .single()
    if (error) {
      onError(error.message)
      return null
    }
    const t = data as Team
    setExtraTeams((p) => [...p, t])
    return t.id
  }

  async function save() {
    if (!away || !home) return onError('Pick both teams.')
    if (away === home) return onError('Away and home must be different teams.')
    setBusy(true)
    const { error } = await supabase
      .from('games')
      .update({
        away_team_id: away,
        home_team_id: home,
        scheduled_at: when ? new Date(when).toISOString() : null,
        location: loc.trim() || null,
      })
      .eq('id', game.id)
    if (error) {
      setBusy(false)
      return onError(error.message)
    }
    // If a team was actually replaced (not just swapped), its lineup no longer applies.
    const before = [game.away_team_id, game.home_team_id].sort().join()
    const after = [away, home].sort().join()
    if (before !== after) await supabase.from('lineup_entries').delete().eq('game_id', game.id)
    setBusy(false)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1500)
    onSaved?.()
  }

  async function del() {
    if (!window.confirm('Delete this game and its lineups? This can’t be undone.')) return
    const { error } = await supabase.from('games').delete().eq('id', game.id)
    if (error) return onError(error.message)
    onDeleted?.()
  }

  return (
    <div>
      <div className="mb-4 grid grid-cols-[1fr_auto_1fr] items-start gap-2">
        <TeamPicker label="Away" value={away} onChange={setAway} teams={allTeams} onCreate={createTeam} />
        <button
          type="button"
          onClick={() => {
            const a = away
            setAway(home)
            setHome(a)
          }}
          title="Swap home / away"
          className="mt-6 border-2 border-ink px-2 py-2 font-display text-ink"
        >
          ⇄
        </button>
        <TeamPicker label="Home" value={home} onChange={setHome} teams={allTeams} onCreate={createTeam} accent />
      </div>

      <label className="mb-1 block font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">
        Date &amp; time
      </label>
      <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={`${fieldClass} mb-3`} />

      <label className="mb-1 block font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">
        Location
      </label>
      <input
        value={loc}
        onChange={(e) => setLoc(e.target.value)}
        placeholder="Field / park (optional)"
        className={`${fieldClass} mb-4`}
      />

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={busy} className="flex-1 bg-gold py-3 font-display text-ink disabled:opacity-60">
          {busy ? 'Saving…' : 'Save game'}
        </button>
        {saved && <span className="font-data text-sm text-board-green">Saved ✓</span>}
      </div>

      <button onClick={del} className="mt-4 font-athletic text-xs font-bold uppercase tracking-wide text-barn-red">
        Delete game
      </button>
    </div>
  )
}

function RecentRow({
  game,
  state,
  favoriteIds,
  nameOf,
}: {
  game: Game
  state?: GState
  favoriteIds: Set<string>
  nameOf: (id: string) => string
}) {
  const myId = [game.home_team_id, game.away_team_id].find((id) => favoriteIds.has(id))
  const home = myId ? myId === game.home_team_id : true
  const my = state ? (home ? state.home : state.away) : 0
  const opp = state ? (home ? state.away : state.home) : 0
  const oppName = home ? nameOf(game.away_team_id) : nameOf(game.home_team_id)
  const wl = my > opp ? 'W' : my < opp ? 'L' : 'T'
  const color = my > opp ? 'text-board-green' : my < opp ? 'text-barn-red' : 'text-muted-tan'
  return (
    <li>
      <Link
        to={`/watch/${game.id}`}
        className="flex items-center justify-between gap-2 border-2 border-ink bg-cream-off p-3 hover:bg-cream"
      >
        <div className="min-w-0">
          <p className="truncate font-display">
            <span className="text-muted-tan">{home ? 'vs' : 'at'}</span> {oppName}
          </p>
          <p className="font-athletic text-[11px] uppercase tracking-wide text-muted-tan">
            {game.scheduled_at ? formatWhen(game.scheduled_at) : 'Final'}
          </p>
        </div>
        <span className={`shrink-0 font-display text-lg tabular ${color}`}>
          {state ? `${wl} ${my}-${opp}` : 'Final'}
        </span>
      </Link>
    </li>
  )
}

function TeamCard({
  team,
  record,
  next,
  nameOf,
  onOpen,
  onToggleFav,
}: {
  team: Team
  record?: TeamRecord
  next?: Game
  nameOf: (id: string) => string
  onOpen: () => void
  onToggleFav: () => void
}) {
  const rec = record ? `${record.w}-${record.l}${record.t ? `-${record.t}` : ''}` : '0-0'
  const nextLabel = next
    ? `Next: ${next.home_team_id === team.id ? 'vs ' + nameOf(next.away_team_id) : 'at ' + nameOf(next.home_team_id)}${
        next.scheduled_at ? ' · ' + formatWhen(next.scheduled_at) : ''
      }`
    : 'No upcoming games'
  return (
    <div className="border-2 border-ink bg-cream-off">
      <button onClick={onOpen} className="block w-full p-4 text-left">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-lg leading-tight">{team.name}</h3>
          <span className="shrink-0 font-display text-lg text-board-green">{rec}</span>
        </div>
        <p className="mt-1 truncate font-athletic text-[11px] uppercase tracking-wide text-muted-tan">{nextLabel}</p>
      </button>
      <div className="flex items-center justify-between border-t-2 border-ink/15 px-4 py-2">
        <button
          onClick={onToggleFav}
          className={`font-athletic text-xs font-bold uppercase tracking-wide ${team.is_favorite ? 'text-gold' : 'text-ink/40'}`}
        >
          {team.is_favorite ? '★ My team' : '☆ Add'}
        </button>
        <button onClick={onOpen} className="font-athletic text-xs font-bold uppercase tracking-wide text-board-green">
          Open ›
        </button>
      </div>
    </div>
  )
}

// W-L-T + runs across each team's FINAL games (from cached game_state final scores).
function computeRecords(games: Game[], states: Map<string, { home: number; away: number }>): Map<string, TeamRecord> {
  const rec = new Map<string, TeamRecord>()
  const ensure = (id: string) => {
    let r = rec.get(id)
    if (!r) {
      r = { w: 0, l: 0, t: 0, rf: 0, ra: 0 }
      rec.set(id, r)
    }
    return r
  }
  for (const g of games) {
    if (g.status !== 'final') continue
    const st = states.get(g.id)
    if (!st) continue
    for (const side of ['home', 'away'] as const) {
      const r = ensure(side === 'home' ? g.home_team_id : g.away_team_id)
      const my = side === 'home' ? st.home : st.away
      const opp = side === 'home' ? st.away : st.home
      r.rf += my
      r.ra += opp
      if (my > opp) r.w += 1
      else if (my < opp) r.l += 1
      else r.t += 1
    }
  }
  return rec
}

// upcoming is pre-sorted by scheduled_at ascending → the first one for the team is next.
function nextGameFor(upcoming: Game[], teamId: string): Game | undefined {
  return upcoming.find((g) => g.home_team_id === teamId || g.away_team_id === teamId)
}

/* ------------------------------------------------------------------ Games */

export function GamesView({
  teams,
  games,
  userId,
  onChange,
  onError,
  teamId,
  heading = 'Games',
  afterUpcoming,
}: {
  teams: Team[]
  games: Game[]
  userId: string
  onChange: () => void
  onError: (m: string) => void
  teamId?: string // scope to one team's games + lock it into new games
  heading?: string | null
  afterUpcoming?: React.ReactNode // rendered between Upcoming and Past (e.g. practices)
}) {
  const [creating, setCreating] = useState(false)
  const [pastShown, setPastShown] = useState(5) // paginate finished games

  async function deleteGame(game: Game) {
    if (!window.confirm('Delete this game and all its plays, stats, and recap? This can’t be undone.')) return
    const { error } = await supabase.from('games').delete().eq('id', game.id)
    if (error) onError(error.message)
    else onChange()
  }

  // Upcoming/live at the top (soonest first); finished games at the bottom, most
  // recent first, paginated.
  const mine = teamId ? games.filter((g) => g.home_team_id === teamId || g.away_team_id === teamId) : games
  const byWhenAsc = (a: Game, b: Game) => whenMs(a.scheduled_at) - whenMs(b.scheduled_at)
  const active = mine.filter((g) => g.status !== 'final').sort(byWhenAsc)
  const finals = mine.filter((g) => g.status === 'final').sort((a, b) => byWhenAsc(b, a))
  const shownFinals = finals.slice(0, pastShown)

  const renderRow = (game: Game) => {
    const away = teams.find((t) => t.id === game.away_team_id)
    const home = teams.find((t) => t.id === game.home_team_id)
    const isFinal = game.status === 'final'
    return (
      <li key={game.id} className="border-2 border-ink bg-cream-off p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-display text-lg">
              {away?.name ?? '?'} <span className="text-muted-tan">at</span> {home?.name ?? '?'}
            </p>
            <p className="mt-0.5 font-athletic text-xs uppercase tracking-wide text-muted-tan">
              <StatusPill status={game.status} /> · {videoLabel(game.video_source)}
              {game.scheduled_at ? ` · ${formatWhen(game.scheduled_at)}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isFinal ? (
              /* A finished game just needs its summary (+ a quiet delete). No setup. */
              <>
                <Link to={`/watch/${game.id}`} className="bg-board-green px-4 py-2 font-display text-sm text-cream">
                  Game summary ▸
                </Link>
                <button
                  onClick={() => deleteGame(game)}
                  className="px-2 py-2 font-athletic text-xs font-bold uppercase tracking-wide text-ink/40 hover:text-barn-red"
                >
                  Delete
                </button>
              </>
            ) : (
              /* Upcoming/live: score it, or open its setup hub (lineup, video, share, details). */
              <>
                <Link to={`/score/${game.id}`} className="bg-board-green px-4 py-2 font-display text-sm text-cream">
                  {game.status === 'live' ? 'Resume ▸' : 'Score ▸'}
                </Link>
                <Link to={`/game/${game.id}`} className="border-2 border-ink px-4 py-2 font-display text-sm text-ink">
                  Setup
                </Link>
              </>
            )}
          </div>
        </div>
      </li>
    )
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        {heading ? <h2 className="font-display text-2xl">{heading}</h2> : <span />}
        {teams.length >= 2 && !creating && (
          <button onClick={() => setCreating(true)} className="bg-gold px-4 py-2 font-display text-ink">
            {teamId ? '+ Schedule a game' : '+ New Game'}
          </button>
        )}
      </div>

      {teams.length < 2 && (
        <EmptyHint>Add at least two teams before scheduling a game.</EmptyHint>
      )}

      {creating && (
        <CreateGameCard
          fixedTeamId={teamId}
          teams={teams}
          userId={userId}
          onError={onError}
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            onChange()
          }}
        />
      )}

      {/* Upcoming & live — the top of the page */}
      <p className="mb-2 mt-4 font-athletic text-xs font-semibold uppercase tracking-[.14em] text-muted-tan">
        Upcoming
      </p>
      <ul className="flex flex-col gap-3">
        {active.map(renderRow)}
        {active.length === 0 && (
          <EmptyHint>
            {teams.length >= 2 ? 'Nothing scheduled yet.' : 'Add a team to schedule a game.'}
          </EmptyHint>
        )}
      </ul>

      {/* Practices & events slot (games + practices both live at the top) */}
      {afterUpcoming}

      {/* Past games — bottom of the page, paginated */}
      {finals.length > 0 && (
        <div className="mt-8">
          <p className="mb-2 font-athletic text-xs font-semibold uppercase tracking-[.14em] text-muted-tan">
            Past games
          </p>
          <ul className="flex flex-col gap-3">{shownFinals.map(renderRow)}</ul>
          {finals.length > pastShown && (
            <button
              onClick={() => setPastShown((n) => n + 10)}
              className="mt-3 w-full border-2 border-ink/30 py-2 font-athletic text-sm font-semibold uppercase tracking-wide text-muted-tan"
            >
              Show more ({finals.length - pastShown} older)
            </button>
          )}
        </div>
      )}
    </section>
  )
}

// In-app viewer for the scorer — embeds the public /watch page in an iframe so it
const VIDEO_SOURCES: { value: VideoSource; label: string; sub: string }[] = [
  { value: 'none', label: 'No video', sub: 'Stats only' },
  { value: 'phone_whip', label: 'Another phone', sub: 'Film from a 2nd device' },
  { value: 'youtube', label: 'External camera', sub: 'GoPro / DJI' },
]

function CreateGameCard({
  teams,
  userId,
  onError,
  onCancel,
  onCreated,
  fixedTeamId,
}: {
  teams: Team[]
  userId: string
  onError: (m: string) => void
  onCancel: () => void
  onCreated: () => void
  fixedTeamId?: string // pre-select this team (home) when scheduling from its page
}) {
  // Newly-created opponents are tracked locally so they appear in the pickers
  // immediately (the parent reloads its teams list on game create).
  const [extraTeams, setExtraTeams] = useState<Team[]>([])
  const allTeams = [...teams, ...extraTeams]
  const favorites = allTeams.filter((t) => t.is_favorite)
  const firstFav = favorites[0]?.id ?? ''
  const [away, setAway] = useState('')
  const [home, setHome] = useState(fixedTeamId ?? firstFav)
  const [when, setWhen] = useState('')
  const [location, setLocation] = useState('')
  const [video, setVideo] = useState<VideoSource>('none')
  const [ytUrl, setYtUrl] = useState('')
  const [busy, setBusy] = useState(false)

  // Create a team/opponent inline from a picker; returns its id to auto-select.
  async function createTeam(name: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('teams')
      .insert({ name: name.trim(), owner_id: userId, is_favorite: false })
      .select('*')
      .single()
    if (error) {
      onError(error.message)
      return null
    }
    const created = data as Team
    setExtraTeams((prev) => [...prev, created])
    return created.id
  }

  async function create() {
    if (!away || !home) return onError('Pick both teams.')
    if (away === home) return onError('Away and home must be different teams.')
    setBusy(true)
    const aName = allTeams.find((t) => t.id === away)?.name
    const hName = allTeams.find((t) => t.id === home)?.name
    const { error } = await supabase.from('games').insert({
      owner_id: userId,
      away_team_id: away,
      home_team_id: home,
      // datetime-local is a naive local string; convert to a real instant so it
      // isn't misread as UTC (which showed 11 AM as 7 AM to viewers).
      scheduled_at: when ? new Date(when).toISOString() : null,
      location: location.trim() || null,
      video_source: video,
      video_config: video === 'youtube' && ytUrl.trim() ? { youtube_url: ytUrl.trim() } : {},
      slug: makeSlug(aName, hName),
    })
    setBusy(false)
    if (error) onError(error.message)
    else onCreated()
  }

  return (
    <div className="border-2 border-ink bg-cream-off p-5">
      <h3 className="mb-4 font-display text-xl">New Game</h3>

      {/* Matchup — search your teams / past opponents, or add a new one inline */}
      <div className="mb-5 grid grid-cols-[1fr_auto_1fr] items-start gap-3">
        <TeamPicker label="Away" value={away} onChange={setAway} teams={allTeams} onCreate={createTeam} />
        <span className="pt-7 font-athletic text-sm uppercase text-muted-tan">at</span>
        <TeamPicker label="Home" value={home} onChange={setHome} teams={allTeams} onCreate={createTeam} accent />
      </div>

      {/* Video source */}
      <p className="mb-2 font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">
        Video source
      </p>
      <div className="mb-5 grid grid-cols-3 gap-2">
        {VIDEO_SOURCES.map((v) => {
          const sel = video === v.value
          return (
            <button
              key={v.value}
              onClick={() => setVideo(v.value)}
              className={`flex flex-col items-start border-2 p-3 text-left ${
                sel ? 'border-gold bg-board-green text-cream' : 'border-ink bg-white text-ink'
              }`}
            >
              <span className="font-display text-base">
                {v.label} {sel ? '✓' : ''}
              </span>
              <span
                className={`font-athletic text-[11px] uppercase tracking-wide ${
                  sel ? 'text-muted-green' : 'text-muted-tan'
                }`}
              >
                {v.sub}
              </span>
            </button>
          )
        })}
      </div>

      {/* External camera → YouTube link (optional now; can be added at game time) */}
      {video === 'youtube' && (
        <label className="mb-5 block">
          <span className="mb-1 block font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">
            YouTube live link (optional)
          </span>
          <input
            value={ytUrl}
            onChange={(e) => setYtUrl(e.target.value)}
            placeholder="https://youtu.be/…"
            className="w-full border-2 border-ink bg-white px-3 py-2 font-data outline-none focus:border-board-green"
          />
          <span className="mt-1 block font-data text-[11px] text-muted-tan">
            Go live from your GoPro/DJI app to an unlisted YouTube stream and paste the link.
            You can also add or change it later from the scorer’s Video screen.
          </span>
        </label>
      )}

      {/* Field & time */}
      <label className="mb-5 block">
        <span className="mb-1 block font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">
          Date & time (optional)
        </span>
        {/* The wrapper owns the box; the input is flex-1 min-w-0 so flexbox forces
            the native iOS datetime widget to the wrapper width (no overflow), while
            keeping its native appearance (appearance-none collapses it when empty). */}
        <div className="flex w-full items-center border-2 border-ink bg-white px-3 py-2 focus-within:border-board-green">
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="min-w-0 flex-1 bg-transparent font-data text-ink outline-none"
          />
        </div>
      </label>

      {/* Location */}
      <label className="mb-5 block">
        <span className="mb-1 block font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">
          Location (optional)
        </span>
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. Cedar Park · Field 2"
          className="w-full border-2 border-ink bg-white px-3 py-2 font-data outline-none focus:border-board-green"
        />
      </label>

      <div className="flex gap-2">
        <button
          onClick={create}
          disabled={busy}
          className="flex-1 bg-gold py-3 font-display text-ink disabled:opacity-60"
        >
          {busy ? '…' : 'Create Game ▸'}
        </button>
        <button onClick={onCancel} className="border-2 border-ink px-4 py-3 font-display text-ink">
          Cancel
        </button>
      </div>
    </div>
  )
}

// Searchable team/opponent picker — a custom control (no native <select>), so it looks
// identical and clean on iOS + Android, and scales to long lists. Type to filter your
// teams / past opponents, or add a brand-new one inline.
function TeamPicker({
  label,
  value,
  onChange,
  teams,
  onCreate,
  accent = false,
}: {
  label: string
  value: string
  onChange: (id: string) => void
  teams: Team[]
  onCreate: (name: string) => Promise<string | null>
  accent?: boolean
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const selected = teams.find((t) => t.id === value)
  const q = query.trim().toLowerCase()
  const list = q ? teams.filter((t) => t.name.toLowerCase().includes(q)) : teams
  const favs = list.filter((t) => t.is_favorite)
  const others = list.filter((t) => !t.is_favorite)
  const exact = teams.some((t) => t.name.trim().toLowerCase() === q)

  function choose(id: string) {
    onChange(id)
    setQuery('')
    setOpen(false)
  }
  async function add() {
    const name = query.trim()
    if (!name || busy) return
    setBusy(true)
    const id = await onCreate(name)
    setBusy(false)
    if (id) choose(id)
  }

  return (
    <div className="relative">
      <span className="mb-1 block font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">
        {label}
      </span>
      <input
        value={open ? query : selected?.name ?? ''}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => {
          setQuery('')
          setOpen(true)
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        placeholder="Search or add…"
        className={`w-full min-w-0 border-2 px-3 py-2 font-display outline-none focus:border-board-green ${
          accent && selected && !open ? 'border-ink bg-ink text-gold' : 'border-ink bg-white text-ink'
        }`}
      />
      {open && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto border-2 border-ink bg-white shadow-hard">
          {favs.length > 0 && <PickerGroup label="My teams" />}
          {favs.map((t) => (
            <PickerOpt key={t.id} name={`★ ${t.name}`} onPick={() => choose(t.id)} />
          ))}
          {others.length > 0 && <PickerGroup label={favs.length ? 'Other teams' : 'Teams'} />}
          {others.map((t) => (
            <PickerOpt key={t.id} name={t.name} onPick={() => choose(t.id)} />
          ))}
          {q && !exact && (
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={add}
              disabled={busy}
              className="block w-full border-t-2 border-ink/15 bg-board-green px-3 py-2 text-left font-display text-sm text-cream disabled:opacity-60"
            >
              {busy ? 'Adding…' : `+ Add “${query.trim()}”`}
            </button>
          )}
          {list.length === 0 && !q && (
            <div className="px-3 py-2 font-data text-sm text-muted-tan">Type to search or add a team.</div>
          )}
        </div>
      )}
    </div>
  )
}
function PickerGroup({ label }: { label: string }) {
  return (
    <div className="bg-cream-off px-3 py-1 font-athletic text-[10px] font-semibold uppercase tracking-wide text-muted-tan">
      {label}
    </div>
  )
}
function PickerOpt({ name, onPick }: { name: string; onPick: () => void }) {
  return (
    <button
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      className="block w-full border-t border-ink/10 px-3 py-2 text-left font-display text-sm text-ink hover:bg-gold/20"
    >
      {name}
    </button>
  )
}

/* ------------------------------------------------------------------ Teams */


function NewTeamForm({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState('')
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        onAdd(name.trim())
        setName('')
      }}
      className="mt-2 border-2 border-ink bg-cream-off p-3"
    >
      <p className="mb-1 font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">
        Create a team
      </p>
      <p className="mb-2 font-data text-xs text-muted-tan">
        A team you manage — you’ll add the roster and details next. (Opponents are added right when you
        schedule a game.)
      </p>
      <div className="flex gap-2">
        <input
          autoFocus
          className="min-w-0 flex-1 appearance-none rounded-none border-2 border-ink bg-white px-3 py-2 font-data outline-none focus:border-board-green"
          placeholder="Team name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="shrink-0 bg-gold px-4 py-2 font-display text-ink" type="submit">
          Create ▸
        </button>
      </div>
    </form>
  )
}

/* ----------------------------------------------------------------- Roster */

export function Roster({ team, onError }: { team: Team; onError: (m: string) => void }) {
  const [players, setPlayers] = useState<Player[]>([]) // active roster
  const [archived, setArchived] = useState<Player[]>([]) // soft-deleted
  const [showArchived, setShowArchived] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const scanRef = useRef<HTMLInputElement>(null)
  const [scanning, setScanning] = useState(false)
  const [review, setReview] = useState<ScannedPlayer[] | null>(null)

  const reload = useCallback(() => {
    supabase
      .from('players')
      .select('*')
      .eq('team_id', team.id)
      .order('jersey_number', { nullsFirst: false })
      .then(({ data, error }) => {
        if (error) return onError(error.message)
        const all = (data ?? []) as Player[]
        setPlayers(all.filter((p) => !p.archived_at))
        setArchived(all.filter((p) => p.archived_at))
      })
  }, [team.id, onError])

  useEffect(reload, [reload])

  async function addPlayer(p: { name: string; jersey_number: string; default_position: string }) {
    const { error } = await supabase.from('players').insert({
      team_id: team.id,
      name: p.name,
      jersey_number: p.jersey_number || null,
      default_position: p.default_position || null,
    })
    if (error) onError(error.message)
    else reload()
  }

  // Edit a player's number / name / position. Safe across games — corrections
  // (typo, fixed number) just update the one player record.
  async function savePlayer(
    p: Player,
    patch: { name: string; jersey_number: string; default_position: string },
  ) {
    const { error } = await supabase
      .from('players')
      .update({
        name: patch.name.trim() || p.name,
        jersey_number: patch.jersey_number.trim() || null,
        default_position: patch.default_position.trim() || null,
      })
      .eq('id', p.id)
    if (error) onError(error.message)
    else reload()
  }

  async function archivePlayer(p: Player) {
    const { error } = await supabase
      .from('players')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', p.id)
    if (error) onError(error.message)
    else reload()
  }

  async function restorePlayer(p: Player) {
    const { error } = await supabase.from('players').update({ archived_at: null }).eq('id', p.id)
    if (error) onError(error.message)
    else reload()
  }

  // Remove: hard-delete a never-used player; if they have game history (FK), fall
  // back to archiving so past games stay intact and they leave the active roster.
  async function removePlayer(p: Player) {
    if (!window.confirm(`Remove ${p.name} from ${team.name}?`)) return
    const { error } = await supabase.from('players').delete().eq('id', p.id)
    if (!error) return reload()
    const fk = error.code === '23503' || /foreign key|violates/i.test(error.message)
    if (fk) {
      await archivePlayer(p)
      setImportMsg(`${p.name} has game history — archived (kept in past games, hidden from new lineups).`)
    } else {
      onError(error.message)
    }
  }

  async function onFile(file: File) {
    setImportMsg(null)
    const text = await file.text()
    const { rows, errors } = parseRosterCsv(text)
    if (rows.length === 0) {
      onError(errors[0] ?? 'No rows found in CSV.')
      return
    }
    const { error } = await supabase
      .from('players')
      .insert(rows.map((r) => ({ team_id: team.id, ...r })))
    if (error) {
      onError(error.message)
      return
    }
    setImportMsg(
      `Imported ${rows.length} player${rows.length === 1 ? '' : 's'}${
        errors.length ? ` · ${errors.length} row(s) skipped` : ''
      }.`,
    )
    reload()
  }

  async function onScanFile(file: File) {
    setImportMsg(null)
    setScanning(true)
    try {
      const found = await scanLineupImage(file)
      setReview(found)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Lineup scan failed.')
    } finally {
      setScanning(false)
    }
  }

  async function saveScanned(rows: ScannedPlayer[]) {
    const clean = rows.filter((r) => r.name.trim())
    if (clean.length === 0) {
      setReview(null)
      return
    }
    const { error } = await supabase.from('players').insert(
      clean.map((r) => ({
        team_id: team.id,
        name: r.name.trim(),
        jersey_number: r.number.trim() || null,
        default_position: r.position.trim() || null,
        bats: r.bats || null,
      })),
    )
    if (error) {
      onError(error.message)
      return
    }
    setReview(null)
    setImportMsg(`Added ${clean.length} player${clean.length === 1 ? '' : 's'} from scan.`)
    reload()
  }

  return (
    <div className="border-2 border-ink bg-cream-off">
      <div className="flex items-center justify-between gap-3 border-b-2 border-ink bg-white px-4 py-3">
        <p className="font-athletic text-xs uppercase tracking-wide text-muted-tan">
          {players.length} player{players.length === 1 ? '' : 's'}
        </p>
        <CodeEditor team={team} onError={onError} />
      </div>

      <ul className="flex flex-col">
        {players.map((p, i) => (
          <PlayerRow
            key={p.id}
            p={p}
            divider={i > 0}
            onSave={(patch) => savePlayer(p, patch)}
            onRemove={() => removePlayer(p)}
          />
        ))}
        {players.length === 0 && (
          <li className="px-4 py-4 font-data text-muted-tan">No players yet.</li>
        )}
      </ul>

      {archived.length > 0 && (
        <div className="border-t-2 border-ink/15">
          <button
            onClick={() => setShowArchived((s) => !s)}
            className="flex w-full items-center justify-between px-4 py-2.5 font-athletic text-xs font-semibold uppercase tracking-wide text-muted-tan"
          >
            <span>Archived ({archived.length})</span>
            <span>{showArchived ? '▲ hide' : '▼ show'}</span>
          </button>
          {showArchived && (
            <ul className="flex flex-col bg-ink/5">
              {archived.map((p) => (
                <li key={p.id} className="flex items-center gap-3 border-t border-ink/10 px-4 py-2.5">
                  <span className="w-8 text-right font-athletic text-xl font-bold text-ink/30">
                    {p.jersey_number ?? '—'}
                  </span>
                  <span className="font-display text-base text-muted-tan line-through">{p.name}</span>
                  <button
                    onClick={() => restorePlayer(p)}
                    className="ml-auto font-athletic text-xs font-bold uppercase tracking-wide text-board-green hover:underline"
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="border-t-2 border-ink p-4">
        <AddPlayerForm onAdd={addPlayer} />

        {/* Scan a lineup: screenshot from GameChanger, or a photo of the book. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={scanRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onScanFile(f)
              e.target.value = ''
            }}
          />
          <button
            onClick={() => scanRef.current?.click()}
            disabled={scanning}
            className="inline-flex items-center gap-1.5 bg-board-green px-3 py-1.5 font-athletic text-sm font-semibold uppercase tracking-wide text-cream disabled:opacity-60"
          >
            <CameraIcon className="h-4 w-4" />
            {scanning ? 'Reading lineup…' : 'Scan lineup'}
          </button>
          <span className="font-data text-[11px] text-muted-tan">
            Screenshot or photo · we’ll auto-fill, you confirm
          </span>
        </div>

        {/* CSV controls (desktop-friendly bulk import) */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onFile(f)
              e.target.value = ''
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 border-2 border-ink px-3 py-1.5 font-athletic text-sm font-semibold uppercase tracking-wide text-ink"
          >
            <UploadIcon className="h-4 w-4" />
            Upload CSV
          </button>
          <button
            onClick={() => downloadCsv('roster-template.csv', rosterTemplateCsv())}
            className="font-athletic text-sm uppercase tracking-wide text-board-green underline"
          >
            Download template
          </button>
          {importMsg && <span className="font-data text-xs text-board-green">{importMsg}</span>}
        </div>
        <p className="mt-1.5 font-data text-[11px] text-muted-tan">
          CSV columns: name, jersey_number, position, bats (L/R/S), throws (L/R).
        </p>
      </div>

      {review && (
        <LineupReviewModal
          teamName={team.name}
          initial={review}
          onCancel={() => setReview(null)}
          onSave={saveScanned}
        />
      )}
    </div>
  )
}

/* --------------------------------------------------- Scan review (confirm) */

// The review/edit step IS the design: a scan is a draft. Everything here is
// editable, rows can be dropped, and nothing is written until "Confirm & save".
function LineupReviewModal({
  teamName,
  initial,
  onCancel,
  onSave,
}: {
  teamName: string
  initial: ScannedPlayer[]
  onCancel: () => void
  onSave: (rows: ScannedPlayer[]) => Promise<void> | void
}) {
  const [rows, setRows] = useState<ScannedPlayer[]>(initial)
  const [busy, setBusy] = useState(false)

  function patch(i: number, field: keyof ScannedPlayer, value: string) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [field]: value } : r)))
  }
  function removeRow(i: number) {
    setRows((rs) => rs.filter((_, j) => j !== i))
  }

  const keepCount = rows.filter((r) => r.name.trim()).length

  async function save() {
    setBusy(true)
    await onSave(rows)
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" onClick={onCancel}>
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col border-t-2 border-gold bg-cream text-ink sm:border-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between bg-ink px-4 py-2.5">
          <span className="font-display text-lg text-cream">Confirm scanned lineup</span>
          <button onClick={onCancel} className="font-athletic text-cream">
            ✕
          </button>
        </div>

        <p className="px-4 pt-3 font-athletic text-[11px] uppercase tracking-[.12em] text-muted-tan">
          {teamName} · review &amp; fix before saving
        </p>

        <div className="overflow-y-auto px-3 py-2">
          {/* Column headers */}
          <div className="grid grid-cols-[2.5rem_1fr_3rem_3rem_1.5rem] items-center gap-1.5 px-1 pb-1 font-athletic text-[10px] font-semibold uppercase tracking-wide text-muted-tan">
            <span>#</span>
            <span>Player</span>
            <span>Pos</span>
            <span>Bats</span>
            <span />
          </div>
          <ul className="flex flex-col gap-1.5">
            {rows.map((r, i) => (
              <li
                key={i}
                className="grid grid-cols-[2.5rem_1fr_3rem_3rem_1.5rem] items-center gap-1.5"
              >
                <input
                  className="w-full border-2 border-ink bg-white px-1 py-1.5 text-center font-data text-sm outline-none focus:border-board-green"
                  value={r.number}
                  onChange={(e) => patch(i, 'number', e.target.value)}
                  placeholder="#"
                />
                <input
                  className="w-full border-2 border-ink bg-white px-2 py-1.5 font-data text-sm outline-none focus:border-board-green"
                  value={r.name}
                  onChange={(e) => patch(i, 'name', e.target.value)}
                  placeholder="Name"
                />
                <input
                  className="w-full border-2 border-ink bg-white px-1 py-1.5 text-center font-data text-sm uppercase outline-none focus:border-board-green"
                  value={r.position}
                  onChange={(e) => patch(i, 'position', e.target.value.toUpperCase())}
                  placeholder="—"
                />
                <select
                  className="w-full appearance-none rounded-none border-2 border-ink bg-white px-0.5 py-1.5 text-center font-data text-sm outline-none focus:border-board-green"
                  value={r.bats}
                  onChange={(e) => patch(i, 'bats', e.target.value as Handedness | '')}
                >
                  <option value="">—</option>
                  <option value="L">L</option>
                  <option value="R">R</option>
                  <option value="S">S</option>
                </select>
                <button
                  onClick={() => removeRow(i)}
                  title="Remove row"
                  className="text-lg text-barn-red"
                >
                  ✕
                </button>
              </li>
            ))}
            {rows.length === 0 && (
              <li className="px-1 py-3 font-data text-sm text-muted-tan">
                No rows left. Cancel and try a clearer image.
              </li>
            )}
          </ul>
        </div>

        <div className="mt-auto flex gap-2 border-t-2 border-ink p-4">
          <button
            onClick={save}
            disabled={busy || keepCount === 0}
            className="flex-1 bg-gold py-3 font-display text-ink disabled:opacity-60"
          >
            {busy ? 'Saving…' : `Confirm & save ${keepCount} player${keepCount === 1 ? '' : 's'} ▸`}
          </button>
          <button onClick={onCancel} className="border-2 border-ink px-4 py-3 font-display text-ink">
            Discard
          </button>
        </div>
      </div>
    </div>
  )
}

function CodeEditor({ team, onError }: { team: Team; onError: (m: string) => void }) {
  const [code, setCode] = useState(team.code ?? '')
  useEffect(() => setCode(team.code ?? ''), [team.code, team.id])
  async function save() {
    const next = code.trim().toUpperCase().slice(0, 4) || null
    if (next === (team.code ?? null)) return
    const { error } = await supabase.from('teams').update({ code: next }).eq('id', team.id)
    if (error) onError(error.message)
  }
  return (
    <label className="flex flex-col items-end">
      <span className="font-athletic text-[10px] font-semibold uppercase tracking-[.12em] text-muted-tan">
        Code
      </span>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
        onBlur={save}
        placeholder="—"
        className="w-16 border-2 border-ink bg-cream px-2 py-1 text-center font-athletic text-lg font-bold uppercase tracking-wide outline-none focus:border-board-green"
      />
    </label>
  )
}

// One roster row — display mode with Edit/Remove, or an inline edit form.
function PlayerRow({
  p,
  divider,
  onSave,
  onRemove,
}: {
  p: Player
  divider: boolean
  onSave: (patch: { name: string; jersey_number: string; default_position: string }) => void
  onRemove: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [num, setNum] = useState(p.jersey_number ?? '')
  const [name, setName] = useState(p.name)
  const [pos, setPos] = useState(p.default_position ?? '')

  function startEdit() {
    setNum(p.jersey_number ?? '')
    setName(p.name)
    setPos(p.default_position ?? '')
    setEditing(true)
  }
  function save() {
    if (!name.trim()) return
    onSave({ name, jersey_number: num, default_position: pos })
    setEditing(false)
  }

  const input = 'border-2 border-ink bg-white px-2 py-1.5 font-data outline-none focus:border-board-green'

  if (editing) {
    return (
      <li className={`flex flex-wrap items-center gap-2 px-4 py-2.5 ${divider ? 'border-t border-ink/12' : ''}`}>
        <input className={`w-12 ${input}`} placeholder="#" value={num} onChange={(e) => setNum(e.target.value)} />
        <input
          className={`min-w-32 flex-1 ${input}`}
          placeholder="Player name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <input className={`w-16 ${input}`} placeholder="Pos" value={pos} onChange={(e) => setPos(e.target.value)} />
        <button onClick={save} className="bg-gold px-3 py-1.5 font-display text-ink">
          Save
        </button>
        <button
          onClick={() => setEditing(false)}
          className="px-2 py-1.5 font-athletic text-xs font-bold uppercase tracking-wide text-muted-tan"
        >
          Cancel
        </button>
      </li>
    )
  }
  return (
    <li className={`flex items-center gap-3 px-4 py-2.5 ${divider ? 'border-t border-ink/12' : ''}`}>
      <span className="w-8 text-right font-athletic text-xl font-bold text-barn-red">
        {p.jersey_number ?? '—'}
      </span>
      <span className="font-display text-base">{p.name}</span>
      <span className="ml-auto font-data text-xs text-muted-tan">
        {[p.default_position, p.bats && `B:${p.bats}`, p.throws && `T:${p.throws}`].filter(Boolean).join(' · ')}
      </span>
      <button
        onClick={startEdit}
        title={`Edit ${p.name}`}
        className="font-athletic text-xs font-bold uppercase tracking-wide text-ink/40 hover:text-board-green"
      >
        Edit
      </button>
      <button
        onClick={onRemove}
        title={`Remove ${p.name}`}
        className="font-athletic text-xs font-bold uppercase tracking-wide text-ink/40 hover:text-barn-red"
      >
        Remove
      </button>
    </li>
  )
}

function AddPlayerForm({
  onAdd,
}: {
  onAdd: (p: { name: string; jersey_number: string; default_position: string }) => void
}) {
  const [name, setName] = useState('')
  const [num, setNum] = useState('')
  const [pos, setPos] = useState('')
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        onAdd({ name: name.trim(), jersey_number: num, default_position: pos })
        setName('')
        setNum('')
        setPos('')
      }}
      className="flex flex-wrap gap-2"
    >
      <input
        className="w-14 border-2 border-ink bg-white px-2 py-1.5 font-data outline-none focus:border-board-green"
        placeholder="#"
        value={num}
        onChange={(e) => setNum(e.target.value)}
      />
      <input
        className="min-w-32 flex-1 border-2 border-ink bg-white px-2 py-1.5 font-data outline-none focus:border-board-green"
        placeholder="Player name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="w-20 border-2 border-ink bg-white px-2 py-1.5 font-data outline-none focus:border-board-green"
        placeholder="Pos"
        value={pos}
        onChange={(e) => setPos(e.target.value)}
      />
      <button className="bg-gold px-3 py-1.5 font-display text-ink" type="submit">
        Add
      </button>
    </form>
  )
}

/* ------------------------------------------------------------------ misc */

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-2 border-dashed border-ink/30 px-4 py-3 font-data text-sm text-muted-tan">
      {children}
    </p>
  )
}

function StatusPill({ status }: { status: Game['status'] }) {
  const map: Record<Game['status'], string> = {
    scheduled: 'text-muted-tan',
    live: 'text-barn-red',
    final: 'text-ink',
  }
  return <span className={`font-semibold ${map[status]}`}>{status.toUpperCase()}</span>
}

// Sort key for a game's scheduled time; undated sort last in ascending order.
function whenMs(iso: string | null): number {
  return iso ? Date.parse(iso) : Number.POSITIVE_INFINITY
}

function videoLabel(v: VideoSource): string {
  return (
    { none: 'Stats only', phone_whip: 'Another phone', camera_rtmp: 'External camera', youtube: 'External camera', cloudflare_hls: 'Cloudflare' } as Record<
      VideoSource,
      string
    >
  )[v]
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Stored instant (UTC ISO) → a local "YYYY-MM-DDTHH:mm" value for datetime-local.
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function makeSlug(away?: string, home?: string): string {
  const abbr = (s?: string) =>
    (s ?? 'tm').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 4) || 'tm'
  const rand = Math.random().toString(36).slice(2, 6)
  return `${abbr(away)}-${abbr(home)}-${rand}`
}

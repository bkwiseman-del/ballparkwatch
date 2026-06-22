import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthProvider'
import type { Game, Player, Team, VideoSource } from '@/lib/types'

export default function Setup() {
  const { user, signOut } = useAuth()
  const [teams, setTeams] = useState<Team[]>([])
  const [games, setGames] = useState<Game[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const [t, g] = await Promise.all([
      supabase.from('teams').select('*').order('created_at'),
      supabase.from('games').select('*').order('created_at', { ascending: false }),
    ])
    if (t.error) return setError(t.error.message)
    if (g.error) return setError(g.error.message)
    setTeams(t.data as Team[])
    setGames(g.data as Game[])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!selectedTeamId) {
      setPlayers([])
      return
    }
    supabase
      .from('players')
      .select('*')
      .eq('team_id', selectedTeamId)
      .order('jersey_number')
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setPlayers((data ?? []) as Player[])
      })
  }, [selectedTeamId])

  async function addTeam(name: string, season: string) {
    const { error } = await supabase
      .from('teams')
      .insert({ name, season: season || null, owner_id: user!.id })
    if (error) setError(error.message)
    else load()
  }

  async function addPlayer(p: {
    name: string
    jersey_number: string
    default_position: string
  }) {
    if (!selectedTeamId) return
    const { error } = await supabase.from('players').insert({
      team_id: selectedTeamId,
      name: p.name,
      jersey_number: p.jersey_number || null,
      default_position: p.default_position || null,
    })
    if (error) return setError(error.message)
    const { data } = await supabase
      .from('players')
      .select('*')
      .eq('team_id', selectedTeamId)
      .order('jersey_number')
    setPlayers((data ?? []) as Player[])
  }

  async function createGame(g: {
    away_team_id: string
    home_team_id: string
    scheduled_at: string
    video_source: VideoSource
  }) {
    const away = teams.find((t) => t.id === g.away_team_id)
    const home = teams.find((t) => t.id === g.home_team_id)
    const slug = makeSlug(away?.name, home?.name)
    const { error } = await supabase.from('games').insert({
      owner_id: user!.id,
      away_team_id: g.away_team_id,
      home_team_id: g.home_team_id,
      scheduled_at: g.scheduled_at || null,
      video_source: g.video_source,
      slug,
    })
    if (error) setError(error.message)
    else load()
  }

  return (
    <div className="min-h-full bg-cream text-ink">
      <header className="flex items-center justify-between border-b-2 border-ink bg-field-green px-4 py-3">
        <h1 className="font-display text-2xl text-cream">Ballpark Watch · Setup</h1>
        <button
          onClick={signOut}
          className="border-2 border-gold px-3 py-1 font-athletic uppercase tracking-wide text-sm text-gold"
        >
          Sign out
        </button>
      </header>

      {error && (
        <p className="border-b-2 border-barn-red bg-barn-red/10 px-4 py-2 font-data text-sm text-barn-red">
          {error}
        </p>
      )}

      <div className="mx-auto grid max-w-5xl gap-6 p-4 md:grid-cols-2">
        <Panel title="Teams">
          <ul className="mb-3 flex flex-col divide-y divide-ink/10">
            {teams.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => setSelectedTeamId(t.id)}
                  className={`flex w-full items-center justify-between px-2 py-2 text-left font-data ${
                    selectedTeamId === t.id ? 'bg-gold/30' : ''
                  }`}
                >
                  <span className="font-display text-lg">{t.name}</span>
                  <span className="font-athletic text-muted-tan">{t.season}</span>
                </button>
              </li>
            ))}
            {teams.length === 0 && <li className="py-2 font-data text-muted-tan">No teams yet.</li>}
          </ul>
          <TeamForm onAdd={addTeam} />
        </Panel>

        <Panel title={selectedTeamId ? 'Roster' : 'Roster — select a team'}>
          {selectedTeamId ? (
            <>
              <ul className="mb-3 flex flex-col divide-y divide-ink/10">
                {players.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-2 py-2 font-data">
                    <span className="w-8 font-athletic text-xl font-bold text-barn-red">
                      {p.jersey_number ?? '—'}
                    </span>
                    <span className="font-display">{p.name}</span>
                    <span className="ml-auto text-muted-tan">{p.default_position}</span>
                  </li>
                ))}
                {players.length === 0 && (
                  <li className="py-2 font-data text-muted-tan">No players yet.</li>
                )}
              </ul>
              <PlayerForm onAdd={addPlayer} />
            </>
          ) : (
            <p className="font-data text-muted-tan">Pick a team to manage its roster.</p>
          )}
        </Panel>

        <Panel title="Games" className="md:col-span-2">
          <ul className="mb-3 flex flex-col divide-y divide-ink/10">
            {games.map((game) => {
              const away = teams.find((t) => t.id === game.away_team_id)
              const home = teams.find((t) => t.id === game.home_team_id)
              return (
                <li key={game.id} className="flex items-center gap-3 px-2 py-2 font-data">
                  <span className="font-display">
                    {away?.name ?? '?'} @ {home?.name ?? '?'}
                  </span>
                  <span className="font-athletic uppercase text-muted-tan">{game.status}</span>
                  <span className="font-athletic text-muted-tan">{game.video_source}</span>
                  <span className="ml-auto flex gap-3">
                    <Link to={`/score/${game.id}`} className="text-board-green underline">
                      Score
                    </Link>
                    <Link to={`/watch/${game.id}`} className="text-board-green underline">
                      Watch
                    </Link>
                  </span>
                </li>
              )
            })}
            {games.length === 0 && <li className="py-2 font-data text-muted-tan">No games yet.</li>}
          </ul>
          <GameForm teams={teams} onCreate={createGame} />
        </Panel>
      </div>
    </div>
  )
}

function Panel({
  title,
  children,
  className = '',
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`border-2 border-ink bg-cream-off p-4 ${className}`}>
      <h2 className="mb-3 font-athletic text-lg font-bold uppercase tracking-wide text-ink">
        {title}
      </h2>
      {children}
    </section>
  )
}

const inputCls =
  'border-2 border-ink bg-white px-2 py-1.5 font-data text-ink outline-none focus:border-board-green'
const btnCls = 'bg-gold px-3 py-1.5 font-display text-ink'

function TeamForm({ onAdd }: { onAdd: (name: string, season: string) => void }) {
  const [name, setName] = useState('')
  const [season, setSeason] = useState('')
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        onAdd(name.trim(), season.trim())
        setName('')
        setSeason('')
      }}
      className="flex flex-wrap gap-2"
    >
      <input className={inputCls} placeholder="Team name" value={name} onChange={(e) => setName(e.target.value)} />
      <input className={inputCls} placeholder="Season (e.g. 2026)" value={season} onChange={(e) => setSeason(e.target.value)} />
      <button className={btnCls} type="submit">
        Add Team
      </button>
    </form>
  )
}

function PlayerForm({
  onAdd,
}: {
  onAdd: (p: { name: string; jersey_number: string; default_position: string }) => void
}) {
  const [name, setName] = useState('')
  const [jersey_number, setJersey] = useState('')
  const [default_position, setPos] = useState('')
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        onAdd({ name: name.trim(), jersey_number, default_position })
        setName('')
        setJersey('')
        setPos('')
      }}
      className="flex flex-wrap gap-2"
    >
      <input className={`${inputCls} w-16`} placeholder="#" value={jersey_number} onChange={(e) => setJersey(e.target.value)} />
      <input className={inputCls} placeholder="Player name" value={name} onChange={(e) => setName(e.target.value)} />
      <input className={`${inputCls} w-20`} placeholder="Pos" value={default_position} onChange={(e) => setPos(e.target.value)} />
      <button className={btnCls} type="submit">
        Add Player
      </button>
    </form>
  )
}

const VIDEO_SOURCES: { value: VideoSource; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'phone_whip', label: 'This phone' },
  { value: 'camera_rtmp', label: 'External camera' },
  { value: 'youtube', label: 'YouTube' },
]

function GameForm({
  teams,
  onCreate,
}: {
  teams: Team[]
  onCreate: (g: {
    away_team_id: string
    home_team_id: string
    scheduled_at: string
    video_source: VideoSource
  }) => void
}) {
  const [away_team_id, setAway] = useState('')
  const [home_team_id, setHome] = useState('')
  const [scheduled_at, setWhen] = useState('')
  const [video_source, setVideo] = useState<VideoSource>('none')

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!away_team_id || !home_team_id) return
        onCreate({ away_team_id, home_team_id, scheduled_at, video_source })
      }}
      className="flex flex-wrap items-end gap-2"
    >
      <select className={inputCls} value={away_team_id} onChange={(e) => setAway(e.target.value)}>
        <option value="">Away team…</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <span className="font-athletic text-muted-tan">at</span>
      <select className={inputCls} value={home_team_id} onChange={(e) => setHome(e.target.value)}>
        <option value="">Home team…</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <input
        className={inputCls}
        type="datetime-local"
        value={scheduled_at}
        onChange={(e) => setWhen(e.target.value)}
      />
      <select className={inputCls} value={video_source} onChange={(e) => setVideo(e.target.value as VideoSource)}>
        {VIDEO_SOURCES.map((v) => (
          <option key={v.value} value={v.value}>
            {v.label}
          </option>
        ))}
      </select>
      <button className={btnCls} type="submit">
        Create Game
      </button>
    </form>
  )
}

function makeSlug(away?: string, home?: string): string {
  const abbr = (s?: string) =>
    (s ?? 'tm')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 4) || 'tm'
  const rand = Math.random().toString(36).slice(2, 6)
  return `${abbr(away)}-${abbr(home)}-${rand}`
}

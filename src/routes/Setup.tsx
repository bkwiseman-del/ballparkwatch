import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthProvider'
import { HeaderWordmark } from '@/components/Logo'
import { downloadCsv, parseRosterCsv, rosterTemplateCsv } from '@/lib/csv'
import type { Game, Player, Team, VideoSource } from '@/lib/types'

type Tab = 'games' | 'teams'

export default function Setup() {
  const { user, signOut } = useAuth()
  const [tab, setTab] = useState<Tab>('games')
  const [teams, setTeams] = useState<Team[]>([])
  const [games, setGames] = useState<Game[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const [t, g] = await Promise.all([
      supabase.from('teams').select('*').order('is_favorite', { ascending: false }).order('name'),
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

  return (
    <div className="min-h-full bg-cream text-ink">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b-2 border-ink bg-field-green px-4 py-2.5 text-cream">
        <HeaderWordmark />
        <button
          onClick={signOut}
          className="font-athletic text-sm uppercase tracking-wide text-gold hover:underline"
        >
          Sign out
        </button>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-5">
        {/* Segmented tabs */}
        <div className="mb-6 inline-flex border-2 border-ink">
          {(['games', 'teams'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-6 py-2 font-athletic text-sm font-semibold uppercase tracking-[.12em] ${
                tab === t ? 'bg-ink text-cream' : 'bg-cream text-ink'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {error && (
          <p className="mb-4 border-2 border-barn-red bg-barn-red/10 px-3 py-2 font-data text-sm text-barn-red">
            {error}
          </p>
        )}

        {tab === 'games' ? (
          <GamesView teams={teams} games={games} userId={user!.id} onChange={load} onError={setError} />
        ) : (
          <TeamsView teams={teams} userId={user!.id} onChange={load} onError={setError} />
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Games */

function GamesView({
  teams,
  games,
  userId,
  onChange,
  onError,
}: {
  teams: Team[]
  games: Game[]
  userId: string
  onChange: () => void
  onError: (m: string) => void
}) {
  const [creating, setCreating] = useState(false)

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-2xl">Games</h2>
        {teams.length >= 2 && !creating && (
          <button onClick={() => setCreating(true)} className="bg-gold px-4 py-2 font-display text-ink">
            + New Game
          </button>
        )}
      </div>

      {teams.length < 2 && (
        <EmptyHint>
          Add at least two teams in the <b>Teams</b> tab before creating a game.
        </EmptyHint>
      )}

      {creating && (
        <CreateGameCard
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

      <ul className="mt-4 flex flex-col gap-3">
        {games.map((game) => {
          const away = teams.find((t) => t.id === game.away_team_id)
          const home = teams.find((t) => t.id === game.home_team_id)
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
                <div className="flex gap-2">
                  <Link
                    to={`/score/${game.id}`}
                    className="bg-board-green px-4 py-2 font-display text-sm text-cream"
                  >
                    Score ▸
                  </Link>
                  <Link
                    to={`/watch/${game.id}`}
                    className="border-2 border-ink px-4 py-2 font-display text-sm text-ink"
                  >
                    Watch
                  </Link>
                </div>
              </div>
            </li>
          )
        })}
        {games.length === 0 && teams.length >= 2 && !creating && (
          <EmptyHint>No games yet — tap “New Game” to schedule one.</EmptyHint>
        )}
      </ul>
    </section>
  )
}

const VIDEO_SOURCES: { value: VideoSource; label: string; sub: string }[] = [
  { value: 'none', label: 'None', sub: 'Stats only' },
  { value: 'phone_whip', label: 'This phone', sub: 'Camera here' },
  { value: 'camera_rtmp', label: 'External', sub: 'GoPro / Mevo' },
  { value: 'youtube', label: 'YouTube', sub: 'Unlisted live' },
]

function CreateGameCard({
  teams,
  userId,
  onError,
  onCancel,
  onCreated,
}: {
  teams: Team[]
  userId: string
  onError: (m: string) => void
  onCancel: () => void
  onCreated: () => void
}) {
  const favorites = teams.filter((t) => t.is_favorite)
  const firstFav = favorites[0]?.id ?? ''
  const [away, setAway] = useState('')
  const [home, setHome] = useState(firstFav)
  const [when, setWhen] = useState('')
  const [video, setVideo] = useState<VideoSource>('none')
  const [busy, setBusy] = useState(false)

  async function create() {
    if (!away || !home) return onError('Pick both teams.')
    if (away === home) return onError('Away and home must be different teams.')
    setBusy(true)
    const aName = teams.find((t) => t.id === away)?.name
    const hName = teams.find((t) => t.id === home)?.name
    const { error } = await supabase.from('games').insert({
      owner_id: userId,
      away_team_id: away,
      home_team_id: home,
      scheduled_at: when || null,
      video_source: video,
      slug: makeSlug(aName, hName),
    })
    setBusy(false)
    if (error) onError(error.message)
    else onCreated()
  }

  return (
    <div className="border-2 border-ink bg-cream-off p-5">
      <h3 className="mb-4 font-display text-xl">New Game</h3>

      {/* Matchup */}
      <div className="mb-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <TeamSelect label="Away" value={away} onChange={setAway} teams={teams} favorites={favorites} />
        <span className="pt-5 font-athletic text-sm uppercase text-muted-tan">at</span>
        <TeamSelect
          label="Home"
          value={home}
          onChange={setHome}
          teams={teams}
          favorites={favorites}
          accent
        />
      </div>

      {/* Video source */}
      <p className="mb-2 font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">
        Video source
      </p>
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
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

      {/* Field & time */}
      <label className="mb-5 block">
        <span className="mb-1 block font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">
          Date & time (optional)
        </span>
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
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

function TeamSelect({
  label,
  value,
  onChange,
  teams,
  favorites,
  accent = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  teams: Team[]
  favorites: Team[]
  accent?: boolean
}) {
  const others = teams.filter((t) => !t.is_favorite)
  return (
    <label className="block">
      <span className="mb-1 block font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full border-2 px-3 py-2 font-display outline-none ${
          accent ? 'border-ink bg-ink text-gold' : 'border-ink bg-white text-ink'
        }`}
      >
        <option value="">Select…</option>
        {favorites.length > 0 && (
          <optgroup label="My Teams">
            {favorites.map((t) => (
              <option key={t.id} value={t.id}>
                ★ {t.name}
              </option>
            ))}
          </optgroup>
        )}
        {others.length > 0 && (
          <optgroup label="Other teams">
            {others.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  )
}

/* ------------------------------------------------------------------ Teams */

function TeamsView({
  teams,
  userId,
  onChange,
  onError,
}: {
  teams: Team[]
  userId: string
  onChange: () => void
  onError: (m: string) => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = teams.find((t) => t.id === selectedId) ?? null
  const favorites = teams.filter((t) => t.is_favorite)
  const others = teams.filter((t) => !t.is_favorite)

  async function toggleFavorite(team: Team) {
    const { error } = await supabase
      .from('teams')
      .update({ is_favorite: !team.is_favorite })
      .eq('id', team.id)
    if (error) onError(error.message)
    else onChange()
  }

  async function addTeam(name: string, season: string, favorite: boolean) {
    const { error } = await supabase
      .from('teams')
      .insert({ name, season: season || null, is_favorite: favorite, owner_id: userId })
    if (error) onError(error.message)
    else onChange()
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_1.2fr]">
      <section>
        <h2 className="mb-3 font-display text-2xl">Teams</h2>

        {favorites.length > 0 && (
          <TeamGroup
            title="My Teams"
            teams={favorites}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onToggleFavorite={toggleFavorite}
          />
        )}
        <TeamGroup
          title={favorites.length > 0 ? 'Other teams' : 'All teams'}
          teams={others}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onToggleFavorite={toggleFavorite}
        />
        {teams.length === 0 && <EmptyHint>No teams yet — add your team below.</EmptyHint>}

        <NewTeamForm onAdd={addTeam} />
      </section>

      <section>
        {selected ? (
          <Roster team={selected} onError={onError} />
        ) : (
          <div className="flex h-full min-h-40 items-center justify-center border-2 border-dashed border-ink/30 p-6 text-center font-data text-muted-tan">
            Select a team to manage its roster, or import one from CSV.
          </div>
        )}
      </section>
    </div>
  )
}

function TeamGroup({
  title,
  teams,
  selectedId,
  onSelect,
  onToggleFavorite,
}: {
  title: string
  teams: Team[]
  selectedId: string | null
  onSelect: (id: string) => void
  onToggleFavorite: (t: Team) => void
}) {
  if (teams.length === 0) return null
  return (
    <div className="mb-4">
      <p className="mb-1.5 font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">
        {title}
      </p>
      <ul className="flex flex-col border-2 border-ink">
        {teams.map((t, i) => (
          <li
            key={t.id}
            className={`flex items-center gap-2 ${i > 0 ? 'border-t border-ink/15' : ''} ${
              selectedId === t.id ? 'bg-gold/25' : 'bg-cream-off'
            }`}
          >
            <button
              onClick={() => onToggleFavorite(t)}
              title={t.is_favorite ? 'Remove from My Teams' : 'Mark as My Team'}
              className={`px-3 py-3 text-lg ${t.is_favorite ? 'text-gold' : 'text-ink/25'}`}
            >
              ★
            </button>
            <button onClick={() => onSelect(t.id)} className="flex-1 py-3 pr-3 text-left">
              <span className="font-display text-lg">{t.name}</span>
              {t.season && <span className="ml-2 font-athletic text-muted-tan">{t.season}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function NewTeamForm({ onAdd }: { onAdd: (name: string, season: string, favorite: boolean) => void }) {
  const [name, setName] = useState('')
  const [season, setSeason] = useState('')
  const [favorite, setFavorite] = useState(true)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        onAdd(name.trim(), season.trim(), favorite)
        setName('')
        setSeason('')
      }}
      className="mt-2 border-2 border-ink bg-cream-off p-3"
    >
      <p className="mb-2 font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">
        Add a team
      </p>
      <div className="flex flex-col gap-2">
        <input
          className="border-2 border-ink bg-white px-2 py-1.5 font-data outline-none focus:border-board-green"
          placeholder="Team name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="border-2 border-ink bg-white px-2 py-1.5 font-data outline-none focus:border-board-green"
          placeholder="Season (e.g. 2026)"
          value={season}
          onChange={(e) => setSeason(e.target.value)}
        />
        <label className="flex items-center gap-2 font-data text-sm">
          <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} />
          Add to <b>My Teams</b> (pre-selected for future games)
        </label>
        <button className="bg-gold py-2 font-display text-ink" type="submit">
          Add Team
        </button>
      </div>
    </form>
  )
}

/* ----------------------------------------------------------------- Roster */

function Roster({ team, onError }: { team: Team; onError: (m: string) => void }) {
  const [players, setPlayers] = useState<Player[]>([])
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(() => {
    supabase
      .from('players')
      .select('*')
      .eq('team_id', team.id)
      .order('jersey_number', { nullsFirst: false })
      .then(({ data, error }) => {
        if (error) onError(error.message)
        else setPlayers((data ?? []) as Player[])
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

  return (
    <div className="border-2 border-ink bg-cream-off">
      <div className="flex items-center justify-between border-b-2 border-ink bg-white px-4 py-3">
        <div>
          <h3 className="font-display text-xl">{team.name}</h3>
          <p className="font-athletic text-xs uppercase tracking-wide text-muted-tan">
            {team.season ? `${team.season} · ` : ''}
            {players.length} player{players.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      <ul className="flex flex-col">
        {players.map((p, i) => (
          <li
            key={p.id}
            className={`flex items-center gap-3 px-4 py-2.5 ${i > 0 ? 'border-t border-ink/12' : ''}`}
          >
            <span className="w-8 text-right font-athletic text-xl font-bold text-barn-red">
              {p.jersey_number ?? '—'}
            </span>
            <span className="font-display text-base">{p.name}</span>
            <span className="ml-auto font-data text-xs text-muted-tan">
              {[p.default_position, p.bats && `B:${p.bats}`, p.throws && `T:${p.throws}`]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </li>
        ))}
        {players.length === 0 && (
          <li className="px-4 py-4 font-data text-muted-tan">No players yet.</li>
        )}
      </ul>

      <div className="border-t-2 border-ink p-4">
        <AddPlayerForm onAdd={addPlayer} />

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
            className="border-2 border-ink px-3 py-1.5 font-athletic text-sm font-semibold uppercase tracking-wide text-ink"
          >
            ⬆ Upload CSV
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
    </div>
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

function videoLabel(v: VideoSource): string {
  return (
    { none: 'Stats only', phone_whip: 'This phone', camera_rtmp: 'External camera', youtube: 'YouTube', cloudflare_hls: 'Cloudflare' } as Record<
      VideoSource,
      string
    >
  )[v]
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function makeSlug(away?: string, home?: string): string {
  const abbr = (s?: string) =>
    (s ?? 'tm').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 4) || 'tm'
  const rand = Math.random().toString(36).slice(2, 6)
  return `${abbr(away)}-${abbr(home)}-${rand}`
}

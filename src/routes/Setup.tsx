import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthProvider'
import { HeaderWordmark } from '@/components/Logo'
import { downloadCsv, parseRosterCsv, rosterTemplateCsv } from '@/lib/csv'
import { scanLineupImage, type ScannedPlayer } from '@/lib/scanLineup'
import { CameraIcon, UploadIcon } from '@/components/Icons'
import { VideoSetup } from '@/components/VideoSetup'
import { ShareSheet } from '@/components/ShareSheet'
import { TeamMembers } from '@/components/TeamMembers'
import { SeasonStats } from '@/components/SeasonStats'
import type { Game, Handedness, Player, Team, VideoSource } from '@/lib/types'

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

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-cream text-ink">
      <header className="flex shrink-0 items-center justify-between border-b-2 border-gold bg-ink px-4 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] text-cream">
        <HeaderWordmark />
        <button
          onClick={signOut}
          className="font-athletic text-sm uppercase tracking-wide text-gold hover:underline"
        >
          Sign out
        </button>
      </header>

      {/* Only this area scrolls (and rubber-bands); the header stays put. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-3xl px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5">
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
  const [videoGame, setVideoGame] = useState<Game | null>(null)
  const [watchGame, setWatchGame] = useState<Game | null>(null)
  const [shareGame, setShareGame] = useState<Game | null>(null)
  const [showPast, setShowPast] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [eAway, setEAway] = useState('')
  const [eHome, setEHome] = useState('')
  const [eWhen, setEWhen] = useState('')
  const [eLoc, setELoc] = useState('')
  const favorites = teams.filter((t) => t.is_favorite)

  function startEdit(game: Game) {
    setEditId(game.id)
    setEAway(game.away_team_id)
    setEHome(game.home_team_id)
    setEWhen(toLocalInput(game.scheduled_at))
    setELoc(game.location ?? '')
  }

  async function saveEdit(game: Game) {
    if (!eAway || !eHome) return onError('Pick both teams.')
    if (eAway === eHome) return onError('Away and home must be different teams.')
    const { error } = await supabase
      .from('games')
      .update({
        away_team_id: eAway,
        home_team_id: eHome,
        scheduled_at: eWhen ? new Date(eWhen).toISOString() : null,
        location: eLoc.trim() || null,
      })
      .eq('id', game.id)
    if (error) return onError(error.message)
    // If a team was actually replaced (not just home/away swapped), its lineup no
    // longer applies — clear the game's lineups so they're rebuilt. A pure swap
    // keeps the same team_ids, so lineups stay valid.
    const before = [game.away_team_id, game.home_team_id].sort().join()
    const after = [eAway, eHome].sort().join()
    if (before !== after) await supabase.from('lineup_entries').delete().eq('game_id', game.id)
    setEditId(null)
    onChange()
  }

  async function deleteGame(game: Game) {
    if (!window.confirm('Delete this game and all its plays, stats, and recap? This can’t be undone.'))
      return
    const { error } = await supabase.from('games').delete().eq('id', game.id)
    if (error) onError(error.message)
    else onChange()
  }

  // Keep the list short: upcoming/live games first, then just the few most recent
  // finals; the rest are tucked behind a "past games" toggle.
  const RECENT_FINALS = 3
  const active = games.filter((g) => g.status !== 'final')
  const finals = games.filter((g) => g.status === 'final')
  const visibleGames = [...active, ...(showPast ? finals : finals.slice(0, RECENT_FINALS))]

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
        {visibleGames.map((game) => {
          const away = teams.find((t) => t.id === game.away_team_id)
          const home = teams.find((t) => t.id === game.home_team_id)
          const isFinal = game.status === 'final'
          if (editId === game.id) {
            return (
              <li key={game.id} className="border-2 border-ink bg-cream-off p-4">
                <div className="mb-3 grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                  <TeamSelect label="Away" value={eAway} onChange={setEAway} teams={teams} favorites={favorites} />
                  <button
                    onClick={() => {
                      const a = eAway
                      setEAway(eHome)
                      setEHome(a)
                    }}
                    title="Swap home/away"
                    className="mb-1.5 border-2 border-ink px-2 py-2 font-display text-ink"
                  >
                    ⇄
                  </button>
                  <TeamSelect label="Home" value={eHome} onChange={setEHome} teams={teams} favorites={favorites} accent />
                </div>
                <label className="mb-3 block">
                  <span className="mb-1 block font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">
                    Date & time (optional)
                  </span>
                  <div className="flex w-full items-center border-2 border-ink bg-white px-3 py-2 focus-within:border-board-green">
                    <input
                      type="datetime-local"
                      value={eWhen}
                      onChange={(e) => setEWhen(e.target.value)}
                      className="min-w-0 flex-1 bg-transparent font-data text-ink outline-none"
                    />
                  </div>
                </label>
                <label className="mb-3 block">
                  <span className="mb-1 block font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">
                    Location (optional)
                  </span>
                  <input
                    value={eLoc}
                    onChange={(e) => setELoc(e.target.value)}
                    placeholder="e.g. Cedar Park · Field 2"
                    className="w-full border-2 border-ink bg-white px-3 py-2 font-data outline-none focus:border-board-green"
                  />
                </label>
                <div className="flex gap-2">
                  <button onClick={() => saveEdit(game)} className="bg-gold px-4 py-2 font-display text-sm text-ink">
                    Save
                  </button>
                  <button
                    onClick={() => setEditId(null)}
                    className="border-2 border-ink px-4 py-2 font-display text-sm text-ink"
                  >
                    Cancel
                  </button>
                </div>
              </li>
            )
          }
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
                <div className="flex flex-wrap gap-2">
                  {isFinal ? (
                    // A finished game: the full final view (recap + box + stats +
                    // plays tabs) lives at /watch; show it in-app via the iframe
                    // modal (opening it directly gets trapped in the iOS PWA).
                    <button
                      onClick={() => setWatchGame(game)}
                      className="bg-board-green px-4 py-2 font-display text-sm text-cream"
                    >
                      Game summary ▸
                    </button>
                  ) : (
                    <>
                      <Link
                        to={`/lineup/${game.id}`}
                        className="border-2 border-ink px-4 py-2 font-display text-sm text-ink"
                      >
                        Lineup
                      </Link>
                      {game.video_source !== 'none' && (
                        <button
                          onClick={() => setVideoGame(game)}
                          className="border-2 border-ink px-4 py-2 font-display text-sm text-ink"
                        >
                          Video
                        </button>
                      )}
                      <Link
                        to={`/score/${game.id}`}
                        className="bg-board-green px-4 py-2 font-display text-sm text-cream"
                      >
                        Score ▸
                      </Link>
                      <button
                        onClick={() => setShareGame(game)}
                        className="border-2 border-ink px-4 py-2 font-display text-sm text-ink"
                      >
                        Share
                      </button>
                      <button
                        onClick={() => setWatchGame(game)}
                        className="border-2 border-ink px-4 py-2 font-display text-sm text-ink"
                      >
                        Watch
                      </button>
                    </>
                  )}
                  {game.status === 'scheduled' && (
                    <button
                      onClick={() => startEdit(game)}
                      className="px-3 py-2 font-athletic text-sm font-bold uppercase tracking-wide text-ink/40 hover:text-ink"
                    >
                      Edit
                    </button>
                  )}
                  <button
                    onClick={() => deleteGame(game)}
                    title="Delete game"
                    className="px-3 py-2 font-athletic text-sm font-bold uppercase tracking-wide text-ink/40 hover:text-barn-red"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          )
        })}
        {games.length === 0 && teams.length >= 2 && !creating && (
          <EmptyHint>No games yet — tap “New Game” to schedule one.</EmptyHint>
        )}
      </ul>

      {finals.length > RECENT_FINALS && (
        <button
          onClick={() => setShowPast((v) => !v)}
          className="mt-3 w-full border-2 border-ink/30 py-2 font-athletic text-sm font-semibold uppercase tracking-wide text-muted-tan"
        >
          {showPast ? 'Hide past games' : `Show all past games (${finals.length})`}
        </button>
      )}

      {videoGame && (
        <VideoSetup game={videoGame} onClose={() => setVideoGame(null)} onSaved={() => onChange()} />
      )}

      {watchGame && (
        <LiveWatchModal
          gameId={watchGame.id}
          title={watchGame.status === 'final' ? 'Game Summary' : 'Live View'}
          // Match the body (iOS safe-area strips) to the viewer screen: scheduled
          // (navy Starting Soon) and final (navy summary) are navy; live is green.
          bodyBg={watchGame.status === 'live' ? '#15281b' : '#1A2A4A'}
          onClose={() => setWatchGame(null)}
        />
      )}

      {shareGame && (
        <ShareSheet
          url={`${window.location.origin}/watch/${shareGame.id}`}
          title={`${teams.find((t) => t.id === shareGame.away_team_id)?.name ?? 'Away'} at ${
            teams.find((t) => t.id === shareGame.home_team_id)?.name ?? 'Home'
          }`}
          onClose={() => setShareGame(null)}
        />
      )}
    </section>
  )
}

// In-app viewer for the scorer — embeds the public /watch page in an iframe so it
// stays inside the PWA (opening it directly gets trapped in the iOS shell). For a
// finished game /watch renders the full final view (recap + box + stats + plays).
function LiveWatchModal({
  gameId,
  title,
  bodyBg,
  onClose,
}: {
  gameId: string
  title: string
  bodyBg: string
  onClose: () => void
}) {
  // The Setup screen sets the body cream; while this viewer modal is open, match
  // the body to the viewer screen so the iOS safe-area strips don't show cream
  // (or a clashing color behind the navy Starting Soon cover).
  useEffect(() => {
    const prev = document.body.style.backgroundColor
    document.body.style.backgroundColor = bodyBg
    return () => {
      document.body.style.backgroundColor = prev
    }
  }, [bodyBg])

  return (
    <div className="fixed inset-0 z-40 flex flex-col" style={{ backgroundColor: bodyBg }}>
      <div className="flex shrink-0 items-center justify-between border-b-2 border-gold bg-ink px-4 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))]">
        <span className="font-display text-lg text-cream">{title}</span>
        <button onClick={onClose} className="font-athletic text-cream">
          Done
        </button>
      </div>
      <iframe
        src={`/watch/${gameId}`}
        title={title}
        allow="autoplay; encrypted-media; picture-in-picture; camera; microphone"
        className="min-h-0 w-full flex-1 border-0 bg-night-green"
      />
    </div>
  )
}

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
  const [location, setLocation] = useState('')
  const [video, setVideo] = useState<VideoSource>('none')
  const [ytUrl, setYtUrl] = useState('')
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
      {/* appearance-none so iOS uses our square styling on BOTH (a light-bg select
          otherwise keeps iOS's native rounded corners); caret added back manually. */}
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full appearance-none rounded-none border-2 px-3 py-2 pr-8 font-display outline-none ${
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
        <span
          aria-hidden
          className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs ${
            accent ? 'text-gold' : 'text-ink'
          }`}
        >
          ▾
        </span>
      </div>
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

  async function deleteTeam(team: Team) {
    // A team can't be deleted while a game references it (FK), so guide the user.
    const { count } = await supabase
      .from('games')
      .select('id', { count: 'exact', head: true })
      .or(`away_team_id.eq.${team.id},home_team_id.eq.${team.id}`)
    if (count && count > 0) {
      onError(`Can’t delete ${team.name} — it’s in ${count} game${count === 1 ? '' : 's'}. Delete those games first.`)
      return
    }
    if (!window.confirm(`Delete ${team.name} and its whole roster? This can’t be undone.`)) return
    const { error } = await supabase.from('teams').delete().eq('id', team.id)
    if (error) return onError(error.message)
    if (selectedId === team.id) setSelectedId(null)
    onChange()
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
            onDelete={deleteTeam}
          />
        )}
        <TeamGroup
          title={favorites.length > 0 ? 'Other teams' : 'All teams'}
          teams={others}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onToggleFavorite={toggleFavorite}
          onDelete={deleteTeam}
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
  onDelete,
}: {
  title: string
  teams: Team[]
  selectedId: string | null
  onSelect: (id: string) => void
  onToggleFavorite: (t: Team) => void
  onDelete: (t: Team) => void
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
            <button
              onClick={() => onDelete(t)}
              title="Delete team"
              className="px-3 py-3 font-athletic text-sm font-bold text-ink/30 hover:text-barn-red"
            >
              Delete
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
  const [showMembers, setShowMembers] = useState(false)
  const [showStats, setShowStats] = useState(false)
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
        <div>
          <h3 className="font-display text-xl">{team.name}</h3>
          <p className="font-athletic text-xs uppercase tracking-wide text-muted-tan">
            {team.season ? `${team.season} · ` : ''}
            {players.length} player{players.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowStats(true)}
            className="border-2 border-ink px-3 py-2 font-athletic text-xs font-bold uppercase tracking-wide text-ink hover:bg-ink hover:text-cream"
          >
            Stats
          </button>
          <button
            onClick={() => setShowMembers(true)}
            className="border-2 border-ink px-3 py-2 font-athletic text-xs font-bold uppercase tracking-wide text-ink hover:bg-ink hover:text-cream"
          >
            Members
          </button>
          <CodeEditor team={team} onError={onError} />
        </div>
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

      {showMembers && <TeamMembers team={team} onClose={() => setShowMembers(false)} />}
      {showStats && <SeasonStats team={team} onClose={() => setShowStats(false)} />}
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
                  className="w-full border-2 border-ink bg-white px-0.5 py-1.5 text-center font-data text-sm outline-none focus:border-board-green"
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

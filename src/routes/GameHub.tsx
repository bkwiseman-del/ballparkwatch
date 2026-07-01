import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { HeaderWordmark } from '@/components/Logo'
import { GameDetailsForm } from '@/routes/Setup'
import { VideoSetup } from '@/components/VideoSetup'
import { ShareSheet } from '@/components/ShareSheet'
import { useAuth } from '@/auth/AuthProvider'
import type { Game, Team } from '@/lib/types'

type Tab = 'details' | 'lineup' | 'video' | 'share'
const TABS: { id: Tab; label: string }[] = [
  { id: 'details', label: 'Details' },
  { id: 'lineup', label: 'Lineup' },
  { id: 'video', label: 'Video' },
  { id: 'share', label: 'Share' },
]

// One page per game, tabbed — everything you set up for a game lives here, so a game
// row only needs two buttons (Score + Setup). Mirrors the team hub.
export default function GameHub() {
  const { user } = useAuth()
  const { gameId } = useParams()
  const navigate = useNavigate()
  const [game, setGame] = useState<Game | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [tab, setTab] = useState<Tab>('details')
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [showVideo, setShowVideo] = useState(false)
  const [showShare, setShowShare] = useState(false)

  const load = useCallback(() => {
    if (!gameId) return
    supabase
      .from('games')
      .select('*')
      .eq('id', gameId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) return setError(error.message)
        if (!data) return setMissing(true)
        setGame(data as Game)
      })
    supabase
      .from('teams')
      .select('*')
      .order('is_favorite', { ascending: false })
      .order('name')
      .then(({ data }) => setTeams((data ?? []) as Team[]))
  }, [gameId])
  useEffect(load, [load])

  useEffect(() => {
    const prev = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#F4ECD8'
    return () => {
      document.body.style.backgroundColor = prev
    }
  }, [])

  const nameOf = (id: string) => teams.find((t) => t.id === id)?.name ?? 'TBD'
  const isFinal = game?.status === 'final'
  const watchUrl = game ? `${window.location.origin}/watch/${game.id}` : ''

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-cream text-ink">
      <header className="flex shrink-0 items-center justify-between border-b-2 border-gold bg-ink px-4 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] text-cream">
        <HeaderWordmark />
        <Link to="/setup" className="font-athletic text-sm uppercase tracking-wide text-gold hover:underline">
          ‹ Dashboard
        </Link>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-lg px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4">
          {missing ? (
            <p className="mt-8 text-center font-data text-muted-tan">Game not found.</p>
          ) : !game ? (
            <p className="mt-8 text-center font-data text-muted-tan">Loading…</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="font-display text-2xl leading-tight">
                  {nameOf(game.away_team_id)} <span className="text-muted-tan">at</span> {nameOf(game.home_team_id)}
                </h1>
                <Link
                  to={isFinal ? `/watch/${game.id}` : `/score/${game.id}`}
                  className="bg-board-green px-5 py-2.5 font-display text-cream"
                >
                  {isFinal ? 'Game summary ▸' : game.status === 'live' ? 'Resume scoring ▸' : 'Score ▸'}
                </Link>
              </div>

              {/* Tabs */}
              <div className="mt-4 flex gap-1 overflow-x-auto border-b-2 border-ink">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`whitespace-nowrap px-4 py-2 font-athletic text-sm font-semibold uppercase tracking-[.1em] ${
                      tab === t.id ? 'bg-ink text-cream' : 'text-ink/60 hover:text-ink'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {error && (
                <p className="mt-3 border-2 border-barn-red bg-barn-red/10 px-3 py-2 font-data text-sm text-barn-red">
                  {error}
                </p>
              )}

              <div className="mt-5">
                {tab === 'details' && user && (
                  <GameDetailsForm
                    game={game}
                    teams={teams}
                    userId={user.id}
                    onError={setError}
                    onSaved={load}
                    onDeleted={() => navigate('/setup')}
                    onVideo={() => setTab('video')}
                  />
                )}

                {tab === 'lineup' && (
                  <div className="text-center">
                    <p className="mb-3 font-data text-sm text-muted-tan">
                      Set the batting order and defensive positions for both teams.
                    </p>
                    <Link
                      to={`/lineup/${game.id}`}
                      className="inline-block bg-gold px-6 py-3 font-display text-ink"
                    >
                      Open lineup editor ▸
                    </Link>
                  </div>
                )}

                {tab === 'video' && (
                  <div className="text-center">
                    <p className="mb-3 font-data text-sm text-muted-tan">
                      Choose how this game is filmed — another phone, an external camera, or stats-only.
                    </p>
                    <button
                      onClick={() => setShowVideo(true)}
                      className="bg-gold px-6 py-3 font-display text-ink"
                    >
                      Video &amp; camera ▸
                    </button>
                  </div>
                )}

                {tab === 'share' && (
                  <div>
                    <p className="mb-1 font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">
                      Watch link
                    </p>
                    <p className="mb-3 break-all border-2 border-ink bg-white px-3 py-2 font-data text-sm">{watchUrl}</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowShare(true)}
                        className="flex-1 bg-gold py-3 font-display text-ink"
                      >
                        Share / QR ▸
                      </button>
                      <Link
                        to={`/watch/${game.id}`}
                        className="border-2 border-ink px-5 py-3 font-display text-ink"
                      >
                        Watch
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {game && showVideo && (
        <VideoSetup game={game} onClose={() => setShowVideo(false)} onSaved={load} />
      )}
      {game && showShare && (
        <ShareSheet url={watchUrl} title={`${nameOf(game.away_team_id)} at ${nameOf(game.home_team_id)}`} onClose={() => setShowShare(false)} />
      )}
    </div>
  )
}

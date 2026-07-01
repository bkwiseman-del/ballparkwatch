import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { HeaderWordmark } from '@/components/Logo'
import { Roster, GamesView } from '@/routes/Setup'
import { SeasonStats } from '@/components/SeasonStats'
import { TeamMembers } from '@/components/TeamMembers'
import { TeamDetails } from '@/components/TeamDetails'
import { TeamEvents } from '@/components/TeamEvents'
import { TeamPosts } from '@/components/TeamPosts'
import { useAuth } from '@/auth/AuthProvider'
import type { Game, Team } from '@/lib/types'

type Tab = 'roster' | 'schedule' | 'news' | 'stats' | 'members' | 'settings'
const TABS: { id: Tab; label: string }[] = [
  { id: 'schedule', label: 'Schedule' },
  { id: 'news', label: 'News' },
  { id: 'roster', label: 'Roster' },
  { id: 'stats', label: 'Stats' },
  { id: 'members', label: 'Members' },
  { id: 'settings', label: 'Settings' },
]

// The team hub — one page per team, tabbed (plan §8). Replaces the modal pile on the
// Setup screen; it's also the owner-edit mirror of the public /t/<slug> page.
export default function TeamHub() {
  const { user } = useAuth()
  const { id } = useParams()
  const [team, setTeam] = useState<Team | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [games, setGames] = useState<Game[]>([])
  const [tab, setTab] = useState<Tab>('schedule')
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [canManage, setCanManage] = useState(false)
  const [isStaff, setIsStaff] = useState(false)

  const load = useCallback(() => {
    if (!id) return
    supabase
      .from('teams')
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) return setError(error.message)
        if (!data) return setMissing(true)
        setTeam(data as Team)
      })
    // All teams (for the opponent picker + name lookup) and all games (GamesView
    // filters to this team via teamId).
    supabase
      .from('teams')
      .select('*')
      .order('is_favorite', { ascending: false })
      .order('name')
      .then(({ data }) => setTeams((data ?? []) as Team[]))
    supabase
      .from('games')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => setGames((data ?? []) as Game[]))
    // My role on this team → gate management (add practice, edit members, etc).
    if (user)
      supabase
        .from('team_members')
        .select('role')
        .eq('team_id', id)
        .eq('user_id', user.id)
        .maybeSingle()
        .then(({ data }) => {
          setCanManage(data?.role === 'owner' || data?.role === 'admin' || data?.role === 'coach')
          setIsStaff(!!data && data.role !== 'family')
        })
  }, [id, user])
  useEffect(load, [load])

  // Cream body so the iOS safe-area strips aren't dark behind this cream screen.
  useEffect(() => {
    const prev = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#F4ECD8'
    return () => {
      document.body.style.backgroundColor = prev
    }
  }, [])

  const canViewPublic = team && team.slug && team.discovery !== 'private'

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-cream text-ink">
      <header className="flex shrink-0 items-center justify-between border-b-2 border-gold bg-ink px-4 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] text-cream">
        <HeaderWordmark />
        <Link to="/setup" className="font-athletic text-sm uppercase tracking-wide text-gold hover:underline">
          ‹ Teams
        </Link>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-3xl px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4">
          {missing ? (
            <p className="mt-8 text-center font-data text-muted-tan">Team not found.</p>
          ) : !team ? (
            <p className="mt-8 text-center font-data text-muted-tan">Loading…</p>
          ) : (
            <>
              {/* Title row */}
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h1 className="font-display text-2xl leading-tight">{team.name}</h1>
                  <p className="font-athletic text-xs uppercase tracking-wide text-muted-tan">
                    {[team.age_group, team.season, [team.city, team.state].filter(Boolean).join(', ')]
                      .filter(Boolean)
                      .join(' · ') || 'No details yet'}
                  </p>
                </div>
                {canViewPublic && (
                  <a
                    href={`/t/${team.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-athletic text-xs font-bold uppercase tracking-wide text-board-green underline"
                  >
                    View public page ↗
                  </a>
                )}
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
                {tab === 'schedule' &&
                  (user ? (
                    <>
                      <GamesView
                        teams={teams}
                        games={games}
                        userId={user.id}
                        teamId={team.id}
                        heading={null}
                        onChange={load}
                        onError={setError}
                      />
                      <TeamEvents team={team} canManage={canManage} />
                    </>
                  ) : null)}
                {tab === 'news' && <TeamPosts team={team} canPost={isStaff} />}
                {tab === 'roster' && <Roster team={team} onError={setError} />}
                {tab === 'stats' && <SeasonStats team={team} />}
                {tab === 'members' && <TeamMembers team={team} />}
                {tab === 'settings' && <TeamDetails team={team} onSaved={load} />}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

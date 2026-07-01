import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { HeaderWordmark } from '@/components/Logo'
import { Select } from '@/components/Select'
import { useAuth } from '@/auth/AuthProvider'
import type { Team } from '@/lib/types'

type FeedItem = {
  type: 'game' | 'practice' | 'event'
  id: string
  starts_at: string | null
  status?: 'scheduled' | 'live' | 'final'
  location?: string | null
  slug?: string | null
  home?: string
  away?: string
  title?: string | null
  notes?: string | null
  recording_started_at?: string | null
  going_count?: number
}
type RsvpStatus = 'going' | 'maybe' | 'not'
type LinkedPlayer = { player_id: string; name: string; jersey: string | null }
type RosterPlayer = { id: string; name: string; jersey_number: string | null }
type FollowedTeam = {
  team: Team
  role: string
  feed: FeedItem[]
  myPlayers: LinkedPlayer[]
  roster: RosterPlayer[]
  rsvps: Record<string, RsvpStatus> // `${target_id}:${player_id}` -> status
}

// Load everything one followed team needs: the upcoming feed, which players are MINE
// (member_players), the roster (to link a kid), and my kids' RSVP statuses.
async function loadOne(team: Team, role: string, userId: string): Promise<FollowedTeam> {
  const teamId = team.id
  const [feedRes, mpRes, rosterRes] = await Promise.all([
    supabase.rpc('team_upcoming', { p_team_id: teamId }),
    supabase.from('member_players').select('player_id, players(name, jersey_number)').eq('team_id', teamId).eq('user_id', userId),
    supabase.from('players').select('id, name, jersey_number').eq('team_id', teamId).is('archived_at', null).order('jersey_number'),
  ])
  const myPlayers: LinkedPlayer[] = ((mpRes.data ?? []) as Array<{ player_id: string; players: { name?: string; jersey_number?: string } | null }>).map(
    (m) => ({ player_id: m.player_id, name: m.players?.name ?? '—', jersey: m.players?.jersey_number ?? null }),
  )
  const rsvps: Record<string, RsvpStatus> = {}
  const myIds = myPlayers.map((p) => p.player_id)
  if (myIds.length) {
    const { data: rv } = await supabase.from('rsvps').select('target_id, player_id, status').eq('team_id', teamId).in('player_id', myIds)
    for (const x of (rv ?? []) as Array<{ target_id: string; player_id: string; status: RsvpStatus }>) {
      rsvps[`${x.target_id}:${x.player_id}`] = x.status
    }
  }
  return { team, role, feed: (feedRes.data ?? []) as FeedItem[], myPlayers, roster: (rosterRes.data ?? []) as RosterPlayer[], rsvps }
}

// The family / follower home. Read-only for games/scores; families link their kid(s)
// and RSVP each one for games and practices.
export default function Following() {
  const { user } = useAuth()
  const [teams, setTeams] = useState<FollowedTeam[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!user) return
    const { data: mems } = await supabase.from('team_members').select('role, team:teams(*)').eq('user_id', user.id)
    const rows = (mems ?? []) as unknown as { role: string; team: Team }[]
    const data = await Promise.all(rows.filter((r) => r.team).map((r) => loadOne(r.team, r.role, user.id)))
    data.sort((a, b) => rank(a) - rank(b))
    setTeams(data)
    setLoading(false)
  }, [user])
  useEffect(() => {
    load()
  }, [load])

  // Re-pull one team after an RSVP or a player link so counts + statuses update.
  const refreshTeam = useCallback(
    async (teamId: string) => {
      if (!user) return
      const cur = teams.find((t) => t.team.id === teamId)
      if (!cur) return
      const fresh = await loadOne(cur.team, cur.role, user.id)
      setTeams((prev) => prev.map((t) => (t.team.id === teamId ? fresh : t)))
    },
    [user, teams],
  )

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
        <span className="font-athletic text-xs uppercase tracking-[.14em] text-muted-green">Following</span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-2xl px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5">
          {loading ? (
            <p className="mt-8 text-center font-data text-muted-tan">Loading…</p>
          ) : teams.length === 0 ? (
            <div className="mt-10 text-center">
              <p className="font-display text-xl">You’re not following any teams yet.</p>
              <p className="mt-2 font-data text-sm text-muted-tan">
                When a coach invites you, the team shows up here with live games, schedule, and replays.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {teams.map((t) => (
                <TeamCard key={t.team.id} data={t} userId={user?.id ?? ''} onRefresh={refreshTeam} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function rank(t: FollowedTeam): number {
  if (t.feed.some((i) => i.type === 'game' && i.status === 'live')) return 0
  const next = nextUpcoming(t.feed)
  if (next?.starts_at) return new Date(next.starts_at).getTime()
  return Number.MAX_SAFE_INTEGER
}
function upcomingItems(feed: FeedItem[]): FeedItem[] {
  const cutoff = Date.now() - 3 * 3600 * 1000
  return feed
    .filter((i) => i.starts_at && new Date(i.starts_at).getTime() >= cutoff && i.status !== 'final')
    .sort((a, b) => new Date(a.starts_at!).getTime() - new Date(b.starts_at!).getTime())
}
function nextUpcoming(feed: FeedItem[]): FeedItem | null {
  return upcomingItems(feed)[0] ?? null
}

function TeamCard({
  data,
  userId,
  onRefresh,
}: {
  data: FollowedTeam
  userId: string
  onRefresh: (teamId: string) => void | Promise<void>
}) {
  const { team, feed, myPlayers, roster, rsvps } = data
  const [adding, setAdding] = useState(false)
  const live = feed.find((i) => i.type === 'game' && i.status === 'live')
  const upcoming = upcomingItems(feed)
  const next = upcoming[0] ?? null
  const rest = upcoming.slice(1, 5)
  const replays = feed
    .filter((i) => i.type === 'game' && i.recording_started_at)
    .sort((a, b) => new Date(b.starts_at ?? 0).getTime() - new Date(a.starts_at ?? 0).getTime())
    .slice(0, 4)
  const linkedIds = new Set(myPlayers.map((p) => p.player_id))
  const addable = roster.filter((p) => !linkedIds.has(p.id))

  async function setRsvp(item: FeedItem, playerId: string, status: RsvpStatus) {
    const tt = item.type === 'game' ? 'game' : 'event'
    if (rsvps[`${item.id}:${playerId}`] === status) {
      await supabase.from('rsvps').delete().eq('target_type', tt).eq('target_id', item.id).eq('player_id', playerId)
    } else {
      await supabase.from('rsvps').upsert({ team_id: team.id, target_type: tt, target_id: item.id, player_id: playerId, status })
    }
    await onRefresh(team.id)
  }
  async function linkPlayer(playerId: string) {
    if (!playerId) return
    await supabase.from('member_players').insert({ team_id: team.id, user_id: userId, player_id: playerId })
    setAdding(false)
    await onRefresh(team.id)
  }
  async function unlinkPlayer(playerId: string) {
    await supabase.from('member_players').delete().eq('user_id', userId).eq('player_id', playerId)
    await onRefresh(team.id)
  }

  return (
    <section className="border-2 border-ink bg-cream-off">
      <div className="flex items-center justify-between border-b-2 border-ink bg-white px-4 py-2.5">
        <h2 className="font-display text-lg">{team.name}</h2>
        {data.role === 'family' && (
          <span className="font-athletic text-[10px] uppercase tracking-wide text-muted-tan">Following</span>
        )}
      </div>

      {/* Your players — link a kid so you can RSVP for them. */}
      <div className="border-b-2 border-ink px-4 py-2.5">
        <p className="mb-1 font-athletic text-[10px] font-semibold uppercase tracking-[.14em] text-muted-tan">
          Your player{myPlayers.length === 1 ? '' : 's'}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {myPlayers.map((p) => (
            <span key={p.player_id} className="flex items-center gap-1.5 border-2 border-ink bg-white px-2 py-1">
              <span className="font-data text-sm text-ink">
                {p.jersey ? <b className="text-barn-red">{p.jersey} </b> : ''}
                {p.name}
              </span>
              <button onClick={() => unlinkPlayer(p.player_id)} className="text-ink/40 hover:text-barn-red" title="Remove">
                ✕
              </button>
            </span>
          ))}
          {addable.length > 0 &&
            (adding ? (
              <span className="flex items-center gap-1.5">
                <Select value="" onChange={linkPlayer} className="min-w-[10rem]">
                  <option value="">Pick your player…</option>
                  {addable.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.jersey_number ? `#${p.jersey_number} ` : ''}
                      {p.name}
                    </option>
                  ))}
                </Select>
                <button onClick={() => setAdding(false)} className="font-athletic text-xs uppercase text-ink/50">
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="border-2 border-dashed border-ink/50 bg-white px-2.5 py-1 font-athletic text-xs font-bold uppercase tracking-wide text-board-green"
              >
                {myPlayers.length === 0 ? '+ Add your player' : '+ Add'}
              </button>
            ))}
        </div>
        {myPlayers.length === 0 && (
          <p className="mt-1 font-data text-xs text-muted-tan">Add your player to RSVP for games and practices.</p>
        )}
      </div>

      {/* Live now */}
      {live && (
        <Link
          to={`/watch/${live.id}`}
          className="flex items-center justify-between gap-3 border-b-2 border-ink bg-barn-red px-4 py-3 text-cream"
        >
          <div className="min-w-0">
            <p className="font-athletic text-xs font-bold uppercase tracking-[.14em]">● Live now</p>
            <p className="truncate font-display">
              {live.away} @ {live.home}
            </p>
          </div>
          <span className="shrink-0 bg-cream px-3 py-1.5 font-display text-sm text-barn-red">Watch ▸</span>
        </Link>
      )}

      {/* Next up + upcoming */}
      <div className="px-4 py-3">
        <p className="font-athletic text-[10px] font-semibold uppercase tracking-[.14em] text-muted-tan">Next up</p>
        {next ? (
          <ItemBlock item={next} myPlayers={myPlayers} rsvps={rsvps} onPick={setRsvp} big />
        ) : (
          <p className="mt-1 font-data text-sm text-muted-tan">Nothing scheduled yet.</p>
        )}

        {rest.length > 0 && (
          <ul className="mt-3 flex flex-col divide-y divide-ink/12 border-t border-ink/12">
            {rest.map((i) => (
              <li key={i.id} className="pt-3 first:pt-3">
                <ItemBlock item={i} myPlayers={myPlayers} rsvps={rsvps} onPick={setRsvp} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Replays */}
      {replays.length > 0 && (
        <div className="border-t-2 border-ink px-4 py-3">
          <p className="mb-1.5 font-athletic text-[10px] font-semibold uppercase tracking-[.14em] text-muted-tan">Replays</p>
          <ul className="flex flex-col gap-1">
            {replays.map((r) => (
              <li key={r.id}>
                <Link to={`/watch/${r.id}`} className="flex items-center justify-between gap-2 py-0.5">
                  <span className="min-w-0 truncate font-data text-sm text-ink">
                    {r.away} @ {r.home}
                    <span className="text-muted-tan"> · {r.starts_at ? fmtDate(r.starts_at) : ''}</span>
                  </span>
                  <span className="shrink-0 font-athletic text-xs font-bold uppercase tracking-wide text-board-green">
                    Replay ▸
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function ItemBlock({
  item,
  myPlayers,
  rsvps,
  onPick,
  big = false,
}: {
  item: FeedItem
  myPlayers: LinkedPlayer[]
  rsvps: Record<string, RsvpStatus>
  onPick: (item: FeedItem, playerId: string, status: RsvpStatus) => void
  big?: boolean
}) {
  return (
    <div className={big ? 'mt-1' : ''}>
      <p className={big ? 'font-display text-base' : 'font-data text-sm text-ink'}>
        {item.type !== 'game' && <KindTag kind={item.type} />}
        {itemTitle(item)}
      </p>
      <p className="font-data text-xs text-muted-tan">
        {item.starts_at ? fmtWhen(item.starts_at) : 'Time TBD'}
        {item.location ? ` · ${item.location}` : ''}
      </p>
      {item.notes && <p className="mt-0.5 font-data text-xs text-ink/70">{item.notes}</p>}

      {/* One RSVP row per kid. */}
      {myPlayers.length > 0 ? (
        <div className="mt-1.5 flex flex-col gap-1.5">
          {myPlayers.map((p) => (
            <KidRsvp
              key={p.player_id}
              name={p.name}
              multi={myPlayers.length > 1}
              status={rsvps[`${item.id}:${p.player_id}`]}
              onPick={(s) => onPick(item, p.player_id, s)}
            />
          ))}
          {typeof item.going_count === 'number' && item.going_count > 0 && (
            <span className="font-data text-xs text-muted-tan">{item.going_count} going</span>
          )}
        </div>
      ) : (
        typeof item.going_count === 'number' &&
        item.going_count > 0 && <p className="mt-1 font-data text-xs text-muted-tan">{item.going_count} going</p>
      )}
    </div>
  )
}

const RSVP_OPTS: { value: RsvpStatus; label: string }[] = [
  { value: 'going', label: 'Going' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'not', label: 'Can’t' },
]
// RSVP buttons for one kid on one game/practice. Tap the active one to clear.
function KidRsvp({
  name,
  status,
  onPick,
  multi,
}: {
  name: string
  status?: RsvpStatus
  onPick: (s: RsvpStatus) => void
  multi: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {multi && <span className="mr-0.5 w-16 shrink-0 truncate font-data text-xs text-ink/70">{name}</span>}
      {RSVP_OPTS.map((o) => {
        const on = status === o.value
        const tone = on
          ? o.value === 'not'
            ? 'border-barn-red bg-barn-red text-cream'
            : 'border-board-green bg-board-green text-cream'
          : 'border-ink/30 bg-white text-ink'
        return (
          <button
            key={o.value}
            onClick={() => onPick(o.value)}
            className={`border-2 px-2.5 py-0.5 font-athletic text-xs font-bold uppercase tracking-wide ${tone}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function KindTag({ kind }: { kind: 'practice' | 'event' }) {
  return (
    <span className="mr-1.5 bg-ink/10 px-1.5 py-0.5 font-athletic text-[9px] font-bold uppercase tracking-wide text-ink/60">
      {kind}
    </span>
  )
}
function itemTitle(i: FeedItem): string {
  if (i.type === 'game') return `${i.away} @ ${i.home}`
  if (i.type === 'practice') return i.title || 'Practice'
  return i.title || 'Team event'
}
function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

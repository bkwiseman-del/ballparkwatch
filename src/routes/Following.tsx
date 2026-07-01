import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { HeaderWordmark } from '@/components/Logo'
import { useAuth } from '@/auth/AuthProvider'
import type { Team } from '@/lib/types'

// One item from bpw.team_upcoming(): a game or a practice/event.
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
  my_rsvp?: RsvpStatus | null
  going_count?: number
}
type RsvpStatus = 'going' | 'maybe' | 'not'
type FollowedTeam = { team: Team; role: string; feed: FeedItem[] }

// The family / follower home: the teams you follow, what's live or next, and replays.
// Read-only — no scoring, no roster edits. This is the front door for a 'family' member
// (and any operator who also follows other teams).
export default function Following() {
  const { user } = useAuth()
  const [teams, setTeams] = useState<FollowedTeam[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!user) return
    // Every team I'm a member of (any role), with my role.
    const { data: mems } = await supabase
      .from('team_members')
      .select('role, team:teams(*)')
      .eq('user_id', user.id)
    const rows = (mems ?? []) as unknown as { role: string; team: Team }[]
    const withFeeds = await Promise.all(
      rows
        .filter((r) => r.team)
        .map(async (r) => {
          const { data } = await supabase.rpc('team_upcoming', { p_team_id: r.team.id })
          return { team: r.team, role: r.role, feed: (data ?? []) as FeedItem[] }
        }),
    )
    // Live games first, then teams with something coming up soonest.
    withFeeds.sort((a, b) => rank(a) - rank(b))
    setTeams(withFeeds)
    setLoading(false)
  }, [user])
  useEffect(() => {
    load()
  }, [load])

  // Re-pull one team's feed after an RSVP so my status + the going count update.
  const refreshTeam = useCallback(async (teamId: string) => {
    const { data } = await supabase.rpc('team_upcoming', { p_team_id: teamId })
    setTeams((prev) => prev.map((t) => (t.team.id === teamId ? { ...t, feed: (data ?? []) as FeedItem[] } : t)))
  }, [])

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
                <TeamCard key={t.team.id} data={t} userId={user?.id ?? ''} onRsvp={refreshTeam} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Lower rank sorts first: live now, then soonest upcoming, then the rest.
function rank(t: FollowedTeam): number {
  if (t.feed.some((i) => i.type === 'game' && i.status === 'live')) return 0
  const next = nextUpcoming(t.feed)
  if (next?.starts_at) return new Date(next.starts_at).getTime()
  return Number.MAX_SAFE_INTEGER
}

// Future (and just-started) games + practices, soonest first.
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
  onRsvp,
}: {
  data: FollowedTeam
  userId: string
  onRsvp: (teamId: string) => void | Promise<void>
}) {
  const { team, feed } = data
  const live = feed.find((i) => i.type === 'game' && i.status === 'live')
  const upcoming = upcomingItems(feed)
  const next = upcoming[0] ?? null
  const rest = upcoming.slice(1, 5)

  async function rsvp(item: FeedItem, status: RsvpStatus) {
    if (!userId) return
    // Tap the active choice again to clear it.
    if (item.my_rsvp === status) {
      await supabase
        .from('rsvps')
        .delete()
        .eq('user_id', userId)
        .eq('target_type', item.type === 'game' ? 'game' : 'event')
        .eq('target_id', item.id)
    } else {
      await supabase.from('rsvps').upsert({
        user_id: userId,
        team_id: team.id,
        target_type: item.type === 'game' ? 'game' : 'event',
        target_id: item.id,
        status,
      })
    }
    await onRsvp(team.id)
  }

  const replays = feed
    .filter((i) => i.type === 'game' && i.recording_started_at)
    .sort((a, b) => new Date(b.starts_at ?? 0).getTime() - new Date(a.starts_at ?? 0).getTime())
    .slice(0, 4)

  return (
    <section className="border-2 border-ink bg-cream-off">
      <div className="flex items-center justify-between border-b-2 border-ink bg-white px-4 py-2.5">
        <h2 className="font-display text-lg">{team.name}</h2>
        {data.role === 'family' && (
          <span className="font-athletic text-[10px] uppercase tracking-wide text-muted-tan">Following</span>
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

      {/* Next up */}
      <div className="px-4 py-3">
        <p className="font-athletic text-[10px] font-semibold uppercase tracking-[.14em] text-muted-tan">Next up</p>
        {next ? (
          <div className="mt-1">
            <p className="font-display text-base">
              {next.type !== 'game' && <KindTag kind={next.type} />}
              {itemTitle(next)}
            </p>
            <p className="font-data text-xs text-muted-tan">
              {next.starts_at ? fmtWhen(next.starts_at) : 'Time TBD'}
              {next.location ? ` · ${next.location}` : ''}
            </p>
            {next.notes && <p className="mt-1 font-data text-sm text-ink/80">{next.notes}</p>}
            <RsvpBar item={next} onPick={(s) => rsvp(next, s)} />
          </div>
        ) : (
          <p className="mt-1 font-data text-sm text-muted-tan">Nothing scheduled yet.</p>
        )}

        {/* Everything else coming up — practices carry their location + notes too. */}
        {rest.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2 border-t border-ink/12 pt-3">
            {rest.map((i) => (
              <li key={i.id} className="flex gap-3">
                <span className="w-12 shrink-0 font-data text-xs text-muted-tan">
                  {i.starts_at ? fmtDate(i.starts_at) : 'TBD'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-data text-sm text-ink">
                    {i.type !== 'game' && <KindTag kind={i.type} />}
                    {itemTitle(i)}
                  </p>
                  <p className="font-data text-xs text-muted-tan">
                    {i.starts_at ? fmtTime(i.starts_at) : ''}
                    {i.location ? ` · ${i.location}` : ''}
                  </p>
                  {i.notes && <p className="mt-0.5 font-data text-xs text-ink/70">{i.notes}</p>}
                  <RsvpBar item={i} onPick={(s) => rsvp(i, s)} compact />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Replays */}
      {replays.length > 0 && (
        <div className="border-t-2 border-ink px-4 py-3">
          <p className="mb-1.5 font-athletic text-[10px] font-semibold uppercase tracking-[.14em] text-muted-tan">
            Replays
          </p>
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

const RSVP_OPTS: { value: RsvpStatus; label: string }[] = [
  { value: 'going', label: 'Going' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'not', label: 'Can’t' },
]
// Going / Maybe / Can't for a game or practice, with a live "N going" count. Tapping
// the active choice again clears it. `compact` for the smaller rows in the list.
function RsvpBar({
  item,
  onPick,
  compact = false,
}: {
  item: FeedItem
  onPick: (s: RsvpStatus) => void
  compact?: boolean
}) {
  const count = item.going_count ?? 0
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${compact ? 'mt-1.5' : 'mt-2'}`}>
      {RSVP_OPTS.map((o) => {
        const on = item.my_rsvp === o.value
        const tone = on
          ? o.value === 'not'
            ? 'border-barn-red bg-barn-red text-cream'
            : 'border-board-green bg-board-green text-cream'
          : 'border-ink/30 bg-white text-ink'
        return (
          <button
            key={o.value}
            onClick={() => onPick(o.value)}
            className={`border-2 px-2.5 font-athletic text-xs font-bold uppercase tracking-wide ${
              compact ? 'py-0.5' : 'py-1'
            } ${tone}`}
          >
            {o.label}
          </button>
        )
      })}
      {count > 0 && (
        <span className="ml-0.5 font-data text-xs text-muted-tan">
          {count} going
        </span>
      )}
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
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
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

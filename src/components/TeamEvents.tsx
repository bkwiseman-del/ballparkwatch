import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Select, fieldClass } from '@/components/Select'
import type { Team, TeamEvent } from '@/lib/types'

// Practices + non-game calendar items for a team. Staff add/edit; every member
// (incl. family) can see them here and in their following feed. Games are handled
// by GamesView — this is everything else on the calendar.
export function TeamEvents({ team, canManage }: { team: Team; canManage: boolean }) {
  const [events, setEvents] = useState<TeamEvent[]>([])
  const [going, setGoing] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<'practice' | 'event'>('practice')
  const [title, setTitle] = useState('')
  const [when, setWhen] = useState('')
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    // Show upcoming (and anything from the last few hours so a just-finished
    // practice doesn't vanish mid-day).
    const since = new Date(Date.now() - 3 * 3600 * 1000).toISOString()
    supabase
      .from('team_events')
      .select('*')
      .eq('team_id', team.id)
      .gte('starts_at', since)
      .order('starts_at')
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setEvents((data ?? []) as TeamEvent[])
      })
    // Live "going" counts per practice/event so coaches see who's coming.
    supabase
      .from('rsvps')
      .select('target_id')
      .eq('team_id', team.id)
      .eq('target_type', 'event')
      .eq('status', 'going')
      .then(({ data }) => {
        const c: Record<string, number> = {}
        for (const r of (data ?? []) as { target_id: string }[]) c[r.target_id] = (c[r.target_id] ?? 0) + 1
        setGoing(c)
      })
  }, [team.id])
  useEffect(load, [load])

  async function add() {
    if (!when) return setError('Pick a date and time.')
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('team_events').insert({
      team_id: team.id,
      kind,
      title: title.trim() || null,
      // datetime-local is a naive local string — convert to a real instant.
      starts_at: new Date(when).toISOString(),
      location: location.trim() || null,
      notes: notes.trim() || null,
    })
    setBusy(false)
    if (error) return setError(error.message)
    setTitle('')
    setWhen('')
    setLocation('')
    setNotes('')
    setAdding(false)
    load()
  }

  async function remove(ev: TeamEvent) {
    if (!window.confirm('Delete this from the schedule?')) return
    const { error } = await supabase.from('team_events').delete().eq('id', ev.id)
    if (error) setError(error.message)
    else load()
  }

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">
          Practices &amp; events
        </p>
        {canManage && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="font-athletic text-xs font-bold uppercase tracking-wide text-board-green"
          >
            + Add
          </button>
        )}
      </div>

      {error && (
        <p className="mb-2 border-2 border-barn-red bg-barn-red/10 px-3 py-2 font-data text-sm text-barn-red">{error}</p>
      )}

      {adding && (
        <div className="mb-3 border-2 border-ink bg-cream-off p-3">
          <div className="mb-2 grid grid-cols-2 gap-2">
            <Select value={kind} onChange={(v) => setKind(v as 'practice' | 'event')}>
              <option value="practice">Practice</option>
              <option value="event">Event</option>
            </Select>
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className={fieldClass}
            />
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={kind === 'practice' ? 'Title (optional, e.g. Batting practice)' : 'Title, e.g. Team dinner'}
            className={`${fieldClass} mb-2`}
          />
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Location (optional)"
            className={`${fieldClass} mb-2`}
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes for the team (optional)"
            rows={2}
            className={`${fieldClass} mb-2`}
          />
          <div className="flex gap-2">
            <button onClick={add} disabled={busy} className="flex-1 bg-gold py-2 font-display text-ink disabled:opacity-60">
              {busy ? 'Saving…' : 'Add to schedule'}
            </button>
            <button
              onClick={() => setAdding(false)}
              className="border-2 border-ink px-4 py-2 font-display text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <ul className="flex flex-col border-2 border-ink">
        {events.map((ev, i) => (
          <li
            key={ev.id}
            className={`flex items-start gap-3 bg-cream-off px-3 py-2.5 ${i > 0 ? 'border-t border-ink/12' : ''}`}
          >
            <div className="w-14 shrink-0 text-center">
              <div className="font-athletic text-[10px] font-bold uppercase tracking-wide text-barn-red">
                {ev.kind}
              </div>
              <div className="font-data text-xs text-ink">{fmtDate(ev.starts_at)}</div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm text-ink">
                {ev.title || (ev.kind === 'practice' ? 'Practice' : 'Team event')}
              </p>
              <p className="font-data text-xs text-muted-tan">
                {fmtTime(ev.starts_at)}
                {ev.location ? ` · ${ev.location}` : ''}
                {going[ev.id] ? ` · ${going[ev.id]} going` : ''}
              </p>
              {ev.notes && <p className="mt-0.5 font-data text-xs text-ink/70">{ev.notes}</p>}
            </div>
            {canManage && (
              <button
                onClick={() => remove(ev)}
                className="shrink-0 font-athletic text-xs font-bold uppercase tracking-wide text-ink/40 hover:text-barn-red"
              >
                ✕
              </button>
            )}
          </li>
        ))}
        {events.length === 0 && (
          <li className="px-3 py-3 font-data text-sm text-muted-tan">
            {canManage ? 'No practices scheduled — add one above.' : 'No practices scheduled.'}
          </li>
        )}
      </ul>
    </div>
  )
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

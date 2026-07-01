import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fieldClass } from '@/components/Select'
import type { Team } from '@/lib/types'

type Post = { id: string; body: string; author: string; created_at: string }

// Team announcements: staff post, all members (incl. family) read. One-way for now.
export function TeamPosts({ team, canPost }: { team: Team; canPost: boolean }) {
  const [posts, setPosts] = useState<Post[]>([])
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    supabase.rpc('team_posts_list', { p_team_id: team.id }).then(({ data, error }) => {
      if (error) setError(error.message)
      else setPosts((data ?? []) as Post[])
    })
  }, [team.id])
  useEffect(load, [load])

  async function post() {
    const text = body.trim()
    if (!text) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('team_posts').insert({ team_id: team.id, body: text })
    setBusy(false)
    if (error) return setError(error.message)
    // Notify the team (fire-and-forget — a push failure shouldn't block posting).
    supabase.functions.invoke('send-push', {
      body: { team_id: team.id, title: `${team.name} — announcement`, body: text.slice(0, 140), url: '/following' },
    })
    setBody('')
    load()
  }
  async function remove(p: Post) {
    if (!window.confirm('Delete this announcement?')) return
    const { error } = await supabase.from('team_posts').delete().eq('id', p.id)
    if (error) setError(error.message)
    else load()
  }

  return (
    <div className="mx-auto max-w-lg">
      {error && (
        <p className="mb-3 border-2 border-barn-red bg-barn-red/10 px-3 py-2 font-data text-sm text-barn-red">{error}</p>
      )}

      {canPost && (
        <div className="mb-4 border-2 border-ink bg-cream-off p-3">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Post an announcement to the team — game moved, bring white jerseys, snack schedule…"
            rows={3}
            className={fieldClass}
          />
          <button
            onClick={post}
            disabled={busy || !body.trim()}
            className="mt-2 w-full bg-gold py-2.5 font-display text-ink disabled:opacity-60"
          >
            {busy ? 'Posting…' : 'Post announcement ▸'}
          </button>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {posts.map((p) => (
          <li key={p.id} className="border-2 border-ink bg-white p-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-athletic text-xs font-bold uppercase tracking-wide text-board-green">{p.author}</span>
              <span className="font-data text-[11px] text-muted-tan">{fmtAgo(p.created_at)}</span>
            </div>
            <p className="whitespace-pre-wrap font-data text-sm text-ink">{p.body}</p>
            {canPost && (
              <button
                onClick={() => remove(p)}
                className="mt-1.5 font-athletic text-[11px] font-bold uppercase tracking-wide text-ink/40 hover:text-barn-red"
              >
                Delete
              </button>
            )}
          </li>
        ))}
        {posts.length === 0 && (
          <li className="border-2 border-dashed border-ink/30 px-3 py-6 text-center font-data text-sm text-muted-tan">
            {canPost ? 'No announcements yet — post the first one above.' : 'No announcements yet.'}
          </li>
        )}
      </ul>
    </div>
  )
}

// Compact relative time ("3h", "2d"), falling back to a date for older posts.
export function fmtAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 604800) return `${Math.floor(s / 86400)}d`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

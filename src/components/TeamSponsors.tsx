import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Team } from '@/lib/types'

type Sponsor = {
  id: string
  name: string | null
  image_path: string
  click_url: string | null
  active: boolean
  status: 'pending' | 'approved' | 'rejected'
  review_note: string | null
}

const BUCKET = 'bpw-sponsors'
const publicUrl = (path: string) => supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl

// Team sponsor boards — a booster fundraiser (plan §sponsor boards). Managers upload a
// clickable logo; an AI check moderates it (fail-closed) before it can show publicly.
export function TeamSponsors({ team, canManage }: { team: Team; canManage: boolean }) {
  const [sponsors, setSponsors] = useState<Sponsor[]>([])
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    supabase
      .from('team_sponsors')
      .select('*')
      .eq('team_id', team.id)
      .order('sort')
      .order('created_at')
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setSponsors((data ?? []) as Sponsor[])
      })
  }, [team.id])
  useEffect(load, [load])

  async function onFile(file: File) {
    setError(null)
    setBusy('Uploading…')
    try {
      const cleanUrl = normalizeUrl(url)
      if (url && !cleanUrl) throw new Error('That link doesn’t look like a valid https:// URL.')
      const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
      const path = `${team.id}/${crypto.randomUUID()}.${ext}`
      const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
      if (up.error) throw up.error
      const ins = await supabase
        .from('team_sponsors')
        .insert({ team_id: team.id, name: name.trim() || null, click_url: cleanUrl, image_path: path, status: 'pending' })
        .select('*')
        .single()
      if (ins.error) throw ins.error
      const row = ins.data as Sponsor

      // AI moderation (fail-closed): only an explicit approve flips it live.
      setBusy('Checking the graphic…')
      const b64 = await fileToB64(file)
      const { data: mod } = await supabase.functions.invoke('moderate-sponsor', {
        body: { image_base64: b64, media_type: file.type, name: name.trim(), url: cleanUrl },
      })
      if (mod?.decision === 'approve') {
        await supabase.from('team_sponsors').update({ status: 'approved' }).eq('id', row.id)
      } else {
        await supabase
          .from('team_sponsors')
          .update({ status: 'rejected', review_note: mod?.reason ?? 'Flagged in review.' })
          .eq('id', row.id)
      }
      setName('')
      setUrl('')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setBusy(null)
    }
  }

  async function toggleActive(s: Sponsor) {
    await supabase.from('team_sponsors').update({ active: !s.active }).eq('id', s.id)
    load()
  }
  async function remove(s: Sponsor) {
    if (!window.confirm('Remove this sponsor?')) return
    await supabase.storage.from(BUCKET).remove([s.image_path])
    await supabase.from('team_sponsors').delete().eq('id', s.id)
    load()
  }

  return (
    <div className="mx-auto max-w-lg">
      {error && (
        <p className="mb-3 border-2 border-barn-red bg-barn-red/10 px-3 py-2 font-data text-sm text-barn-red">{error}</p>
      )}

      <p className="mb-3 font-data text-sm text-muted-tan">
        Sell a flat sponsor panel to a local business — it shows on your games’ watch page as a booster
        fundraiser. Every logo is checked before it can appear.
      </p>

      {canManage && (
        <div className="mb-4 border-2 border-ink bg-cream-off p-3">
          <p className="mb-2 font-athletic text-xs font-semibold uppercase tracking-[.12em] text-muted-tan">
            Add a sponsor
          </p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Business name (optional)"
            className="mb-2 w-full appearance-none rounded-none border-2 border-ink bg-white px-3 py-2 font-data text-sm outline-none focus:border-board-green"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Link (https://… — optional)"
            className="mb-2 w-full appearance-none rounded-none border-2 border-ink bg-white px-3 py-2 font-data text-sm outline-none focus:border-board-green"
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.currentTarget.value = ''
              if (f) onFile(f)
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={!!busy}
            className="w-full bg-gold py-2.5 font-display text-ink disabled:opacity-60"
          >
            {busy ?? 'Upload logo ▸'}
          </button>
          <p className="mt-1 font-data text-[11px] text-muted-tan">Wide/landscape logos look best (e.g. 800×200).</p>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {sponsors.map((s) => (
          <li key={s.id} className="flex items-center gap-3 border-2 border-ink bg-white p-2.5">
            <img src={publicUrl(s.image_path)} alt={s.name ?? 'Sponsor'} className="h-10 w-24 object-contain" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-data text-sm text-ink">{s.name || s.click_url || 'Sponsor'}</p>
              <StatusLine s={s} />
            </div>
            {canManage && (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => toggleActive(s)}
                  className={`font-athletic text-xs font-bold uppercase tracking-wide ${s.active ? 'text-board-green' : 'text-ink/40'}`}
                >
                  {s.active ? 'On' : 'Off'}
                </button>
                <button
                  onClick={() => remove(s)}
                  className="font-athletic text-xs font-bold uppercase tracking-wide text-ink/40 hover:text-barn-red"
                >
                  ✕
                </button>
              </div>
            )}
          </li>
        ))}
        {sponsors.length === 0 && (
          <li className="border-2 border-dashed border-ink/30 px-3 py-6 text-center font-data text-sm text-muted-tan">
            No sponsors yet.
          </li>
        )}
      </ul>
    </div>
  )
}

function StatusLine({ s }: { s: Sponsor }) {
  if (s.status === 'approved')
    return <p className="font-athletic text-[10px] font-bold uppercase tracking-wide text-board-green">Approved · live</p>
  if (s.status === 'rejected')
    return (
      <p className="font-athletic text-[10px] font-bold uppercase tracking-wide text-barn-red">
        Rejected{s.review_note ? ` · ${s.review_note}` : ''}
      </p>
    )
  return <p className="font-athletic text-[10px] font-bold uppercase tracking-wide text-muted-tan">Under review</p>
}

function normalizeUrl(raw: string): string | null {
  const u = raw.trim()
  if (!u) return null
  const withProto = /^https?:\/\//i.test(u) ? u : `https://${u}`
  try {
    const parsed = new URL(withProto)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed.toString()
  } catch {
    return null
  }
}

function fileToB64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]+,/, ''))
    r.onerror = () => reject(new Error('Could not read the image.'))
    r.readAsDataURL(file)
  })
}

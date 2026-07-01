import { useState } from 'react'
import { supabase } from '@/lib/supabase'

type Row = { player_id: string; name: string; jersey: string | null; status: 'going' | 'maybe' | 'not' }

// Staff-only "who's coming" for a game or practice. Tap the count to expand the named
// list grouped by Going / Maybe / Can't. For non-staff we show just the count (the
// named list is gated server-side by rsvp_list → is_team_staff). Names are family
// accounts, not players, since we follow the whole team.
export function RsvpRoster({
  teamId,
  targetType,
  targetId,
  goingCount,
  staff,
}: {
  teamId: string
  targetType: 'game' | 'event'
  targetId: string
  goingCount: number
  staff: boolean
}) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Row[] | null>(null)

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && rows === null) {
      const { data } = await supabase.rpc('rsvp_list', {
        p_team_id: teamId,
        p_target_type: targetType,
        p_target_id: targetId,
      })
      setRows((data ?? []) as Row[])
    }
  }

  if (!staff) {
    return goingCount > 0 ? <span className="font-data text-xs text-muted-tan">{goingCount} going</span> : null
  }

  const going = rows?.filter((r) => r.status === 'going') ?? []
  const maybe = rows?.filter((r) => r.status === 'maybe') ?? []
  const cant = rows?.filter((r) => r.status === 'not') ?? []

  return (
    <div className="mt-1">
      <button onClick={toggle} className="font-athletic text-xs font-bold uppercase tracking-wide text-board-green">
        {goingCount} going {open ? '▾' : '▸'}
      </button>
      {open && rows && (
        <div className="mt-1.5 space-y-1.5">
          <Group label="Going" tone="text-board-green" rows={going} />
          <Group label="Maybe" tone="text-ink" rows={maybe} />
          <Group label="Can’t" tone="text-barn-red" rows={cant} />
          {rows.length === 0 && <p className="font-data text-xs text-muted-tan">No responses yet.</p>}
        </div>
      )}
    </div>
  )
}

function Group({ label, tone, rows }: { label: string; tone: string; rows: Row[] }) {
  if (rows.length === 0) return null
  return (
    <div>
      <p className={`font-athletic text-[10px] font-bold uppercase tracking-wide ${tone}`}>
        {label} · {rows.length}
      </p>
      <p className="font-data text-xs text-ink/80">
        {rows.map((r) => (r.jersey ? `#${r.jersey} ${r.name}` : r.name)).join(', ')}
      </p>
    </div>
  )
}

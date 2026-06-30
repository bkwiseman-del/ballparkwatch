import { useEffect, useState } from 'react'
import { loadTeamSeason, type TeamSeason } from '@/lib/seasonStats'
import { battingRates, formatAvg, formatIp, pitchingRates } from '@/lib/stats'
import type { Team } from '@/lib/types'

// Team season stats — record + per-player batting/pitching, summed across the team's
// final games. (The same data a public team page would render — see the plan §8.)
export function SeasonStats({ team }: { team: Team }) {
  const [data, setData] = useState<TeamSeason | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadTeamSeason(team.id)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setErr(e instanceof Error ? e.message : 'Could not load stats.'))
    return () => {
      cancelled = true
    }
  }, [team.id])

  const rec = data?.record
  const recLine = rec
    ? `${rec.w}-${rec.l}${rec.t ? `-${rec.t}` : ''}`
    : '—'

  return (
    <div className="mx-auto max-w-3xl">
        {/* Record */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b-2 border-ink bg-cream-off px-4 py-3">
          <Stat label="Record" value={recLine} big />
          <Stat label="GP" value={rec ? String(rec.gp) : '—'} />
          <Stat label="Runs for" value={rec ? String(rec.rf) : '—'} />
          <Stat label="Runs against" value={rec ? String(rec.ra) : '—'} />
          <Stat label="Run diff" value={rec ? signed(rec.rf - rec.ra) : '—'} />
        </div>

        {err && <p className="px-4 py-3 font-data text-sm text-barn-red">{err}</p>}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!data && !err && <p className="px-4 py-6 font-data text-muted-tan">Crunching the season…</p>}

          {data && data.record.gp === 0 && (
            <p className="px-4 py-6 font-data text-muted-tan">
              No finished games yet — season stats appear once a game goes final.
            </p>
          )}

          {data && data.record.gp > 0 && (
            <>
              <TableSection title="Batting">
                <table className="w-full min-w-[640px] border-collapse font-data text-sm tabular">
                  <thead>
                    <Tr head>
                      {['Player', 'G', 'AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'BB', 'K', 'SB', 'AVG', 'OBP', 'SLG', 'OPS'].map(
                        (h, i) => (
                          <Th key={h} left={i === 0}>
                            {h}
                          </Th>
                        ),
                      )}
                    </Tr>
                  </thead>
                  <tbody>
                    {data.batting.map((b) => {
                      const r = battingRates(b)
                      return (
                        <Tr key={b.playerId}>
                          <Td left>{b.name}</Td>
                          <Td>{b.g}</Td>
                          <Td>{b.ab}</Td>
                          <Td>{b.r}</Td>
                          <Td>{b.h}</Td>
                          <Td>{b.doubles}</Td>
                          <Td>{b.triples}</Td>
                          <Td>{b.hr}</Td>
                          <Td>{b.rbi}</Td>
                          <Td>{b.bb}</Td>
                          <Td>{b.k}</Td>
                          <Td>{b.sb}</Td>
                          <Td>{formatAvg(r.avg)}</Td>
                          <Td>{formatAvg(r.obp)}</Td>
                          <Td>{formatAvg(r.slg)}</Td>
                          <Td>{formatAvg(r.ops)}</Td>
                        </Tr>
                      )
                    })}
                  </tbody>
                </table>
              </TableSection>

              {data.pitching.length > 0 && (
                <TableSection title="Pitching">
                  <table className="w-full min-w-[520px] border-collapse font-data text-sm tabular">
                    <thead>
                      <Tr head>
                        {['Pitcher', 'G', 'IP', 'H', 'R', 'ER', 'BB', 'K', 'ERA', 'WHIP'].map((h, i) => (
                          <Th key={h} left={i === 0}>
                            {h}
                          </Th>
                        ))}
                      </Tr>
                    </thead>
                    <tbody>
                      {data.pitching.map((p) => {
                        const r = pitchingRates(p)
                        return (
                          <Tr key={p.playerId}>
                            <Td left>{p.name}</Td>
                            <Td>{p.g}</Td>
                            <Td>{formatIp(p.outs)}</Td>
                            <Td>{p.h}</Td>
                            <Td>{p.r}</Td>
                            <Td>{p.er}</Td>
                            <Td>{p.bb}</Td>
                            <Td>{p.k}</Td>
                            <Td>{p.outs > 0 ? r.era.toFixed(2) : '—'}</Td>
                            <Td>{p.outs > 0 ? r.whip.toFixed(2) : '—'}</Td>
                          </Tr>
                        )
                      })}
                    </tbody>
                  </table>
                </TableSection>
              )}
            </>
          )}
        </div>
    </div>
  )
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <div className="font-athletic text-[10px] font-semibold uppercase tracking-[.14em] text-muted-tan">{label}</div>
      <div className={`font-display ${big ? 'text-2xl' : 'text-lg'} text-ink`}>{value}</div>
    </div>
  )
}

function TableSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-4 py-3">
      <h3 className="mb-2 font-athletic text-xs font-semibold uppercase tracking-[.14em] text-barn-red">{title}</h3>
      <div className="overflow-x-auto border-2 border-ink">{children}</div>
    </section>
  )
}

function Tr({ children, head }: { children: React.ReactNode; head?: boolean }) {
  return <tr className={head ? 'bg-ink text-cream' : 'border-t border-ink/12 bg-cream-off'}>{children}</tr>
}
function Th({ children, left }: { children: React.ReactNode; left?: boolean }) {
  return (
    <th className={`whitespace-nowrap px-2 py-1.5 font-athletic text-[11px] font-semibold uppercase tracking-wide ${left ? 'text-left' : 'text-right'}`}>
      {children}
    </th>
  )
}
function Td({ children, left }: { children: React.ReactNode; left?: boolean }) {
  return <td className={`whitespace-nowrap px-2 py-1.5 ${left ? 'text-left font-display' : 'text-right'}`}>{children}</td>
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n)
}

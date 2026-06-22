import type { Handedness } from './types'

export type RosterRow = {
  name: string
  jersey_number: string | null
  default_position: string | null
  bats: Handedness | null
  throws: Exclude<Handedness, 'S'> | null
}

const HEADERS = ['name', 'jersey_number', 'position', 'bats', 'throws'] as const

// A downloadable template with the expected columns and a couple example rows.
export function rosterTemplateCsv(): string {
  return [
    HEADERS.join(','),
    'Jordan Ellis,12,SS,R,R',
    'Marcus Park,7,P,L,L',
    'Riley Chen,24,CF,S,R',
  ].join('\n')
}

export function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// Minimal RFC-4180-ish parser: handles quoted fields, commas/newlines in quotes,
// and a flexible header row (column order/casing tolerant).
export function parseRosterCsv(text: string): { rows: RosterRow[]; errors: string[] } {
  const errors: string[] = []
  const records = splitRecords(text).filter((r) => r.some((c) => c.trim() !== ''))
  if (records.length === 0) return { rows: [], errors: ['File is empty.'] }

  const header = records[0].map((h) => h.trim().toLowerCase())
  const idx = {
    name: findCol(header, ['name', 'player', 'player name']),
    number: findCol(header, ['jersey_number', 'number', 'no', 'no.', '#', 'jersey']),
    position: findCol(header, ['position', 'pos', 'default_position']),
    bats: findCol(header, ['bats', 'b']),
    throws: findCol(header, ['throws', 't']),
  }
  if (idx.name === -1) {
    return { rows: [], errors: ['Missing a "name" column. Download the template for the expected format.'] }
  }

  const rows: RosterRow[] = []
  for (let i = 1; i < records.length; i++) {
    const r = records[i]
    const name = (r[idx.name] ?? '').trim()
    if (!name) {
      errors.push(`Row ${i + 1}: skipped (no name).`)
      continue
    }
    rows.push({
      name,
      jersey_number: cell(r, idx.number),
      default_position: cell(r, idx.position),
      bats: hand(cell(r, idx.bats)) as RosterRow['bats'],
      throws: hand(cell(r, idx.throws)) === 'S' ? null : (hand(cell(r, idx.throws)) as RosterRow['throws']),
    })
  }
  return { rows, errors }
}

function cell(r: string[], i: number): string | null {
  if (i === -1) return null
  const v = (r[i] ?? '').trim()
  return v === '' ? null : v
}

function hand(v: string | null): Handedness | null {
  if (!v) return null
  const c = v.trim().toUpperCase()[0]
  return c === 'L' || c === 'R' || c === 'S' ? (c as Handedness) : null
}

function findCol(header: string[], names: string[]): number {
  for (const n of names) {
    const i = header.indexOf(n)
    if (i !== -1) return i
  }
  return -1
}

function splitRecords(text: string): string[][] {
  const records: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      records.push(row)
      row = []
      field = ''
    } else field += ch
  }
  row.push(field)
  records.push(row)
  return records
}

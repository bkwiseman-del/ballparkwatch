import type { Half } from './types'

// The minimal live state the scorebug + viewer render. Decoupled from the DB
// row shape so components stay reusable across surfaces.
export type ScoreboardState = {
  away: TeamLine
  home: TeamLine
  inning: number
  half: Half
  balls: number
  strikes: number
  outs: number
  runners: { first: boolean; second: boolean; third: boolean }
}

export type TeamLine = {
  code: string // 3-letter code
  name?: string
  score: number
}

export const EMPTY_SCOREBOARD: ScoreboardState = {
  away: { code: 'AWY', score: 0 },
  home: { code: 'HOM', score: 0 },
  inning: 1,
  half: 'top',
  balls: 0,
  strikes: 0,
  outs: 0,
  runners: { first: false, second: false, third: false },
}

// "▼6" = top of 6th (arrow down = visitors up); "▲6" = bottom.
// Convention in the spec: ▼ shown for BOT? The spec shows "▼6 / BOT". We follow
// the spec literally: top→▲ pointing up (away batting first), bottom→▼.
export function halfArrow(half: Half): string {
  return half === 'top' ? '▲' : '▼'
}

export function halfLabel(half: Half): string {
  return half === 'top' ? 'TOP' : 'BOT'
}

// Prefer an explicit code; otherwise derive a 3-letter abbreviation from the name.
export function resolveCode(code: string | null | undefined, name: string | undefined): string {
  const c = code?.trim()
  if (c) return c.toUpperCase().slice(0, 4)
  return teamCode(name)
}

// 3-letter code from a team name, uppercased.
export function teamCode(name: string | undefined): string {
  if (!name) return 'TM'
  const cleaned = name.replace(/[^a-zA-Z0-9 ]/g, '').trim()
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'TM'
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

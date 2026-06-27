// How a player's name is shown to viewers / spoken in commentary. Uses the LAST
// name when there's a real one (e.g. "Carson Siefferman" → "Siefferman"); keeps
// generic labels like "Player 1" whole (its last token is a number, not a
// surname); falls back to '' for an unnamed player so the caller can show a number.
export function displayName(full: string | null | undefined): string {
  if (!full || !full.trim()) return ''
  const parts = full.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]
  const last = parts[parts.length - 1]
  if (/^\d+$/.test(last)) return full.trim() // "Player 1", "Batter 3" — not a surname
  return last
}

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
  // Entered as first name + last INITIAL (e.g. "Carson S" or "Carson S.") — common for the
  // opposing lineup. There's no real surname to shorten to, so a lone "S" is useless on the
  // viewer page and in commentary. Show the given name(s) + the initial instead.
  if (/^[A-Za-z]\.?$/.test(last)) {
    return `${parts.slice(0, -1).join(' ')} ${last[0].toUpperCase()}.`
  }
  return last
}

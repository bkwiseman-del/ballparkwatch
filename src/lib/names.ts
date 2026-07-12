// How a player's name is shown to viewers / spoken in commentary — the single chokepoint
// every surface renders names through. What it returns depends on WHO is watching (`context`):
//
//   'owner' | 'family'  (default) — the team's own people. Uses the LAST name when there's a
//       real one ("Carson Siefferman" → "Siefferman"); this is the app's long-standing behavior.
//   'public'            — strangers, share links, simulcast, AI commentary audio, any anonymous
//       surface. The privacy FLOOR: first name + last initial ("Carson Siefferman" → "Carson S.").
//       A surface that can't identify its viewer MUST pass 'public' (assume stranger → show floor).
//
// Generic labels ("Player 1") pass through whole (their last token is a number, not a surname);
// an unnamed player returns '' so the caller can fall back to a jersey number. NOTE: this is
// defense-in-depth only — the real privacy boundary is server-side (bpw.public_name in the
// public RPCs), because a client can't be trusted to hide what the API already handed it.
export type NameContext = 'owner' | 'family' | 'public'

export function displayName(
  full: string | null | undefined,
  context: NameContext = 'owner',
): string {
  if (!full || !full.trim()) return ''
  const parts = full.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]
  const last = parts[parts.length - 1]
  if (/^\d+$/.test(last)) return full.trim() // "Player 1", "Batter 3" — not a surname
  // Entered as first name + last INITIAL (e.g. "Carson S" or "Carson S.") — common for the
  // opposing lineup. There's no real surname to shorten to, so a lone "S" is useless on the
  // viewer page and in commentary. Show the given name(s) + the initial instead. (This is
  // already the floor, so it's returned regardless of context.)
  if (/^[A-Za-z]\.?$/.test(last)) {
    return `${parts.slice(0, -1).join(' ')} ${last[0].toUpperCase()}.`
  }
  // Privacy floor for anonymous surfaces: first name + last initial.
  if (context === 'public') return `${parts[0]} ${last[0].toUpperCase()}.`
  // The team's own people: surname.
  return last
}

// The public viewer RPCs already return each player's FINAL public identity — a floored name
// ("Carson S."), a full name (team opted in), a kept generic label ("Player 1"), a jersey identity
// ("#24"), or empty. Text surfaces render that verbatim. For SPOKEN audio, though, the announcer
// says "number 24" itself, so a "#24" identity (or an empty name) must NOT be read aloud as a name.
export function speakableName(publicName: string | null | undefined): string | null {
  const s = (publicName ?? '').trim()
  return s && !s.startsWith('#') ? s : null
}

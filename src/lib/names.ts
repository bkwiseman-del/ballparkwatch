// Public-facing player names: the scorer enters full names, but anything a viewer
// sees or hears (scorebug, commentary, recap) uses first name + last initial only
// (e.g. "Carson S."), GameChanger-style, for kids' privacy.
export function privacyName(full: string | null | undefined): string {
  if (!full) return '—'
  const parts = full.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0]}.`
}

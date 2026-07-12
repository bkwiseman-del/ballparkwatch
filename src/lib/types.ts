// Hand-written domain types for the `bpw` schema. Once the migration is applied
// and the project is linked, `npm run db:types` regenerates database.types.ts
// from the live DB; until then these keep the app type-safe.

export type GameStatus = 'scheduled' | 'live' | 'final'

export type VideoSource =
  | 'none'
  | 'phone_whip'
  | 'camera_rtmp'
  | 'multi' // phone angle + external camera, composited to one HLS view
  | 'youtube'
  | 'cloudflare_hls'

export type Half = 'top' | 'bottom'

export type Handedness = 'L' | 'R' | 'S' // S = switch (bats only)

export type TeamSport = 'baseball' | 'softball'
// Discovery = the public stats/schedule PAGE. ('public' is legacy — the UI now uses
// only private/discoverable; the video axis below owns "public".)
export type TeamDiscovery = 'private' | 'discoverable' | 'public'
// Broadcast audience = who can WATCH the video (separate axis, plan §8).
export type BroadcastAudience = 'members' | 'link' | 'public'

export type Team = {
  id: string
  owner_id: string
  name: string
  code: string | null
  season: string | null // legacy free-text; superseded by season_id
  is_favorite: boolean
  created_at: string
  // Durable identity & discovery metadata (20260630030000_team_identity).
  sport: TeamSport
  city: string | null
  state: string | null
  country: string
  age_group: string | null
  level: string | null
  birth_year: number | null
  season_id: string | null
  slug: string | null
  discovery: TeamDiscovery
  broadcast_audience: BroadcastAudience
  claim_status: string
  // Opt-in: show players' FULL names to this team's viewers (default false = the first-name +
  // last-initial privacy floor). The other team + ghost/opponent side are unaffected.
  show_full_names: boolean
  // Part B / B0: nullable link to an Organization. NULL = standalone owner-owned team
  // (the original, unchanged behavior); set = the team belongs to a league/club/etc.
  org_id: string | null
  // Part B / B0.2: nullable placement in a league division (implies its org_season).
  division_id: string | null
}

// Part B / B0 — the league spine above teams (doc 2 §2). Additive; standalone teams ignore it.
export type OrgType = 'league' | 'club' | 'tournament' | 'facility'
export type OrgRole = 'org_admin' | 'division_coordinator'

export type Organization = {
  id: string
  type: OrgType
  name: string
  slug: string | null
  branding: Record<string, unknown>
  stripe_account_id: string | null
  created_by: string
  created_at: string
}

export type OrgMember = {
  org_id: string
  user_id: string
  role: OrgRole
  status: string // active | removed
  invited_by: string | null
  created_at: string
}

// Part B / B0.2 — org-owned season + division tree (doc 2 §2). The global `Season` type below is the
// shared calendar reference; OrgSeason is the org's own, richer season.
export type SeasonFormat = 'league' | 'tournament'
export type OrgSeasonStatus = 'setup' | 'active' | 'complete'

export type OrgSeason = {
  id: string
  org_id: string
  name: string
  format: SeasonFormat
  sport: TeamSport
  starts_on: string | null
  ends_on: string | null
  status: OrgSeasonStatus
  ruleset: Record<string, unknown>
  created_at: string
}

export type Division = {
  id: string
  season_id: string
  org_id: string
  name: string
  rule_profile: Record<string, unknown>
  sort: number
  created_at: string
}

export type Season = { id: string; year: number; term: string; label: string }

// Non-game schedule items (games live in Game). Powers the team schedule + the
// family "following" feed (via team_upcoming).
export type TeamEvent = {
  id: string
  team_id: string
  kind: 'practice' | 'event'
  title: string | null
  starts_at: string
  ends_at: string | null
  location: string | null
  notes: string | null
}

export type Player = {
  id: string
  team_id: string
  name: string
  jersey_number: string | null
  default_position: string | null
  bats: Handedness | null
  throws: Exclude<Handedness, 'S'> | null
  created_at: string
  // Soft-delete: archived players stay in past games but drop out of new lineups.
  archived_at?: string | null
  // Part B / B0.3: birthdate → derived league age (division auto-suggest); per-player privacy flags.
  dob?: string | null
  privacy?: Record<string, unknown>
}

// Part B / B0.3 — the guardian link (doc 2 PlayerGuardian), backed by the extended member_players
// table. Many guardians per player; is_primary marks the primary contact.
export type PlayerGuardian = {
  team_id: string
  user_id: string
  player_id: string
  relationship: string | null
  is_primary: boolean
  notify_prefs: Record<string, unknown>
  created_at: string
}

export type LineupEntry = {
  id: string
  game_id: string
  team_id: string
  player_id: string
  batting_order: number | null
  position: string | null
  is_starter: boolean
}

export type Recap = { headline: string; body: string; generated_at?: string }

export type Game = {
  id: string
  owner_id: string
  home_team_id: string
  away_team_id: string
  scheduled_at: string | null
  location: string | null
  status: GameStatus
  video_source: VideoSource
  video_config: Record<string, unknown>
  stat_delay_ms: number
  recap: Recap | null
  slug: string
  share_token: string
  created_at: string
}

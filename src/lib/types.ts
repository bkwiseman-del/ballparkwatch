// Hand-written domain types for the `bpw` schema. Once the migration is applied
// and the project is linked, `npm run db:types` regenerates database.types.ts
// from the live DB; until then these keep the app type-safe.

export type GameStatus = 'scheduled' | 'live' | 'final'

export type VideoSource =
  | 'none'
  | 'phone_whip'
  | 'camera_rtmp'
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

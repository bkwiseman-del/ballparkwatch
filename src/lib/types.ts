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

export type Team = {
  id: string
  owner_id: string
  name: string
  season: string | null
  is_favorite: boolean
  created_at: string
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
}

export type Game = {
  id: string
  owner_id: string
  home_team_id: string
  away_team_id: string
  scheduled_at: string | null
  status: GameStatus
  video_source: VideoSource
  video_config: Record<string, unknown>
  stat_delay_ms: number
  slug: string
  share_token: string
  created_at: string
}

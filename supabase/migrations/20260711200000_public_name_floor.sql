-- =====================================================================
-- Privacy floor at the public GAME boundary (rollout plan step ①, docs/bandbox-rollout-plan.md).
--
-- The public TEAM page already floors roster names via bpw.names_down() (first name + last
-- initial). But the public GAME RPCs shipped RAW player names to anonymous viewers; the client
-- only shortened them for display, which is not a boundary — anyone can call the RPC directly.
-- This routes those three name spots through the SAME existing chokepoint, bpw.names_down(),
-- so there is ONE canonical server-side floor (mirroring the client's displayName(..., 'public')).
--
-- Only the three name spots change; every other field, join, and the broadcast_audience
-- visibility gate are preserved verbatim. Team names (away/home) are org-level, not minors, so
-- they stay full. Additive + idempotent (create or replace). Apply via the Supabase SQL editor
-- (shared schema). Owner/scorer surfaces use their own queries and are unaffected.
-- =====================================================================

-- Align the existing floor with the client (src/lib/names.ts displayName(full, 'public')):
--   ''/null            -> ''            (caller falls back to a jersey number)
--   "Carson"           -> "Carson"      (single token)
--   "Player 1"         -> "Player 1"    (numeric last token = generic label; NEW: was "Player 1.")
--   "Carson S" / "S."  -> "Carson S."   (already-floored input, idempotent)
--   "Carson Siefferman"-> "Carson S."
-- Superset of the prior body (adds the generic-label passthrough); the team page only benefits.
create or replace function bpw.names_down(p text)
returns text language sql immutable as $$
  select case
    when p is null or btrim(p) = '' then ''
    when array_length(string_to_array(btrim(p), ' '), 1) = 1 then btrim(p)
    -- numeric last token: a generic label ("Player 1") that identifies nobody — keep it whole
    when split_part(btrim(p), ' ', array_length(string_to_array(btrim(p), ' '), 1)) ~ '^\d+$'
      then btrim(p)
    else split_part(btrim(p), ' ', 1) || ' '
         || upper(left(split_part(btrim(p), ' ', array_length(string_to_array(btrim(p), ' '), 1)), 1)) || '.'
  end;
$$;
grant execute on function bpw.names_down(text) to anon, authenticated;

-- lineup_json: floor the roster/lineup name (id/jersey/pos unchanged).
create or replace function bpw.lineup_json(p_game_id uuid, p_team_id uuid)
returns jsonb
language sql
security definer
set search_path = bpw, public
stable
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', p.id, 'name', bpw.names_down(p.name), 'jersey', p.jersey_number, 'pos', le.position)
      order by le.batting_order
    ),
    '[]'::jsonb
  )
  from bpw.lineup_entries le
  join bpw.players p on p.id = le.player_id
  where le.game_id = p_game_id and le.team_id = p_team_id;
$$;

-- get_public_events: floor the play-by-play batter name.
create or replace function bpw.get_public_events(p_game_id uuid)
returns jsonb
language sql
security definer
set search_path = bpw, public
stable
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'seq', e.seq,
        'event_type', e.event_type,
        'inning', e.inning,
        'half', e.half,
        'batter_id', e.batter_id,
        'batter_name', bpw.names_down(p.name),
        'payload', e.payload,
        'wall_clock_ts', e.wall_clock_ts
      ) order by e.seq
    ),
    '[]'::jsonb
  )
  from bpw.game_events e
  left join bpw.players p on p.id = e.batter_id
  where e.game_id = p_game_id;
$$;

-- get_public_game: floor the players map name. Body is the current definition
-- (20260709190000_ivs_replay_angles.sql) verbatim EXCEPT the players[].name spot.
create or replace function bpw.get_public_game(p_game_id uuid)
returns jsonb language sql security definer set search_path = bpw, public stable as $$
  select jsonb_build_object(
    'id', g.id,
    'status', g.status,
    'video_source', g.video_source,
    'video_config', coalesce(g.video_config, '{}'::jsonb),
    'stat_delay_ms', g.stat_delay_ms,
    'recap', g.recap,
    'scheduled_at', g.scheduled_at,
    'recording_path', g.recording_path,
    'recording_started_at', g.recording_started_at,
    'recording_mime', g.recording_mime,
    'recording_duration_ms', g.recording_duration_ms,
    'recording_segments', g.recording_segments,
    'cf_whep_url', g.cf_whep_url,
    'cf_hls_url', g.cf_hls_url,
    'cf_recording_uid', g.cf_recording_uid,
    'cf_customer_code', g.cf_customer_code,
    'ivs_playback_url', g.ivs_playback_url,
    'ivs_replay_url', g.ivs_replay_url,
    'ivs_replay_angles', g.ivs_replay_angles,
    'away', jsonb_build_object('name', away.name, 'code', away.code),
    'home', jsonb_build_object('name', home.name, 'code', home.code),
    'snapshot', coalesce(gs.snapshot, '{}'::jsonb),
    'lineups', jsonb_build_object(
      'away', bpw.lineup_json(g.id, g.away_team_id),
      'home', bpw.lineup_json(g.id, g.home_team_id)
    ),
    'players', coalesce((
      select jsonb_object_agg(p.id, jsonb_build_object('name', bpw.names_down(p.name), 'jersey', p.jersey_number))
      from bpw.players p
      where p.team_id in (g.away_team_id, g.home_team_id)
    ), '{}'::jsonb),
    'sponsors', coalesce((
      select jsonb_agg(jsonb_build_object('name', s.name, 'image', s.image_path, 'url', s.click_url)
             order by s.sort, s.created_at)
      from bpw.team_sponsors s
      where s.team_id in (g.away_team_id, g.home_team_id) and s.active and s.status = 'approved'
    ), '[]'::jsonb)
  )
  from bpw.games g
  join bpw.teams away on away.id = g.away_team_id
  join bpw.teams home on home.id = g.home_team_id
  left join bpw.game_state gs on gs.game_id = g.id
  where g.id = p_game_id
    and not exists (
      select 1 from bpw.teams tt
      where tt.id in (g.home_team_id, g.away_team_id)
        and tt.broadcast_audience = 'members'
        and not bpw.is_team_member(tt.id)
    );
$$;

grant execute on function bpw.lineup_json(uuid, uuid) to anon, authenticated;
grant execute on function bpw.get_public_events(uuid) to anon, authenticated;
grant execute on function bpw.get_public_game(uuid) to anon, authenticated;

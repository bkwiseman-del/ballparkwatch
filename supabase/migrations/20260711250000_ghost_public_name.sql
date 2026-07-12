-- =====================================================================
-- Part A / ③ ghost opponents — CORRECT public identity for ghost-team players
-- (supersedes the blunt suppression in 20260711240000).
--
-- The prior version blanked EVERY ghost player's name — including the auto-inserted generic
-- placeholders ("Player 1", "Player 2") that identify nobody. With no jersey either, those showed
-- as a blank "—". That's bad UX for zero privacy benefit. The correct rule for a ghost player is a
-- priority chain that never exposes a real typed name:
--   1. jersey present            → "#24"
--   2. generic placeholder name  → keep it ("Player 1" / "Batter 3" — a numeric last token; not PII)
--   3. a real typed name         → suppress to '' (client shows "—"; scorer can add a number)
-- Real (non-ghost) teams keep the first-name+last-initial floor (names_down). One helper,
-- bpw.public_player_name, is the single source so every public surface agrees. Additive +
-- idempotent; the server now emits the full public display string (the client just renders it).
-- =====================================================================

create or replace function bpw.public_player_name(p_name text, p_jersey text, p_ghost boolean)
returns text language sql immutable as $$
  select case
    when not coalesce(p_ghost, false) then bpw.names_down(p_name)     -- real team: floor
    when coalesce(btrim(p_jersey), '') <> '' then '#' || btrim(p_jersey)  -- ghost: number first
    when p_name is not null and btrim(p_name) <> ''
         and split_part(btrim(p_name), ' ', array_length(string_to_array(btrim(p_name), ' '), 1)) ~ '^[0-9]+$'
      then btrim(p_name)                                              -- generic label ("Player 1"): keep
    else ''                                                           -- real name, no number: suppress
  end;
$$;
revoke all on function bpw.public_player_name(text, text, boolean) from public;
grant execute on function bpw.public_player_name(text, text, boolean) to anon, authenticated, service_role;

-- lineup_json
create or replace function bpw.lineup_json(p_game_id uuid, p_team_id uuid)
returns jsonb language sql security definer set search_path = bpw, public stable as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'name', bpw.public_player_name(p.name, p.jersey_number, t.claim_status = 'ghost'),
        'jersey', p.jersey_number,
        'pos', le.position
      ) order by le.batting_order
    ), '[]'::jsonb
  )
  from bpw.lineup_entries le
  join bpw.players p on p.id = le.player_id
  join bpw.teams   t on t.id = le.team_id
  where le.game_id = p_game_id and le.team_id = p_team_id;
$$;

-- get_public_events (no separate batter_jersey needed — the name already carries "#24" for ghosts)
create or replace function bpw.get_public_events(p_game_id uuid)
returns jsonb language sql security definer set search_path = bpw, public stable as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'seq', e.seq,
        'event_type', e.event_type,
        'inning', e.inning,
        'half', e.half,
        'batter_id', e.batter_id,
        'batter_name', bpw.public_player_name(p.name, p.jersey_number, t.claim_status = 'ghost'),
        'payload', e.payload,
        'wall_clock_ts', e.wall_clock_ts
      ) order by e.seq
    ), '[]'::jsonb
  )
  from bpw.game_events e
  left join bpw.players p on p.id = e.batter_id
  left join bpw.teams   t on t.id = p.team_id
  where e.game_id = p_game_id;
$$;

-- get_public_game (players map)
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
      select jsonb_object_agg(p.id, jsonb_build_object(
        'name', bpw.public_player_name(p.name, p.jersey_number, t.claim_status = 'ghost'),
        'jersey', p.jersey_number))
      from bpw.players p
      join bpw.teams t on t.id = p.team_id
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

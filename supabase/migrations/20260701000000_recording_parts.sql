-- Chunked recording upload. The broadcaster records ONE file, then uploads it in
-- small ~5MB byte-slices (robust on mobile; a dropped part retries instead of losing
-- the whole game). recording_segments holds the ordered part paths; the viewer fetches
-- them and concatenates back into the original file, so the replay stays a single video
-- (the scorebug sync is unchanged). Back-compat: old single-file recordings still work.
-- Apply via the Supabase SQL editor (shared schema; see CLAUDE.md).

alter table bpw.games add column if not exists recording_segments jsonb;

-- save_recording gains an optional ordered list of part paths.
drop function if exists bpw.save_recording(text, text, timestamptz, int, text);
create or replace function bpw.save_recording(
  p_token       text,
  p_path        text,
  p_started_at  timestamptz,
  p_duration_ms int,
  p_mime        text,
  p_segments    jsonb default null
) returns void language plpgsql security definer set search_path = bpw, public as $$
declare gid uuid := bpw.broadcast_game_id(p_token);
begin
  if gid is null then raise exception 'invalid broadcast token'; end if;
  update bpw.games
     set recording_path       = p_path,
         recording_started_at  = p_started_at,
         recording_duration_ms = p_duration_ms,
         recording_mime        = p_mime,
         recording_segments    = p_segments
   where id = gid;
end $$;
revoke all on function bpw.save_recording(text, text, timestamptz, int, text, jsonb) from public;
grant execute on function bpw.save_recording(text, text, timestamptz, int, text, jsonb) to anon, authenticated;

-- Expose recording_segments on the public game (add the field; body otherwise unchanged).
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
    'away', jsonb_build_object('name', away.name, 'code', away.code),
    'home', jsonb_build_object('name', home.name, 'code', home.code),
    'snapshot', coalesce(gs.snapshot, '{}'::jsonb),
    'lineups', jsonb_build_object(
      'away', bpw.lineup_json(g.id, g.away_team_id),
      'home', bpw.lineup_json(g.id, g.home_team_id)
    ),
    'players', coalesce((
      select jsonb_object_agg(p.id, jsonb_build_object('name', p.name, 'jersey', p.jersey_number))
      from bpw.players p
      where p.team_id in (g.away_team_id, g.home_team_id)
    ), '{}'::jsonb)
  )
  from bpw.games g
  join bpw.teams away on away.id = g.away_team_id
  join bpw.teams home on home.id = g.home_team_id
  left join bpw.game_state gs on gs.game_id = g.id
  where g.id = p_game_id;
$$;
grant execute on function bpw.get_public_game(uuid) to anon, authenticated;

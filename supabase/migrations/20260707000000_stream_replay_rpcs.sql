-- External-camera (RTMP) replay finalize needs to read the game + its game_start/game_end
-- bounds and write the recording uid + replay anchor. The stream-live Edge Function runs as
-- the service role, which this schema does NOT grant direct table access to (bpw.games /
-- bpw.game_events return "permission denied" via PostgREST). So expose exactly what finalize
-- needs as security-definer RPCs.

-- Game start/end timestamps (for anchoring the replay + computing the game window).
create or replace function bpw.game_bounds(p_game_id uuid)
returns table(gstart timestamptz, gend timestamptz)
language sql security definer set search_path = bpw, public as $$
  select
    (select created_at from bpw.game_events where game_id = p_game_id and event_type = 'game_start' order by seq limit 1),
    (select created_at from bpw.game_events where game_id = p_game_id and event_type = 'game_end'   order by seq limit 1);
$$;
grant execute on function bpw.game_bounds(uuid) to anon, authenticated, service_role;

-- Set the replay recording uid + anchor (+ optional video_config, used to stash a pending clip
-- uid). coalesce() so a null argument leaves the existing value untouched.
create or replace function bpw.stream_set_replay(
  p_game_id uuid, p_recording_uid text, p_started_at timestamptz, p_video_config jsonb
) returns void language plpgsql security definer set search_path = bpw, public as $$
begin
  update bpw.games
     set cf_recording_uid     = coalesce(p_recording_uid, cf_recording_uid),
         recording_started_at = coalesce(p_started_at, recording_started_at),
         video_config         = coalesce(p_video_config, video_config)
   where id = p_game_id;
end $$;
grant execute on function bpw.stream_set_replay(uuid, text, timestamptz, jsonb) to anon, authenticated, service_role;

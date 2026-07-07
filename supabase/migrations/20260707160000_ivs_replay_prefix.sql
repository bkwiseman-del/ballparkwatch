-- Build 4 (replay): finalize resolves the replay VOD by reading the composite recording's
-- events/recording-ended.json from S3, which needs the recording prefix. A viewer finalizes a
-- public final game by game_id (no broadcast token), so expose the prefix by game_id via a
-- security-definer RPC (the Edge Function reaches bpw only through RPCs). The prefix is an internal
-- S3 key under our private bucket — not sensitive on its own (the bucket is CloudFront-OAC gated).
create or replace function bpw.stream_ivs_prefix_by_game(p_game_id uuid)
returns text language sql security definer set search_path = bpw, public stable as $$
  select ivs_recording_prefix from bpw.games where id = p_game_id;
$$;
grant execute on function bpw.stream_ivs_prefix_by_game(uuid) to anon, authenticated, service_role;

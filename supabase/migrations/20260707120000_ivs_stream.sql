-- =====================================================================
-- Amazon IVS video backbone (replaces Cloudflare Stream — see docs/ivs-migration-plan.md).
--
-- Ingest: one IVS Real-Time STAGE per game. The phone publishes WHIP (sub-second);
-- an external camera publishes RTMP via an ingest-configuration stream key. Both
-- feeds land on the same stage (spike-proven 2026-07-07).
--
-- Recording: server-side COMPOSITION of the stage -> S3 (HLS), bounded by
-- StartComposition (game start) / StopComposition (game end) so the replay contains
-- NO pre-game footage. The exact recording_started_at comes from the recording's
-- events/recording-started.json (a reliable wall-clock anchor; IVS composite HLS has
-- no PROGRAM-DATE-TIME, but this anchor replaces it).
--
-- Live HLS + synced scorebug (camera / scaled audiences): a low-latency CHANNEL fed
-- from the stage; the scorer injects the scorebug via ivs put-metadata (timed_id3,
-- frame-synced). Wired in Build 2.
--
-- All AWS secrets live ONLY in the stream-live Edge Function. This schema stores the
-- non-secret ARNs/URLs the pipeline needs. Additive + idempotent — keeps the cf_*
-- columns working until Cloudflare is removed (Build 5). Apply via the Supabase SQL
-- editor (shared schema; see CLAUDE.md).
-- =====================================================================

-- ---------- per-game IVS state ----------
alter table bpw.games
  add column if not exists ivs_stage_arn       text, -- Real-Time stage (ingest: WHIP phone + RTMP camera)
  add column if not exists ivs_ingest_key      text, -- camera RTMP stream key (broadcaster secret; never exposed)
  add column if not exists ivs_channel_arn      text, -- low-latency channel for live HLS + put-metadata (Build 2)
  add column if not exists ivs_playback_url     text, -- viewer-safe LIVE HLS URL (Build 2)
  add column if not exists ivs_composition_arn  text, -- active composition (needed to StopComposition at game end)
  add column if not exists ivs_recording_prefix text, -- S3 key prefix of the composite recording
  add column if not exists ivs_replay_url       text; -- viewer-safe REPLAY HLS URL (set at finalize)

-- ---------- token-validated RPCs (mirror the stream_* pattern) ----------
-- Broadcaster may be anonymous (opens the broadcaster page via a live grant or the
-- game's share_token); bpw.broadcast_game_id() is the canonical resolver. Service role
-- has RPC-only access to bpw, so the Edge Function reaches tables only through these.

-- Resolve the game + its IVS ids for a broadcast token (reuse-or-create decision).
create or replace function bpw.stream_ivs_lookup(p_token text)
returns jsonb
language sql security definer set search_path = bpw, public stable
as $$
  select jsonb_build_object(
    'game_id', g.id,
    'video_source', g.video_source,
    'ivs_stage_arn', g.ivs_stage_arn,
    'ivs_channel_arn', g.ivs_channel_arn,
    'ivs_ingest_key', g.ivs_ingest_key,
    'ivs_composition_arn', g.ivs_composition_arn
  )
  from bpw.games g
  where g.id = bpw.broadcast_game_id(p_token);
$$;

-- Store a freshly created stage (+ optional camera ingest key / channel + live HLS URL).
-- coalesce() so a null arg leaves the existing value untouched (call it incrementally).
create or replace function bpw.stream_ivs_attach(
  p_token        text,
  p_stage_arn    text,
  p_ingest_key   text,
  p_channel_arn  text,
  p_playback_url text
) returns void
language plpgsql security definer set search_path = bpw, public
as $$
begin
  update bpw.games
     set ivs_stage_arn    = coalesce(p_stage_arn,   ivs_stage_arn),
         ivs_ingest_key    = coalesce(p_ingest_key,   ivs_ingest_key),
         ivs_channel_arn   = coalesce(p_channel_arn,  ivs_channel_arn),
         ivs_playback_url  = coalesce(p_playback_url, ivs_playback_url)
   where id = bpw.broadcast_game_id(p_token);
end;
$$;

-- Record the active composition + its recording prefix at game start (StartComposition),
-- so game end can stop it and finalize can find the S3 recording.
create or replace function bpw.stream_ivs_set_composition(
  p_token           text,
  p_composition_arn text,
  p_recording_prefix text
) returns void
language plpgsql security definer set search_path = bpw, public
as $$
begin
  update bpw.games
     set ivs_composition_arn  = p_composition_arn,
         ivs_recording_prefix = coalesce(p_recording_prefix, ivs_recording_prefix)
   where id = bpw.broadcast_game_id(p_token);
end;
$$;

-- Set the resolved replay + its wall-clock anchor once the composite recording finalizes.
-- By game_id (a viewer may finalize a public final game without the broadcast token).
create or replace function bpw.stream_ivs_set_replay(
  p_game_id    uuid,
  p_replay_url text,
  p_started_at timestamptz
) returns void
language plpgsql security definer set search_path = bpw, public
as $$
begin
  update bpw.games
     set ivs_replay_url        = coalesce(p_replay_url, ivs_replay_url),
         recording_started_at  = coalesce(p_started_at, recording_started_at)
   where id = p_game_id;
end;
$$;

revoke all on function bpw.stream_ivs_lookup(text) from public;
revoke all on function bpw.stream_ivs_attach(text, text, text, text, text) from public;
revoke all on function bpw.stream_ivs_set_composition(text, text, text) from public;
revoke all on function bpw.stream_ivs_set_replay(uuid, text, timestamptz) from public;
grant execute on function bpw.stream_ivs_lookup(text) to anon, authenticated, service_role;
grant execute on function bpw.stream_ivs_attach(text, text, text, text, text) to anon, authenticated, service_role;
grant execute on function bpw.stream_ivs_set_composition(text, text, text) to anon, authenticated, service_role;
grant execute on function bpw.stream_ivs_set_replay(uuid, text, timestamptz) to anon, authenticated, service_role;

-- ---------- expose viewer-safe IVS URLs on the public game ----------
-- REPLACE get_public_game: adds ivs_playback_url (live HLS) + ivs_replay_url (VOD) to the
-- payload. Keeps every existing field (incl. cf_* until Build 5) and the same visibility gate.
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
grant execute on function bpw.get_public_game(uuid) to anon, authenticated;

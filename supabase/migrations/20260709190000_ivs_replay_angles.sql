-- =====================================================================
-- Multi-angle SWITCHABLE replay (see docs/ivs-migration-plan.md).
--
-- The live multi view already switches angles (each is a separate stage participant over WebRTC).
-- The REPLAY was still the composite grid (both angles baked side-by-side into one file). To make
-- replay switchable too, multi games now use IVS *individual participant recording* — one VOD per
-- angle, written straight to S3 by the stage — and we store the resolved per-angle replay URLs here.
--
-- ivs_replay_angles: jsonb array, phone-first, e.g.
--   [ { "kind": "phone",  "label": "Angle 1", "url": "https://cdn/…/multivariant.m3u8", "started_at": "…" },
--     { "kind": "camera", "label": "Angle 2", "url": "https://cdn/…/multivariant.m3u8", "started_at": "…" } ]
-- Each angle's HLS carries EXT-X-PROGRAM-DATE-TIME, so the scorebug re-syncs per angle on switch.
--
-- Additive + idempotent. Composite path (ivs_replay_url) stays as the single-file FALLBACK so replay
-- can never regress below today's behavior. Apply via the Supabase SQL editor (shared schema).
-- =====================================================================

alter table bpw.games
  add column if not exists ivs_replay_angles jsonb; -- per-angle switchable replay ([] / null = use composite

-- Set the resolved per-angle replays + the earliest angle's wall-clock anchor once the individual
-- recordings finalize. By game_id (a viewer may finalize a public final game without a token).
create or replace function bpw.stream_ivs_set_replay_angles(
  p_game_id    uuid,
  p_angles     jsonb,
  p_started_at timestamptz
) returns void
language plpgsql security definer set search_path = bpw, public
as $$
begin
  update bpw.games
     set ivs_replay_angles     = coalesce(p_angles, ivs_replay_angles),
         recording_started_at  = coalesce(p_started_at, recording_started_at)
   where id = p_game_id;
end;
$$;

revoke all on function bpw.stream_ivs_set_replay_angles(uuid, jsonb, timestamptz) from public;
grant execute on function bpw.stream_ivs_set_replay_angles(uuid, jsonb, timestamptz)
  to anon, authenticated, service_role;

-- REPLACE get_public_game: add ivs_replay_angles. Every other field + the visibility gate unchanged.
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

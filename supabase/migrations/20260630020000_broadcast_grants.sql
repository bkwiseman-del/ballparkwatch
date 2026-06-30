-- =====================================================================
-- Broadcast grants + lock the video bucket. Plan §2 "Identity, roles & access" ring 2.
-- Apply via the Supabase SQL editor (shared schema; see CLAUDE.md).
--
-- Closes the real hole: today the bpw-video bucket accepts inserts from ANY anon
-- (recording.sql), and the filming phone authorizes itself with the game's share_token.
-- Replace both:
--   * a filming phone authorizes with a scoped, revocable broadcast_grant (or, still,
--     the share_token — accepted for backward-compat so live links don't break);
--   * the open bucket policy is dropped — uploads now go through the `sign-upload`
--     Edge Function, which mints a path-scoped signed upload URL after validating the
--     broadcast token. So the bucket is no longer openly writable.
-- =====================================================================

create table if not exists bpw.broadcast_grants (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references bpw.games (id) on delete cascade,
  token        text not null unique default replace(gen_random_uuid()::text, '-', ''),
  label        text,
  created_by   uuid not null default auth.uid() references auth.users (id),
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists broadcast_grants_game_idx on bpw.broadcast_grants (game_id);
revoke all on bpw.broadcast_grants from anon;

alter table bpw.broadcast_grants enable row level security;
drop policy if exists bg_manage on bpw.broadcast_grants;
create policy bg_manage on bpw.broadcast_grants
  for all using (bpw.owns_game(game_id)) with check (bpw.owns_game(game_id));

-- Resolve a broadcast token (a live grant OR a game's share_token) to its game id.
-- SECURITY DEFINER so the filming phone (often anon) and the Edge Function can use it.
create or replace function bpw.broadcast_game_id(p_token text)
returns uuid language plpgsql security definer stable set search_path = bpw, public as $$
declare gid uuid;
begin
  select game_id into gid from bpw.broadcast_grants
   where token = p_token and revoked_at is null
     and (expires_at is null or expires_at > now());
  if gid is not null then return gid; end if;
  select id into gid from bpw.games where share_token = p_token;  -- back-compat
  return gid;
end $$;
grant execute on function bpw.broadcast_game_id(text) to anon, authenticated;

-- Mint (or reuse) a broadcast grant for a game. Only someone who can score the game
-- (owner/admin/scorer via owns_game) may mint. Reuses a live grant so the QR is stable.
create or replace function bpw.mint_broadcast_grant(
  p_game_id uuid, p_label text default null, p_expires_at timestamptz default null
) returns text language plpgsql security definer set search_path = bpw, public as $$
declare v_token text;
begin
  if not bpw.owns_game(p_game_id) then
    raise exception 'not authorized to broadcast this game';
  end if;
  select token into v_token from bpw.broadcast_grants
   where game_id = p_game_id and revoked_at is null
     and (expires_at is null or expires_at > now())
   order by created_at desc limit 1;
  if v_token is not null then return v_token; end if;
  insert into bpw.broadcast_grants (game_id, label, expires_at, created_by)
  values (p_game_id, p_label, p_expires_at, auth.uid())
  returning token into v_token;
  return v_token;
end $$;
revoke all on function bpw.mint_broadcast_grant(uuid, text, timestamptz) from public;
grant execute on function bpw.mint_broadcast_grant(uuid, text, timestamptz) to authenticated;

-- Kill the broadcaster link: revoke all live grants for a game (mints a fresh one next time).
create or replace function bpw.revoke_broadcast_grants(p_game_id uuid)
returns void language plpgsql security definer set search_path = bpw, public as $$
begin
  if not bpw.owns_game(p_game_id) then raise exception 'not authorized'; end if;
  update bpw.broadcast_grants set revoked_at = now()
   where game_id = p_game_id and revoked_at is null;
end $$;
revoke all on function bpw.revoke_broadcast_grants(uuid) from public;
grant execute on function bpw.revoke_broadcast_grants(uuid) to authenticated;

-- Redefine resolve_broadcast() + save_recording() to accept a grant OR share_token.
create or replace function bpw.resolve_broadcast(p_token text)
returns jsonb language sql security definer stable set search_path = bpw, public as $$
  select jsonb_build_object(
    'game_id', g.id,
    'video_source', g.video_source,
    'away', jsonb_build_object('name', away.name, 'code', away.code),
    'home', jsonb_build_object('name', home.name, 'code', home.code)
  )
  from bpw.games g
  join bpw.teams away on away.id = g.away_team_id
  join bpw.teams home on home.id = g.home_team_id
  where g.id = bpw.broadcast_game_id(p_token);
$$;
grant execute on function bpw.resolve_broadcast(text) to anon, authenticated;

create or replace function bpw.save_recording(
  p_token text, p_path text, p_started_at timestamptz, p_duration_ms int, p_mime text
) returns void language plpgsql security definer set search_path = bpw, public as $$
declare gid uuid := bpw.broadcast_game_id(p_token);
begin
  if gid is null then raise exception 'invalid broadcast token'; end if;
  update bpw.games
     set recording_path       = p_path,
         recording_started_at  = p_started_at,
         recording_duration_ms = p_duration_ms,
         recording_mime        = p_mime
   where id = gid;
end $$;
revoke all on function bpw.save_recording(text, text, timestamptz, int, text) from public;
grant execute on function bpw.save_recording(text, text, timestamptz, int, text) to anon, authenticated;

-- Lock the bucket: drop the open anon-insert policy. Uploads now require a signed URL
-- minted by the sign-upload Edge Function against a valid broadcast token.
drop policy if exists "broadcast can upload video" on storage.objects;

-- The sign-upload Edge Function calls broadcast_game_id() with the SERVICE ROLE; the
-- bpw schema grants (init.sql) only covered anon/authenticated, so service_role needs
-- usage on the schema + execute on this resolver, or PostgREST returns
-- "permission denied for schema bpw".
grant usage on schema bpw to service_role;
grant execute on function bpw.broadcast_game_id(text) to service_role;

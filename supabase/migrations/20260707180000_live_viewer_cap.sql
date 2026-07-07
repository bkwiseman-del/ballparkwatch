-- Live-viewer cap (cost control). Sub-second phone viewing on IVS bills per-viewer, so free
-- accounts are capped at N concurrent live viewers. Enforced at subscribe-token mint: a viewer must
-- claim a slot before getting a stage token. Heartbeat-based so leavers free their slot within ~20s.
--
-- No paid-tier field exists yet, so every game is "free" → cap = 5. bpw.game_viewer_cap() is the
-- hook to raise it per owner tier later.

create table if not exists bpw.live_viewers (
  game_id   uuid not null references bpw.games (id) on delete cascade,
  viewer_id text not null,          -- client-generated per browser session
  last_seen timestamptz not null default now(),
  primary key (game_id, viewer_id)
);
create index if not exists live_viewers_game_seen_idx on bpw.live_viewers (game_id, last_seen);
alter table bpw.live_viewers enable row level security; -- no policies: reachable only via the SECURITY DEFINER RPCs below

-- Per-game concurrent-viewer cap. Free (the only tier today) = 5. Hook for paid tiers later.
create or replace function bpw.game_viewer_cap(p_game_id uuid)
returns int language sql stable security definer set search_path = bpw, public as $$
  select 5;
$$;

-- How many viewers are live right now (heartbeat within the last 20s).
create or replace function bpw.live_viewer_count(p_game_id uuid)
returns int language sql stable security definer set search_path = bpw, public as $$
  select count(*)::int from bpw.live_viewers
   where game_id = p_game_id and last_seen > now() - interval '20 seconds';
$$;

-- Atomically claim/refresh a viewer slot. Returns true if the viewer holds a slot (already had one,
-- or there was room under the cap), false if the game is full. Prunes stale rows first.
create or replace function bpw.claim_viewer_slot(p_game_id uuid, p_viewer_id text)
returns boolean language plpgsql security definer set search_path = bpw, public as $$
declare
  v_cap int;
  v_active int;
  v_has boolean;
begin
  delete from bpw.live_viewers
   where game_id = p_game_id and last_seen < now() - interval '30 seconds';
  select exists(select 1 from bpw.live_viewers where game_id = p_game_id and viewer_id = p_viewer_id)
    into v_has;
  select bpw.game_viewer_cap(p_game_id) into v_cap;
  select bpw.live_viewer_count(p_game_id) into v_active;
  if v_has or v_active < v_cap then
    insert into bpw.live_viewers (game_id, viewer_id, last_seen)
    values (p_game_id, p_viewer_id, now())
    on conflict (game_id, viewer_id) do update set last_seen = now();
    return true;
  end if;
  return false;
end;
$$;

-- Release a slot immediately (viewer closed the tab / left).
create or replace function bpw.release_viewer_slot(p_game_id uuid, p_viewer_id text)
returns void language sql security definer set search_path = bpw, public as $$
  delete from bpw.live_viewers where game_id = p_game_id and viewer_id = p_viewer_id;
$$;

-- The subscribe-token minter needs the stage ARN by game_id (viewer has no broadcast token).
create or replace function bpw.stream_ivs_stage_by_game(p_game_id uuid)
returns text language sql stable security definer set search_path = bpw, public as $$
  select ivs_stage_arn from bpw.games where id = p_game_id;
$$;

revoke all on function bpw.game_viewer_cap(uuid) from public;
revoke all on function bpw.live_viewer_count(uuid) from public;
revoke all on function bpw.claim_viewer_slot(uuid, text) from public;
revoke all on function bpw.release_viewer_slot(uuid, text) from public;
revoke all on function bpw.stream_ivs_stage_by_game(uuid) from public;
grant execute on function bpw.game_viewer_cap(uuid) to anon, authenticated, service_role;
grant execute on function bpw.live_viewer_count(uuid) to anon, authenticated, service_role;
grant execute on function bpw.claim_viewer_slot(uuid, text) to anon, authenticated, service_role;
grant execute on function bpw.release_viewer_slot(uuid, text) to anon, authenticated, service_role;
grant execute on function bpw.stream_ivs_stage_by_game(uuid) to anon, authenticated, service_role;

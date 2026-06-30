-- =====================================================================
-- Team membership + invites — turn the single-owner model into roles so a
-- team can delegate scoring/broadcasting (free; matches GC). Plan §2 "Identity,
-- roles & access". Apply via the Supabase SQL editor (shared schema; see CLAUDE.md).
--
-- NON-DESTRUCTIVE BY DESIGN:
--   * new tables only (team_members, team_invites) — nothing dropped/altered on
--     teams/players/games/events.
--   * every existing team's owner is backfilled as an 'owner' member, and a trigger
--     adds an owner member for every NEW team — so owners keep full access.
--   * owns_game() is WIDENED (owner still passes; team members also pass) — access
--     only grows, never shrinks. Existing single-user behavior is unchanged.
-- =====================================================================

-- ---------- roles ----------
do $$ begin
  create type bpw.team_role as enum ('owner', 'admin', 'scorer', 'broadcaster');
exception when duplicate_object then null; end $$;

-- ---------- tables ----------
create table if not exists bpw.team_members (
  team_id    uuid not null references bpw.teams (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       bpw.team_role not null default 'scorer',
  status     text not null default 'active',          -- active | removed
  invited_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index if not exists team_members_user_idx on bpw.team_members (user_id);

create table if not exists bpw.team_invites (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references bpw.teams (id) on delete cascade,
  role       bpw.team_role not null default 'scorer',
  email      text,                                     -- null = open join code/QR
  token      text not null unique default replace(gen_random_uuid()::text, '-', ''),
  expires_at timestamptz,
  max_uses   int,
  uses       int not null default 0,
  created_by uuid not null default auth.uid() references auth.users (id),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists team_invites_team_idx on bpw.team_invites (team_id);

-- These tables are sensitive — anon never reads them (init.sql grants anon SELECT by
-- default on new bpw tables; revoke it here).
revoke all on bpw.team_members from anon;
revoke all on bpw.team_invites from anon;

-- ---------- backfill existing owners ----------
insert into bpw.team_members (team_id, user_id, role, status)
  select id, owner_id, 'owner', 'active' from bpw.teams
  on conflict (team_id, user_id) do nothing;

-- ---------- keep new teams consistent: creator becomes the owner member ----------
create or replace function bpw.add_owner_member()
returns trigger language plpgsql security definer set search_path = bpw, public as $$
begin
  insert into bpw.team_members (team_id, user_id, role, status)
  values (new.id, new.owner_id, 'owner', 'active')
  on conflict (team_id, user_id) do nothing;
  return new;
end $$;

drop trigger if exists teams_add_owner on bpw.teams;
create trigger teams_add_owner after insert on bpw.teams
  for each row execute function bpw.add_owner_member();

-- ---------- role helpers (security definer: read membership without recursive RLS) ----------
create or replace function bpw.role_on_team(p_team_id uuid)
returns bpw.team_role language sql security definer stable set search_path = bpw, public as $$
  select role from bpw.team_members
  where team_id = p_team_id and user_id = auth.uid() and status = 'active';
$$;

create or replace function bpw.is_team_member(p_team_id uuid)
returns boolean language sql security definer stable set search_path = bpw, public as $$
  select exists (select 1 from bpw.team_members
    where team_id = p_team_id and user_id = auth.uid() and status = 'active');
$$;

create or replace function bpw.can_manage_team(p_team_id uuid)
returns boolean language sql security definer stable set search_path = bpw, public as $$
  select exists (select 1 from bpw.team_members
    where team_id = p_team_id and user_id = auth.uid() and status = 'active'
      and role in ('owner', 'admin'));
$$;

create or replace function bpw.can_score_team(p_team_id uuid)
returns boolean language sql security definer stable set search_path = bpw, public as $$
  select exists (select 1 from bpw.team_members
    where team_id = p_team_id and user_id = auth.uid() and status = 'active'
      and role in ('owner', 'admin', 'scorer'));
$$;

-- ---------- widen owns_game(): owner OR a scorer+ member of either team ----------
create or replace function bpw.owns_game(p_game_id uuid)
returns boolean language sql security definer stable set search_path = bpw, public as $$
  select exists (
    select 1 from bpw.games g
    where g.id = p_game_id
      and ( g.owner_id = auth.uid()
            or bpw.can_score_team(g.home_team_id)
            or bpw.can_score_team(g.away_team_id) )
  );
$$;

-- ---------- RLS on the new tables ----------
alter table bpw.team_members enable row level security;
alter table bpw.team_invites enable row level security;

drop policy if exists tm_select on bpw.team_members;
create policy tm_select on bpw.team_members
  for select using (bpw.is_team_member(team_id));

drop policy if exists tm_manage on bpw.team_members;
create policy tm_manage on bpw.team_members
  for all using (bpw.can_manage_team(team_id)) with check (bpw.can_manage_team(team_id));

drop policy if exists ti_manage on bpw.team_invites;
create policy ti_manage on bpw.team_invites
  for all using (bpw.can_manage_team(team_id)) with check (bpw.can_manage_team(team_id));

-- ---------- widen teams / players / games policies to roles ----------
-- teams: any member reads; owner/admin edits; only owner deletes; insert = your own.
drop policy if exists teams_owner_all on bpw.teams;
drop policy if exists teams_select on bpw.teams;
drop policy if exists teams_insert on bpw.teams;
drop policy if exists teams_update on bpw.teams;
drop policy if exists teams_delete on bpw.teams;
create policy teams_select on bpw.teams for select using (bpw.is_team_member(id));
create policy teams_insert on bpw.teams for insert with check (owner_id = auth.uid());
create policy teams_update on bpw.teams for update using (bpw.can_manage_team(id)) with check (bpw.can_manage_team(id));
create policy teams_delete on bpw.teams for delete using (bpw.role_on_team(id) = 'owner');

-- players (roster): members read; owner/admin manage.
drop policy if exists players_owner_all on bpw.players;
drop policy if exists players_select on bpw.players;
drop policy if exists players_write on bpw.players;
create policy players_select on bpw.players for select using (bpw.is_team_member(team_id));
create policy players_write on bpw.players for all
  using (bpw.can_manage_team(team_id)) with check (bpw.can_manage_team(team_id));

-- games: select/update/delete via the widened owns_game(); insert stays "your own game".
drop policy if exists games_owner_all on bpw.games;
drop policy if exists games_select on bpw.games;
drop policy if exists games_insert on bpw.games;
drop policy if exists games_update on bpw.games;
drop policy if exists games_delete on bpw.games;
create policy games_select on bpw.games for select using (bpw.owns_game(id));
create policy games_insert on bpw.games for insert with check (owner_id = auth.uid());
create policy games_update on bpw.games for update using (bpw.owns_game(id)) with check (bpw.owns_game(id));
create policy games_delete on bpw.games for delete using (bpw.owns_game(id));

-- ---------- invite RPCs ----------
-- Create an invite (owner/admin only). Returns the token; the app builds the link.
create or replace function bpw.create_team_invite(
  p_team_id   uuid,
  p_role      bpw.team_role default 'scorer',
  p_email     text default null,
  p_expires_at timestamptz default null,
  p_max_uses  int default null
) returns text language plpgsql security definer set search_path = bpw, public as $$
declare v_token text;
begin
  if not bpw.can_manage_team(p_team_id) then
    raise exception 'not authorized to invite to this team';
  end if;
  insert into bpw.team_invites (team_id, role, email, expires_at, max_uses, created_by)
  values (p_team_id, p_role, p_email, p_expires_at, p_max_uses, auth.uid())
  returning token into v_token;
  return v_token;
end $$;

-- Accept an invite: validate + add the signed-in user as a member.
create or replace function bpw.accept_team_invite(p_token text)
returns uuid language plpgsql security definer set search_path = bpw, public as $$
declare inv bpw.team_invites; uid uuid := auth.uid(); uemail text := auth.jwt() ->> 'email';
begin
  if uid is null then raise exception 'must be signed in'; end if;
  select * into inv from bpw.team_invites where token = p_token;
  if inv.id is null then raise exception 'invalid invite'; end if;
  if inv.revoked_at is not null then raise exception 'invite revoked'; end if;
  if inv.expires_at is not null and inv.expires_at < now() then raise exception 'invite expired'; end if;
  if inv.max_uses is not null and inv.uses >= inv.max_uses then raise exception 'invite already used up'; end if;
  if inv.email is not null and lower(inv.email) <> lower(coalesce(uemail, '')) then
    raise exception 'this invite is for a different email';
  end if;
  insert into bpw.team_members (team_id, user_id, role, status, invited_by)
  values (inv.team_id, uid, inv.role, 'active', inv.created_by)
  on conflict (team_id, user_id) do update set role = excluded.role, status = 'active';
  update bpw.team_invites set uses = uses + 1 where id = inv.id;
  return inv.team_id;
end $$;

revoke all on function bpw.create_team_invite(uuid, bpw.team_role, text, timestamptz, int) from public;
grant execute on function bpw.create_team_invite(uuid, bpw.team_role, text, timestamptz, int) to authenticated;
revoke all on function bpw.accept_team_invite(text) from public;
grant execute on function bpw.accept_team_invite(text) to authenticated;

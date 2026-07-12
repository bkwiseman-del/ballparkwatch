-- =====================================================================
-- Part B / B0 increment 1 — the ORGANIZATION above teams (rollout plan Part B, doc 2 §2).
--
-- The league layer's spine starts here: an Organization (league / club / tournament / facility)
-- that owns teams. This is STRICTLY ADDITIVE — teams gain a NULLABLE org_id, so every existing
-- standalone, owner-owned team (org_id IS NULL) behaves exactly as before. Org-scoped role grants
-- live in a NEW org_members table, separate from the team-scoped team_members; team membership is
-- untouched.
--
-- Reconciliation decisions (documented on purpose):
--   * The existing bpw.seasons table is a flat GLOBAL reference calendar (year/term/label) referenced
--     by teams.season_id. It is NOT doc 2's org-owned Season. Left untouched here; org-owned seasons +
--     divisions arrive in the next increment and reference an Organization.
--   * Doc 2 §1 wants grants scoped to (org, season). Season-scoping is DEFERRED until org-seasons exist;
--     for now grants are org-scoped (a strict subset we can refine by adding season_id later).
--
-- RLS note: new permissive policies are OR'd with existing ones, so org-admin access is added WITHOUT
-- weakening any existing owner/member policy. Additive + idempotent. Apply via the Supabase SQL editor.
-- =====================================================================

-- ---- enums ---------------------------------------------------------------------------------------
do $$ begin
  create type bpw.org_type as enum ('league', 'club', 'tournament', 'facility');
exception when duplicate_object then null; end $$;

do $$ begin
  -- org_admin: full control of the org. division_coordinator: scoped to a division (division ref
  -- arrives with the divisions table; for now it is a grant we can later constrain).
  create type bpw.org_role as enum ('org_admin', 'division_coordinator');
exception when duplicate_object then null; end $$;

-- ---- organizations -------------------------------------------------------------------------------
create table if not exists bpw.organizations (
  id                uuid primary key default gen_random_uuid(),
  type              bpw.org_type not null default 'league',
  name              text not null,
  slug              text unique,                 -- future leaguename.bandbox.app
  branding          jsonb not null default '{}'::jsonb, -- logo/colors/hero/tagline (public site later)
  stripe_account_id text,                         -- Stripe Connect id, set at B1 registration onboarding
  created_by        uuid not null references auth.users (id),
  created_at        timestamptz not null default now()
);

-- ---- org role grants (org-scoped; separate from team_members) -------------------------------------
create table if not exists bpw.org_members (
  org_id     uuid not null references bpw.organizations (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       bpw.org_role not null default 'org_admin',
  status     text not null default 'active',      -- active | removed
  invited_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists org_members_user_idx on bpw.org_members (user_id) where status = 'active';

-- ---- attach teams to an org (NULLABLE — standalone teams keep working) ----------------------------
alter table bpw.teams
  add column if not exists org_id uuid references bpw.organizations (id);
create index if not exists teams_org_idx on bpw.teams (org_id);

-- ---- helpers (security definer; RLS calls these) -------------------------------------------------
create or replace function bpw.is_org_member(p_org_id uuid)
returns boolean language sql stable security definer set search_path = bpw, public as $$
  select exists (
    select 1 from bpw.org_members m
    where m.org_id = p_org_id and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

create or replace function bpw.is_org_admin(p_org_id uuid)
returns boolean language sql stable security definer set search_path = bpw, public as $$
  select exists (
    select 1 from bpw.org_members m
    where m.org_id = p_org_id and m.user_id = auth.uid()
      and m.status = 'active' and m.role = 'org_admin'
  );
$$;

-- Whoever creates an Organization becomes its first org_admin (mirrors teams' add_owner_member).
create or replace function bpw.add_org_admin()
returns trigger language plpgsql security definer set search_path = bpw, public as $$
begin
  insert into bpw.org_members (org_id, user_id, role, status, invited_by)
  values (new.id, new.created_by, 'org_admin', 'active', new.created_by)
  on conflict (org_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_add_org_admin on bpw.organizations;
create trigger trg_add_org_admin after insert on bpw.organizations
  for each row execute function bpw.add_org_admin();

-- ---- RLS -----------------------------------------------------------------------------------------
alter table bpw.organizations enable row level security;
alter table bpw.org_members  enable row level security;

-- organizations: members read; anyone signed-in can create (they become admin via trigger);
-- admins update/delete. (Public read for the future public site is a later, explicit addition.)
drop policy if exists org_select on bpw.organizations;
create policy org_select on bpw.organizations for select
  using (bpw.is_org_member(id) or created_by = auth.uid());

drop policy if exists org_insert on bpw.organizations;
create policy org_insert on bpw.organizations for insert
  with check (created_by = auth.uid());

drop policy if exists org_update on bpw.organizations;
create policy org_update on bpw.organizations for update
  using (bpw.is_org_admin(id)) with check (bpw.is_org_admin(id));

drop policy if exists org_delete on bpw.organizations;
create policy org_delete on bpw.organizations for delete
  using (bpw.is_org_admin(id));

-- org_members: a member can see co-members of orgs they belong to; admins manage grants.
drop policy if exists org_members_select on bpw.org_members;
create policy org_members_select on bpw.org_members for select
  using (bpw.is_org_member(org_id));

drop policy if exists org_members_write on bpw.org_members;
create policy org_members_write on bpw.org_members for all
  using (bpw.is_org_admin(org_id)) with check (bpw.is_org_admin(org_id));

-- teams: ADD an org-admin lane on top of the existing owner/member policies (OR'd, so additive).
-- An org admin can read + manage teams that belong to their org.
drop policy if exists teams_org_admin_select on bpw.teams;
create policy teams_org_admin_select on bpw.teams for select
  using (org_id is not null and bpw.is_org_admin(org_id));

drop policy if exists teams_org_admin_write on bpw.teams;
create policy teams_org_admin_write on bpw.teams for all
  using (org_id is not null and bpw.is_org_admin(org_id))
  with check (org_id is not null and bpw.is_org_admin(org_id));

grant execute on function bpw.is_org_member(uuid)  to authenticated;
grant execute on function bpw.is_org_admin(uuid)   to authenticated;

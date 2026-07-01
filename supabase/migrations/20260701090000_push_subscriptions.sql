-- =====================================================================
-- Web push subscriptions — Increment 6 of the family epic. Stores each device's
-- push endpoint so the send-push edge function can notify a team (game going live,
-- new announcement, schedule change). iOS only delivers to an INSTALLED PWA.
--
-- NON-DESTRUCTIVE: new table + one service-role RPC. Apply via the SQL editor.
-- =====================================================================

create table if not exists bpw.push_subscriptions (
  endpoint   text primary key,        -- unique per device/browser
  user_id    uuid not null references auth.users (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on bpw.push_subscriptions (user_id);

alter table bpw.push_subscriptions enable row level security;
revoke all on bpw.push_subscriptions from anon;

-- You manage only your own device subscriptions.
drop policy if exists push_sub_rw on bpw.push_subscriptions;
create policy push_sub_rw on bpw.push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The send-push function (service role) needs to read subscriptions.
grant select on bpw.push_subscriptions to service_role;

-- All push endpoints for a team's active members, optionally excluding one user
-- (e.g. don't notify the person who posted). Service-role only — never exposed to
-- clients, so family can't harvest each other's endpoints. Authorization that the
-- CALLER may notify this team is enforced in the edge function (is_team_staff).
create or replace function bpw.push_targets_for_team(p_team_id uuid, p_exclude uuid default null)
returns table (endpoint text, p256dh text, auth text)
language sql security definer stable set search_path = bpw, public as $$
  select s.endpoint, s.p256dh, s.auth
  from bpw.push_subscriptions s
  join bpw.team_members m on m.user_id = s.user_id
  where m.team_id = p_team_id and m.status = 'active'
    and (p_exclude is null or s.user_id <> p_exclude);
$$;
revoke all on function bpw.push_targets_for_team(uuid, uuid) from public, anon, authenticated;
grant execute on function bpw.push_targets_for_team(uuid, uuid) to service_role;

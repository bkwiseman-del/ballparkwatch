-- Membership UI support + access for invited delegates.
-- Apply via the Supabase SQL editor (shared schema; see CLAUDE.md).

-- List a team's active members WITH their emails (security definer reads auth.users).
-- Only members of the team see the list.
create or replace function bpw.team_members_list(p_team_id uuid)
returns table (user_id uuid, email text, role bpw.team_role, status text, is_self boolean)
language sql security definer stable set search_path = bpw, public as $$
  select m.user_id, u.email::text, m.role, m.status, (m.user_id = auth.uid())
  from bpw.team_members m
  join auth.users u on u.id = m.user_id
  where m.team_id = p_team_id
    and m.status = 'active'
    and bpw.is_team_member(p_team_id)
  order by case m.role
             when 'owner' then 0 when 'admin' then 1 when 'scorer' then 2 else 3
           end, u.email;
$$;
revoke all on function bpw.team_members_list(uuid) from public;
grant execute on function bpw.team_members_list(uuid) to authenticated;

-- Being an active member of any team also grants beta access — so a delegate who
-- accepts an invite can use the app without being added to the email allowlist.
create or replace function bpw.has_app_access()
returns boolean language sql security definer stable set search_path = bpw, public as $$
  select exists (
    select 1 from bpw.app_access
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  ) or exists (
    select 1 from bpw.team_members
    where user_id = auth.uid() and status = 'active'
  );
$$;
revoke all on function bpw.has_app_access() from public;
grant execute on function bpw.has_app_access() to authenticated;

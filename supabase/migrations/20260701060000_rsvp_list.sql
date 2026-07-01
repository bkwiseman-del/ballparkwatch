-- =====================================================================
-- RSVP roster — let staff see WHO responded (not just a count). Families still
-- see only the aggregate count; the named list is staff-only (minors' families).
--
-- NON-DESTRUCTIVE: adds an is_team_staff() helper + rsvp_list() RPC. Nothing altered.
-- Apply via the Supabase SQL editor (shared schema; see CLAUDE.md).
-- =====================================================================

-- Staff = an active member who ISN'T family (owner/admin/scorer/broadcaster).
create or replace function bpw.is_team_staff(p_team_id uuid)
returns boolean language sql security definer stable set search_path = bpw, public as $$
  select exists (
    select 1 from bpw.team_members
    where team_id = p_team_id and user_id = auth.uid()
      and status = 'active' and role <> 'family'
  );
$$;
revoke all on function bpw.is_team_staff(uuid) from public, anon;
grant execute on function bpw.is_team_staff(uuid) to authenticated;

-- The named responders for one game/practice — staff only. Returns a friendly name
-- (Google full name, else the email) with each person's status.
create or replace function bpw.rsvp_list(p_team_id uuid, p_target_type text, p_target_id uuid)
returns table (user_id uuid, name text, status text)
language sql security definer stable set search_path = bpw, public as $$
  select r.user_id,
         coalesce(
           nullif(u.raw_user_meta_data->>'full_name', ''),
           nullif(u.raw_user_meta_data->>'name', ''),
           u.email
         ) as name,
         r.status
  from bpw.rsvps r
  join auth.users u on u.id = r.user_id
  where r.team_id = p_team_id
    and r.target_type = p_target_type
    and r.target_id = p_target_id
    and bpw.is_team_staff(p_team_id)
  order by
    case r.status when 'going' then 0 when 'maybe' then 1 else 2 end,
    name;
$$;
revoke all on function bpw.rsvp_list(uuid, text, uuid) from public, anon;
grant execute on function bpw.rsvp_list(uuid, text, uuid) to authenticated;

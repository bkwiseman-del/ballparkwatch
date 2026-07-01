-- =====================================================================
-- Add a distinct 'coach' team role. Admin is a management role that some non-coach
-- parents/managers hold; coach is for people who actually run the team on the field.
-- A coach can score, set lineups, post announcements, see attendance, AND manage the
-- roster/schedule (same team-running power as admin) — the difference is the label.
--
-- NON-DESTRUCTIVE: adds an enum value + widens two role helpers (access only grows).
-- Apply via the Supabase SQL editor. NOTE: the enum ADD VALUE must be run/committed
-- BEFORE the function bodies that reference 'coach' (two statements).
-- =====================================================================

-- Statement 1 (run first, on its own):
alter type bpw.team_role add value if not exists 'coach';

-- Statement 2 (after the value is committed):
create or replace function bpw.can_manage_team(p_team_id uuid)
returns boolean language sql security definer stable set search_path = bpw, public as $$
  select exists (select 1 from bpw.team_members
    where team_id = p_team_id and user_id = auth.uid() and status = 'active'
      and role in ('owner', 'admin', 'coach'));
$$;

create or replace function bpw.can_score_team(p_team_id uuid)
returns boolean language sql security definer stable set search_path = bpw, public as $$
  select exists (select 1 from bpw.team_members
    where team_id = p_team_id and user_id = auth.uid() and status = 'active'
      and role in ('owner', 'admin', 'coach', 'scorer'));
$$;

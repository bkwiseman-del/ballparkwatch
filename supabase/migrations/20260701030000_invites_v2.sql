-- =====================================================================
-- Invites v2 — Increment 2 of the family-member epic (plan §9).
-- Invites are now email-addressed (you invite a person, not just mint a link an
-- open link anyone can forward), carry a role (incl. the new 'family'), and are
-- listable + revocable by team managers. The link stays as a fallback, but the
-- default flow emails the person (see the send-invite edge function).
--
-- NON-DESTRUCTIVE: adds two RPCs only. team_invites already exists and already
-- has an `email` column + email-match check on accept (20260630000000). No
-- table/policy is dropped or altered.
-- Apply via the Supabase SQL editor (shared schema; see CLAUDE.md).
-- =====================================================================

-- List a team's still-open invites (manager only). "Open" = not revoked, not
-- expired, not used up — i.e. someone we're still waiting on.
create or replace function bpw.team_invites_list(p_team_id uuid)
returns table (
  id uuid, email text, role bpw.team_role, token text,
  uses int, max_uses int, expires_at timestamptz, created_at timestamptz
) language sql security definer stable set search_path = bpw, public as $$
  select i.id, i.email, i.role, i.token, i.uses, i.max_uses, i.expires_at, i.created_at
  from bpw.team_invites i
  where i.team_id = p_team_id
    and bpw.can_manage_team(p_team_id)
    and i.revoked_at is null
    and (i.expires_at is null or i.expires_at > now())
    and (i.max_uses is null or i.uses < i.max_uses)
  order by i.created_at desc;
$$;
revoke all on function bpw.team_invites_list(uuid) from public, anon;
grant execute on function bpw.team_invites_list(uuid) to authenticated;

-- Revoke an outstanding invite (manager only).
create or replace function bpw.revoke_team_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path = bpw, public as $$
declare tid uuid;
begin
  select team_id into tid from bpw.team_invites where id = p_invite_id;
  if tid is null then raise exception 'invite not found'; end if;
  if not bpw.can_manage_team(tid) then raise exception 'not authorized'; end if;
  update bpw.team_invites set revoked_at = now() where id = p_invite_id;
end $$;
revoke all on function bpw.revoke_team_invite(uuid) from public, anon;
grant execute on function bpw.revoke_team_invite(uuid) to authenticated;

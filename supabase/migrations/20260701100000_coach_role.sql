-- =====================================================================
-- Reserved 'coach' enum value only. We briefly added Coach as a separate assignable
-- role, then reverted: "Coach" is just listed in the Admin role's description, not a
-- distinct role (an admin IS the coach in practice). The enum value stays (Postgres
-- can't easily drop enum values) but is UNUSED — no member is assigned it and the
-- role helpers were reverted to their original (owner/admin, owner/admin/scorer).
-- Harmless/orphaned; kept here to document the live DB state.
-- =====================================================================

alter type bpw.team_role add value if not exists 'coach';
-- (can_manage_team / can_score_team intentionally NOT widened — see 20260630000000.)

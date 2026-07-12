-- =====================================================================
-- Part B / B0 increment 3 — MULTI-GUARDIAN + player league-age (rollout plan Part B, doc 2 §2, §3.2).
--
-- Doc 2's headline fix: every guardian is a full, independent account, and a player can have several
-- (two households, a grandparent caregiver). The existing bpw.member_players table already links
-- Player ↔ User with PK (user_id, player_id) — so multi-guardian is STRUCTURALLY already possible.
-- This increment turns member_players into doc 2's PlayerGuardian by ADDING guardian metadata
-- (relationship, is_primary, notify_prefs) rather than creating a parallel table — keeping the
-- family-follower features that already read member_players working untouched.
--
-- Also adds players.dob (nullable) so league age / division auto-suggest (B1 rollover) can derive it,
-- and a players.privacy jsonb bag for per-player/per-family privacy flags (populated during the B1
-- consent work; the seam exists now). The email-invite-a-guardian flow and registration-canonical
-- merge (doc 2 §3.2) are B1. Additive + idempotent. Apply via the Supabase SQL editor.
-- =====================================================================

-- ---- players: birthdate (→ derived league age) + privacy flag bag -------------------------------
alter table bpw.players
  add column if not exists dob     date,
  add column if not exists privacy jsonb not null default '{}'::jsonb;

-- ---- member_players → PlayerGuardian: add guardian metadata --------------------------------------
-- relationship: 'parent' | 'guardian' | 'grandparent' | … (free text; UI offers common values).
-- is_primary: the primary contact for the player (billing/registration default in B1).
-- notify_prefs: per-guardian channel prefs consumed by the B1 notifications engine.
alter table bpw.member_players
  add column if not exists relationship text,
  add column if not exists is_primary   boolean not null default false,
  add column if not exists notify_prefs  jsonb   not null default '{}'::jsonb;

-- At most one primary guardian per player (partial unique; existing rows default is_primary=false,
-- so this can't collide on apply).
create unique index if not exists member_players_one_primary
  on bpw.member_players (player_id) where is_primary;

comment on table bpw.member_players is
  'Player ↔ guardian link (doc 2 PlayerGuardian). PK (user_id, player_id) allows many guardians per '
  'player; is_primary marks the primary contact; also serves the family-follower "my kids" feature.';

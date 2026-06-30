-- Consent attestation audit (plan §4): when an admin makes a team public/discoverable
-- they must confirm they hold family permission; we record who/when as the audit trail.
alter table bpw.teams
  add column if not exists consent_ack_at timestamptz,
  add column if not exists consent_ack_by uuid references auth.users (id);

-- Seasons as a named SPAN, not a rigid (year, term) pair — so we can represent Fall
-- Ball, cross-year travel/club seasons (Aug→Jul), and a league's own calendar.
-- (ALTER TYPE ADD VALUE must be its own statement; applied separately.)
alter type bpw.season_term add value if not exists 'year_round';

-- Drop the rigid uniqueness; a season is now a named span (label + anchor year +
-- loose term + optional exact dates + optional owner for custom/league seasons).
alter table bpw.seasons drop constraint if exists seasons_year_term_key;
alter table bpw.seasons
  add column if not exists starts_on date,
  add column if not exists ends_on   date,
  add column if not exists owner_id  uuid references auth.users (id);

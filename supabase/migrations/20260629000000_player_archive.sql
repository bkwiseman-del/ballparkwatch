-- Bandbox — soft-delete (archive) for players.
-- A player who has appeared in a scored game can't be hard-deleted (game_events
-- references players, no cascade — we keep history immutable). Instead we archive
-- them: they stay intact in past games but drop out of new lineups/rosters.
alter table bpw.players add column if not exists archived_at timestamptz;

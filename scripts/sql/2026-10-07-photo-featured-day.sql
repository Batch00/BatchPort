-- Curate: an explicit day for an UNDATED stop pick.
--
-- Run this in the Supabase dashboard SQL editor. Safe to re-run.
--
-- One nullable column on batchport.photos, the same table the curation
-- columns (featured_rank, featured_slot) already live on. No view changes, no
-- backfill: null means "Auto", which is exactly how every existing pick
-- already behaves.
--
-- WHAT IT HOLDS
--
-- The day slide (a stop's own calendar day) a stop pick with no usable date
-- was assigned to in Curate. "No usable date" is undated, or dated outside
-- the days that stay owns. A pick dated inside its stay is locked to its own
-- day and this column is ignored for it. A value naming a day that is no
-- longer one of the stop's days (its dates were edited) also reads as Auto.
-- See distributeStopPhotos in src/lib/curation.ts for the full rule.
--
-- It is a date, not an offset from arrival, so editing a stop's arrival does
-- not silently move every assigned photo to a different day.
--
-- BEFORE THIS RUNS
--
-- The app degrades cleanly: every photo read tries featured_day, then the
-- curation columns alone, then the base columns (42703 at each step), so
-- curation keeps working and every pick behaves as Auto. The day selector's
-- save reports "not set up" rather than pretending to have saved.
--
-- RLS: no change. The existing photos policies cover the new column.

alter table batchport.photos
  add column if not exists featured_day date;

comment on column batchport.photos.featured_day is
  'Curate: explicit day slide for an undated stop pick; null = Auto. Ignored for picks dated inside their stay.';

-- Verify:
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'batchport' and table_name = 'photos'
--     and column_name = 'featured_day';

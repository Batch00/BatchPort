-- Bucket list notes column.
--
-- The bucket list revamp adds an optional free-text note per item ("Why this
-- place?"). Run in the Supabase SQL editor. Until this runs, the app still
-- works: notes read as empty and saving an item silently drops the note text
-- (the write retries without the column).

alter table batchport.bucket_list
  add column if not exists notes text;

-- Priority semantics note (no schema change needed): priority remains an
-- integer where HIGHER sorts first, but it is now written by drag-to-rank on
-- the bucket list page (top card gets the largest value) instead of the old
-- 1-5 picker. Legacy 1-5 values keep their relative order and are rewritten
-- in full the first time the user drags a card.

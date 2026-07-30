-- Global search indexes.
--
-- The in-app search (nav search icon / Cmd+K) matches the user's own trip,
-- destination, experience, and bucket list names and notes with ILIKE
-- '%term%'. A leading wildcard makes a btree index useless, so these are
-- pg_trgm GIN indexes, which do serve unanchored ILIKE.
--
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- Nothing degrades without this: the queries return the same rows, they just
-- sequential-scan. At personal-travel-tracker row counts that is fine, so
-- treat this as a "run it when the tables grow" file rather than a blocker.

create extension if not exists pg_trgm;

-- Names: the primary match target for every entity type.
create index if not exists trips_name_trgm_idx
  on batchport.trips using gin (name gin_trgm_ops);

create index if not exists destinations_name_trgm_idx
  on batchport.destinations using gin (name gin_trgm_ops);

create index if not exists experiences_name_trgm_idx
  on batchport.experiences using gin (name gin_trgm_ops);

create index if not exists bucket_list_place_name_trgm_idx
  on batchport.bucket_list using gin (place_name gin_trgm_ops);

-- Notes: free text, searched alongside names ("that restaurant in Rome" is
-- often only findable through a note).
create index if not exists trips_notes_trgm_idx
  on batchport.trips using gin (notes gin_trgm_ops);

create index if not exists destinations_notes_trgm_idx
  on batchport.destinations using gin (notes gin_trgm_ops);

create index if not exists experiences_notes_trgm_idx
  on batchport.experiences using gin (notes gin_trgm_ops);

-- bucket_list.notes is added by 2026-07-16-bucket-notes.sql. Guarded so this
-- file still runs cleanly if that one has not been applied yet.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'batchport'
      and table_name = 'bucket_list'
      and column_name = 'notes'
  ) then
    create index if not exists bucket_list_notes_trgm_idx
      on batchport.bucket_list using gin (notes gin_trgm_ops);
  end if;
end $$;

-- Every search query is also filtered by user_id first. These btree indexes
-- likely already exist from the RLS policies; included for completeness.
create index if not exists trips_user_id_idx on batchport.trips (user_id);
create index if not exists destinations_user_id_idx on batchport.destinations (user_id);
create index if not exists experiences_user_id_idx on batchport.experiences (user_id);
create index if not exists bucket_list_user_id_idx on batchport.bucket_list (user_id);

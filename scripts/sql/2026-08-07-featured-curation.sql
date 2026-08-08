-- Curation: what represents a trip in the story, the recap, and the cards.
--
-- Ratings alone are the wrong selector. A five star museum and a five star
-- gelato are both five stars, and only one of them belongs on a share card.
-- This adds one column to each of the two things a traveller would want to
-- elect: an experience and a photo.
--
-- Run in the Supabase SQL editor.
--
-- WHY A RANK AND NOT A BOOLEAN
--
-- The surfaces that consume this are all "top N" surfaces: three highlights on
-- a share card, three moments in a recap, four photos on a story slide. A
-- boolean can say which items are candidates but not which of them leads, so
-- the app would have had to fall back to rating (the thing curation exists to
-- override) the moment more than three were marked. An integer answers both
-- questions with one column: null means not featured, and 1..N is the order.
--
-- Nothing enforces uniqueness. The app assigns the next free rank within the
-- trip when something is featured and breaks ties on name, so a duplicate rank
-- (two devices, one trip) is a cosmetic ordering question, never an error.
--
-- DEGRADATION BEFORE THIS RUNS
--
-- Experiences: reads select *, so a missing column reads as undefined and
-- normalizes to null (not featured). Featuring reports "Featuring is not set
-- up on this database yet" rather than pretending to have saved.
-- Photos: reads name their columns, so the curated reads ask for the column
-- and retry without it on 42703. Everything falls back to rating and to the
-- existing photo order, which is exactly the pre-curation behaviour.

-- 1. Experiences -------------------------------------------------------------

alter table batchport.experiences
  add column if not exists featured_rank smallint
  check (featured_rank is null or featured_rank > 0);

comment on column batchport.experiences.featured_rank is
  'Curation order for the story, the year recap, and the share cards. Null = not featured; 1 = first. Scoped to the owning trip.';

-- 2. Photos ------------------------------------------------------------------

alter table batchport.photos
  add column if not exists featured_rank smallint
  check (featured_rank is null or featured_rank > 0);

comment on column batchport.photos.featured_rank is
  'Curation order for the story and the year recap. Null = not featured; 1 = first. Scoped to the owning trip.';

-- 3. Indexes -----------------------------------------------------------------
--
-- Partial: only featured rows are ever filtered on, and they are a handful per
-- trip. A full index on a mostly-null column would be dead weight.

create index if not exists experiences_featured_idx
  on batchport.experiences (user_id, featured_rank)
  where featured_rank is not null;

create index if not exists photos_featured_idx
  on batchport.photos (user_id, featured_rank)
  where featured_rank is not null;

-- Curation slots: giving a featured rank somewhere to be a rank IN.
--
-- Run in the Supabase SQL editor, after 2026-08-07-featured-curation.sql.
--
-- WHAT CHANGED AND WHY
--
-- The first version of curation stored one integer per experience and one per
-- photo, both scoped to the trip, and offered a "Feature in story" toggle in an
-- overflow menu. The model was sound and the affordance was not: featuring
-- something produced no visible position, no way to see what else was in the
-- running, and no statement of which surface it had changed. Worse, a photo's
-- rank was answering two different questions at once ("open the recap with
-- this" and "lead this stop's slides with this") with one number.
--
-- So the ranks now belong to named slots, and this file adds the one column
-- that was missing to tell a photo's two slots apart:
--
--   photos.featured_slot = 'hero'  one per trip. The Year in Travel recap's
--                                  opening frame, and the share card's
--                                  backdrop. featured_rank is always 1.
--   photos.featured_slot = 'stop'  up to four per DESTINATION, ranked 1..4
--                                  within it. The photos that lead that stop's
--                                  slides in the trip story.
--
-- experiences.featured_rank is unchanged: it is the trip's three highlights,
-- ranked across the trip, which is exactly what it already was.
--
-- NOTE ON SCOPE. A photo's featured_rank was previously "one past the highest
-- rank anywhere on this trip". For stop picks it is now a rank within the
-- destination, which is a reinterpretation of existing rows rather than a
-- rewrite of them: a stop holding ranks 2 and 5 still orders correctly, it just
-- reads as first and second at that stop. Nothing needs backfilling.
--
-- DEGRADATION BEFORE THIS RUNS
--
-- Photo reads name their columns, so the curated reads ask for featured_slot
-- and retry without it on 42703. A row with a rank and no slot reads as a stop
-- pick (see photoSlotOf in lib/curation.ts), which is what a bare rank meant
-- before slots existed, so every trip curated under the old model keeps
-- leading its story slides exactly as it did. The hero slot is simply empty
-- and both its consumers fall back as they did before it existed. Writing a
-- slot reports "Curation is not set up on this database yet" rather than
-- pretending to have saved.

-- 1. The slot discriminator ---------------------------------------------------

alter table batchport.photos
  add column if not exists featured_slot text
  check (featured_slot is null or featured_slot in ('hero', 'stop'));

comment on column batchport.photos.featured_slot is
  'Which curation slot this photo holds: hero (one per trip, the recap opener and share card backdrop) or stop (up to four per destination, leading that stop''s story slides). Null = not curated. See lib/curation.ts.';

comment on column batchport.photos.featured_rank is
  'Position within featured_slot; 1 leads. Hero is always 1. Stop picks are ranked within their destination. Null = not curated.';

-- 2. Index --------------------------------------------------------------------
--
-- Partial, for the same reason the rank index is: only curated rows are ever
-- filtered on and they are a handful per trip.

create index if not exists photos_featured_slot_idx
  on batchport.photos (user_id, featured_slot)
  where featured_slot is not null;

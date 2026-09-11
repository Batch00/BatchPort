-- Places, phase 1: country_code on the venue catalog, and a backfill.
--
-- Run this in the Supabase dashboard SQL editor (or psql). Safe to re-run, and
-- DESIGNED to be run twice: see "how to apply" below.
--
-- This ALTERs batchport.place_catalog_items, which is a places table created by
-- 2026-08-31-places-2-tables.sql and is still unshipped behind
-- NEXT_PUBLIC_PLACES_ENABLED. The "no ALTER TABLE" rule in CLAUDE.md is about
-- not reaching into the shipped schema from this feature; a places migration
-- altering its own phase 0 table is inside the feature's boundary. Nothing
-- outside places is touched.
--
-- WHY. places.locality_key is
--   lower(locality_name) | admin_region | country_code
-- and it is the dedup key the /places list groups on. The catalog CSVs carry
-- city and state but no country, so a venue picked from the catalog produced
-- "green bay|wisconsin|" while the same city picked from Photon (which does
-- return a country) produced "green bay|wisconsin|US". Lambeau Field and Green
-- Bay would have formed two groups that look identical on screen, silently.
--
-- The fix is in the data rather than in the entry sheet, because three
-- consumers need the same answer (the sheet, the stage 5 seed, and the list's
-- grouping) and three derivations drift. It is SOURCED, not inferred:
-- Wikidata P17 -> P297 gives an ISO 3166-1 alpha-2 for 671 of the 672 items
-- (664 US, 8 CA, and the two territory parks resolve to US). The one item with
-- no P17 is filled through scripts/data/catalog-overrides.csv, whose reason
-- column states the derivation.
--
-- HOW TO APPLY. The column is NOT NULL and the table already holds 672 rows,
-- so it cannot be added and constrained in one pass:
--
--   1. Run this file. It adds the column as NULLABLE and reports that the
--      NOT NULL step is still pending.
--   2. Run: npm run seed-place-catalogs
--   3. Run this file AGAIN. Every row now has a country, so it applies the
--      NOT NULL constraint and reports done.
--
-- Step 3 is not optional. Without it the column is merely usually populated,
-- which is the state this migration exists to get out of.

-- 1. The column -------------------------------------------------------------

alter table batchport.place_catalog_items
  add column if not exists country_code text;

comment on column batchport.place_catalog_items.country_code is
  'ISO 3166-1 alpha-2, sourced from Wikidata P17. Feeds places.country_code on a catalog pick, which feeds the generated locality_key.';

-- 2. NOT NULL, once the loader has populated it -----------------------------
--
-- Guarded rather than unconditional so the file is safe to run before the
-- loader, and so re-running it after the constraint exists is a no-op.

do $$
declare
  missing bigint;
  already boolean;
begin
  select count(*) into missing
  from batchport.place_catalog_items
  where country_code is null;

  select attnotnull into already
  from pg_attribute
  where attrelid = 'batchport.place_catalog_items'::regclass
    and attname = 'country_code';

  if already then
    raise notice 'country_code is already NOT NULL. Nothing to do.';
  elsif missing = 0 then
    alter table batchport.place_catalog_items
      alter column country_code set not null;
    raise notice 'country_code is now NOT NULL.';
  else
    raise notice
      'country_code left NULLABLE: % row(s) still have no country. Run npm run seed-place-catalogs, then run this file again.',
      missing;
  end if;
end
$$;

-- 3. Backfill the places already logged against a catalog venue -------------
--
-- places.locality_key is GENERATED ALWAYS AS STORED, so it recomputes from
-- this UPDATE by itself: "green bay|wisconsin|" becomes "green bay|wisconsin|US"
-- with no second statement and no relogging. Writing locality_key directly
-- would raise 428C9, which is the point of it being generated.
--
-- Only rows that are missing a country are touched, so a place whose country
-- came from Photon (or was corrected by hand) is left alone. Safe to re-run.

update batchport.places p
set country_code = c.country_code,
    updated_at = now()
from batchport.place_catalog_items c
where p.catalog_item_id = c.id
  and p.country_code is null
  and c.country_code is not null;

-- What the backfill did, and what is left.
do $$
declare
  remaining bigint;
begin
  select count(*) into remaining
  from batchport.places
  where country_code is null and catalog_item_id is not null;
  raise notice 'places linked to a catalog venue still missing a country: %', remaining;
end
$$;

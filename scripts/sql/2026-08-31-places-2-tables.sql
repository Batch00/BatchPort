-- Places, migration 2 of 4: tables.
--
-- Run this in the Supabase dashboard SQL editor (or psql). Safe to re-run.
-- Requires migration 1 (postgis, batchport.place_type).
--
-- Design notes worth keeping with the schema:
--
--  * A VENUE IS ONE ROW, AND CATALOG MEMBERSHIP IS A JOIN TABLE. The prepared
--    CSVs carry a venue in every catalog file it belongs to, so Fiserv Forum
--    is in nba.csv and ncaa_basketball_arenas.csv, Crypto.com Arena is in
--    nba.csv and nhl.csv, and Madison Square Garden is in three files. That
--    duplication is a property of a file per catalog, not of the world: there
--    is one building. It collapses at load, keyed on wikidata_qid, and the
--    membership rows carry what the duplication was expressing. 695 CSV rows
--    become 672 items and 695 memberships.
--
--  * TENANTS HANG OFF THE VENUE, NOT OFF THE MEMBERSHIP. The Bucks and
--    Marquette both play at Fiserv Forum; that is one fact about a building,
--    not one fact per catalog. The CSVs already carry the union in every file
--    they appear in (identical in both, which scripts/data/README.md makes an
--    invariant and the loader re-asserts), so the union is what gets stored.
--    Putting tenants on the membership would mean asking "which tenants,
--    according to which catalog", a question nothing has.
--
--  * places IS USER DATA, place_catalog_items IS REFERENCE DATA, and the
--    nullable FK between them is the whole point. A user's visit to Fiserv
--    Forum links to the catalog item and inherits its coordinate; a user's
--    "my grandmother's house" is a place with a null catalog_item_id and is
--    just as real. Nothing requires a place to be in a catalog, and the
--    catalog is never written by a user.
--
--  * place_visits HAS user_id EVEN THOUGH places DOES. Denormalized so the
--    RLS policy on visits is a column check rather than a subquery through
--    places, exactly as transport_legs denormalizes trip_id off the
--    destination. Nothing moves a visit between users, so the copy cannot
--    drift.
--
--  * trip_id IS AN FK *FROM* place_visits. trips is not modified by any file
--    in this migration set. A visit may belong to a trip (a stadium on a road
--    trip) or to no trip at all (a game in your own city on a Tuesday), which
--    is why it is nullable, and why the arrow points this way: making trips
--    aware of places would be an ALTER TABLE on an existing table.

-- 1. Reference: occasions ---------------------------------------------------
--
-- Why you were there. Seeded by scripts/seed-occasions.ts and edited by
-- nothing, mirroring batchport.expense_groups.

create table if not exists batchport.occasions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  icon text,
  color text,
  sort_order integer not null default 0
);

-- 2. Reference: the venue catalogs ------------------------------------------

create table if not exists batchport.place_catalogs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  -- What "all of them" means for this catalog, in words, because the honest
  -- denominator is not always the obvious one: the NFL has 32 teams and 30
  -- buildings, and a completion percentage against the wrong number is a
  -- number nobody can check. Carried as prose rather than an integer so a
  -- surface has to quote it rather than quietly divide by it.
  denominator_note text,
  sort_order integer not null default 0
);

-- One row per BUILDING (or park), keyed on its Wikidata item. Loaded by
-- scripts/seed-place-catalogs.ts from scripts/data/*.csv.
create table if not exists batchport.place_catalog_items (
  id uuid primary key default gen_random_uuid(),
  -- The identity key, and the reason the loader can collapse a venue that
  -- appears in several files. Not a name: three different buildings are
  -- called Convocation Center, and two are called Moody Coliseum.
  wikidata_qid text not null unique,
  name text not null,
  -- NOT NULL is the schema half of "fail loudly on a null geom". Every
  -- coordinate in the CSVs came from a Wikidata P625 SPARQL result; a venue
  -- that returned without one is in scripts/data/missing-coords.csv and is
  -- deliberately not loaded until somebody fills it in by hand.
  geom geography(Point, 4326) not null,
  city text,
  state text,
  -- The union of every team that plays here. Pipe delimited in the CSVs, an
  -- array here, because "does the user's team play here" is a containment
  -- test and not a substring search.
  tenants text[] not null default '{}',
  -- Room for per-catalog facts that do not deserve a column yet (capacity,
  -- opened year, NPS unit code). Empty today.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The ONLY place catalog membership is expressed.
create table if not exists batchport.place_catalog_item_memberships (
  id uuid primary key default gen_random_uuid(),
  catalog_item_id uuid not null
    references batchport.place_catalog_items (id) on delete cascade,
  catalog_id uuid not null
    references batchport.place_catalogs (id) on delete cascade,
  constraint place_catalog_item_memberships_unique
    unique (catalog_item_id, catalog_id)
);

create index if not exists place_catalog_item_memberships_catalog_idx
  on batchport.place_catalog_item_memberships (catalog_id);

-- 3. Reference: admin-1 boundaries ------------------------------------------
--
-- Loaded by scripts/load-admin1.ts from scripts/data/us-admin1.geojson (US
-- Census cb_2023_us_state_500k, 50 states plus DC, geometry unsimplified).
-- country_code is here so this table can hold a second country later without
-- a migration; today every row is 'US'.
create table if not exists batchport.admin1_boundaries (
  id uuid primary key default gen_random_uuid(),
  country_code text not null,
  -- Postal-style code within the country: 'CA', 'NY', 'DC'.
  code text not null,
  name text not null,
  boundary geography(MultiPolygon, 4326) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin1_boundaries_unique unique (country_code, code)
);

-- 3b. The admin-1 loader's one affordance -----------------------------------
--
-- scripts/load-admin1.ts talks to PostgREST like every other seed script in
-- this repo, and PostgREST cannot call ST_GeomFromGeoJSON in an insert. The
-- alternatives were to ship the boundaries as multi-megabyte WKT strings (a
-- second encoding of the same geometry, and one nobody can eyeball) or to
-- require psql for this one file. This function is the third option: the
-- loader posts the feature's geometry as jsonb and PostGIS parses it.
--
-- ST_Multi normalizes the single-Polygon states (the Census file mixes Polygon
-- and MultiPolygon) so the column type can stay MultiPolygon. Nothing here
-- simplifies: no ST_Simplify, no ST_MakeValid, no snapping. The vertices that
-- go in are the vertices that come out.
--
-- SECURITY DEFINER is deliberately NOT used. This writes reference data, so it
-- should run with exactly the caller's rights and be callable only by the
-- service role.

create or replace function batchport.upsert_admin1_boundary(
  p_country_code text,
  p_code text,
  p_name text,
  p_geojson jsonb
)
returns void
language sql
as $$
  insert into batchport.admin1_boundaries (country_code, code, name, boundary)
  values (
    p_country_code,
    p_code,
    p_name,
    st_multi(st_setsrid(st_geomfromgeojson(p_geojson::text), 4326))::geography
  )
  on conflict (country_code, code) do update
    set name = excluded.name,
        boundary = excluded.boundary,
        updated_at = now();
$$;

revoke all on function batchport.upsert_admin1_boundary(text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function batchport.upsert_admin1_boundary(text, text, text, jsonb)
  to service_role;

-- 4. User data: places ------------------------------------------------------

create table if not exists batchport.places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  place_type batchport.place_type not null default 'other',
  geom geography(Point, 4326),
  country_code text,
  admin_region text,
  locality_name text,
  -- GENERATED, not written. The dedup key is derived from three columns that
  -- are right there in the row, so storing a hand-built copy would be a second
  -- answer to a question the row already answers, and it would drift the first
  -- time a locality is corrected. Same argument the codebase makes for trip
  -- dates and for a journal entry's stop.
  --
  -- NULL WHEN THERE IS NO LOCALITY, and that is the normal case for a stadium
  -- or a park, not a data problem. A missing region or country does not void
  -- the key, though, so those two coalesce to empty rather than propagating a
  -- null: "austin||" still dedups against itself.
  --
  -- Anything inserting into this table must OMIT this column (see the
  -- generated-column note in CLAUDE.md, which already applies to
  -- destinations.latitude/longitude).
  locality_key text generated always as (
    case
      when locality_name is null or btrim(locality_name) = '' then null
      else lower(btrim(locality_name))
           || '|' || coalesce(lower(btrim(admin_region)), '')
           || '|' || coalesce(upper(btrim(country_code)), '')
    end
  ) stored,
  -- Nullable on purpose: a place the user typed in is not in any catalog.
  -- ON DELETE SET NULL rather than cascade, because reloading the catalog must
  -- never delete somebody's visit history.
  catalog_item_id uuid
    references batchport.place_catalog_items (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 5. User data: place_visits ------------------------------------------------

create table if not exists batchport.place_visits (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references batchport.places (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  visit_date date not null,
  -- A visit that spanned days. Null means a single day, not "unknown".
  end_date date,
  occasion_id uuid references batchport.occasions (id),
  -- The free-text override beside the picked occasion, the same way
  -- expenses.vendor sits beside a category: "Dave and Priya's wedding" is
  -- what the user will search for, and the occasion is how it groups.
  occasion_label text,
  -- Populated only for game visits, null everywhere else. Kept as two plain
  -- columns rather than a jsonb blob because they are the two fields a game
  -- surface will actually filter and display.
  event_org text,
  event_detail text,
  -- Text with the same check list as batchport.transport_legs.mode. See the
  -- note at the bottom of migration 1: there is no enum to reuse, and adding
  -- one for this table alone would create the second definition the brief
  -- rules out.
  transport_mode text check (
    transport_mode is null
    or transport_mode in ('flight', 'train', 'bus', 'car', 'ferry', 'bike', 'walk', 'other')
  ),
  -- FK FROM here. trips is not modified. Null means a visit that was not part
  -- of a trip; set null on delete so removing a trip does not take the visit
  -- with it, exactly as expenses.destination_id releases its pin.
  trip_id uuid references batchport.trips (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint place_visits_dates check (end_date is null or end_date >= visit_date)
);

-- 6. Indexes ----------------------------------------------------------------
--
-- The GIST indexes are what make v_state_coverage's point-in-polygon and its
-- 10km nearest-state fallback tractable; the btree ones are the read patterns
-- ("my places", "the same locality again", "this place's visits", "what did I
-- do that year").

create index if not exists places_geom_idx
  on batchport.places using gist (geom);
create index if not exists admin1_boundaries_boundary_idx
  on batchport.admin1_boundaries using gist (boundary);
create index if not exists place_catalog_items_geom_idx
  on batchport.place_catalog_items using gist (geom);

create index if not exists places_user_idx
  on batchport.places (user_id);
create index if not exists places_locality_key_idx
  on batchport.places (locality_key);
create index if not exists place_visits_place_idx
  on batchport.place_visits (place_id);
create index if not exists place_visits_date_idx
  on batchport.place_visits (visit_date);
create index if not exists place_visits_user_idx
  on batchport.place_visits (user_id);

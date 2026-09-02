-- Places, migration 1 of 4: extensions and types.
--
-- Run this in the Supabase dashboard SQL editor (or psql). Safe to re-run.
-- Apply the four places migrations in order: 1 types, 2 tables, 3 RLS,
-- 4 coverage views.
--
-- Phase 0 of the places feature: schema, RLS, reference data, and the two
-- coverage views. No CRUD, no routes, no UI. Everything here is ADDITIVE, per
-- the "Places feature" block in CLAUDE.md: nothing in these four files does
-- CREATE OR REPLACE on an existing view or ALTER TABLE on an existing table.
--
-- Until they run, nothing in the app changes. There is no reader yet.

-- 1. PostGIS ----------------------------------------------------------------
--
-- Already installed: batchport.destinations.geom is geography(Point,4326) and
-- latitude/longitude are generated from it. This statement is an idempotent
-- assertion so the file states its own dependency rather than assuming it, and
-- it is a no-op on this database. It carries no schema clause deliberately:
-- with the extension already present, "if not exists" short-circuits before
-- the schema is considered, and naming a schema here could only conflict with
-- wherever Supabase already put it.

create extension if not exists postgis;

-- 2. place_type -------------------------------------------------------------
--
-- What KIND of thing a place is, which is not the same question as which
-- catalog it came from. A stadium is a stadium whether or not it is in the
-- nfl catalog, and a place a user typed in by hand has a type and no catalog
-- item at all. Catalog membership lives in place_catalog_item_memberships;
-- this is the shape of the pin.
--
-- CREATE TYPE has no IF NOT EXISTS, so the guard is explicit. Adding a value
-- later is a separate one-line ALTER TYPE ... ADD VALUE, which is why an enum
-- is affordable here where the transport vocabulary below is not.

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'batchport' and t.typname = 'place_type'
  ) then
    create type batchport.place_type as enum (
      'city', 'campus', 'stadium', 'park', 'landmark', 'other'
    );
  end if;
end
$$;

-- 3. Transport mode: THERE IS NO ENUM TO REUSE ------------------------------
--
-- The brief said to reuse the existing transport mode enum from
-- transport_legs and not to define a second one. There is no such enum.
-- batchport.transport_legs.mode is:
--
--   mode text not null check (
--     mode in ('flight','train','bus','car','ferry','bike','walk','other')
--   )
--
-- (see 2026-08-03-transport-legs.sql), and src/lib/transport.ts holds the
-- same list as the app-side catalog.
--
-- So the instruction is honoured by NOT creating one: introducing
-- batchport.transport_mode now would be a second definition of a vocabulary
-- that already has one, and it would leave transport_legs on text and
-- place_visits on the enum, which is the drift the instruction exists to
-- prevent. place_visits.transport_mode is therefore text with the identical
-- check constraint, matching the existing table exactly. See migration 2.
--
-- If a real enum is wanted later it should be one change that converts BOTH
-- columns, not a type that only the newer table uses.

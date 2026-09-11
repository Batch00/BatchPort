-- Places, phase 1: atomic create of a place and its first visit.
--
-- Run this in the Supabase dashboard SQL editor (or psql). Safe to re-run.
-- Requires the four 2026-08-31-places-*.sql migrations. Independent of
-- 2026-09-04-places-v-places.sql; apply them in either order.
--
-- Additive: a new function. No CREATE OR REPLACE of an existing view, no
-- ALTER TABLE.
--
-- Why it exists. The entry sheet writes two tables and never shows that split,
-- so a half-written create is a state the UI has no way to express. The first
-- version did the two inserts from the data layer and deleted the place again
-- if the visit failed, which is an approximation of atomicity: if the
-- compensating delete ALSO fails (the request is what died, the tab closed,
-- the network dropped between the two calls) the result is a permanent
-- visitless place that nothing will ever clean up. One function call is one
-- statement is one transaction, which removes the class rather than narrowing
-- it.
--
-- SECURITY INVOKER, NOT DEFINER, and this is the deliberate part.
--
--   Atomicity comes from this being a single statement, not from the security
--   mode. Running as the caller means the existing RLS insert policies still
--   apply to both inserts, so the function cannot write a row the caller could
--   not have written by hand. A DEFINER function would bypass RLS and would
--   have to re-implement that check itself, which is strictly more code
--   guarding a strictly larger hole: get it wrong and any authenticated user
--   can write rows owned by anybody.
--
--   The `authenticated` role already holds INSERT on both tables (migration 3),
--   so there is nothing DEFINER would enable that INVOKER does not.
--
-- user_id IS NOT A PARAMETER. It is read from auth.uid() inside, so there is no
-- signature in which a caller can name another account, under either security
-- mode. That also means the function is useless to the service role, whose
-- auth.uid() is null: seeding writes the two tables directly (see
-- scripts/seed-places.ts).
--
-- Verify it as a real caller. The SQL editor runs as a role that bypasses RLS,
-- so exercise it as `authenticated` and roll back:
--
--   begin;
--   select set_config('request.jwt.claims',
--     '{"sub":"<your-user-id>","role":"authenticated"}', true);
--   set local role authenticated;
--   select * from batchport.create_place_with_visit(
--     'Smoke test', 'stadium', 'SRID=4326;POINT(-87.9182 43.0451)',
--     'US', 'Wisconsin', 'Milwaukee', null, null,
--     '2025-06-14', null, null, null, 'Milwaukee Bucks', 'vs Pacers',
--     'car', null, null);
--   rollback;

create or replace function batchport.create_place_with_visit(
  -- place
  p_name            text,
  p_place_type      text,
  p_geom            text,   -- EWKT, e.g. 'SRID=4326;POINT(lng lat)'
  p_country_code    text,
  p_admin_region    text,
  p_locality_name   text,
  p_catalog_item_id uuid,
  p_notes           text,
  -- first visit
  p_visit_date      date,
  p_end_date        date,
  p_occasion_id     uuid,
  p_occasion_label  text,
  p_event_org       text,
  p_event_detail    text,
  p_transport_mode  text,
  p_trip_id         uuid,
  p_visit_notes     text
)
returns table (place_id uuid, visit_id uuid)
language plpgsql
-- Not SET search_path: this is an invoker function doing schema-qualified
-- writes only, so there is no unqualified name for a hostile search_path to
-- capture, and no elevated privilege to capture it with.
as $$
declare
  v_user  uuid := auth.uid();
  v_place uuid;
  v_visit uuid;
begin
  if v_user is null then
    raise exception 'create_place_with_visit requires an authenticated caller'
      using errcode = '28000';
  end if;

  -- locality_key is GENERATED ALWAYS AS STORED and is absent here on purpose.
  -- Naming it would raise 428C9. Postgres derives it from the three columns
  -- above it.
  insert into batchport.places (
    user_id, name, place_type, geom, country_code, admin_region,
    locality_name, catalog_item_id, notes
  )
  values (
    v_user,
    p_name,
    -- text in, cast here: an unknown value fails as a clear 22P02 rather than
    -- as a PostgREST parameter-marshalling error the client cannot read.
    p_place_type::batchport.place_type,
    p_geom::geography,
    p_country_code,
    p_admin_region,
    p_locality_name,
    p_catalog_item_id,
    p_notes
  )
  returning id into v_place;

  -- transport_mode is text with a check constraint matching transport_legs.mode.
  -- A bad value raises 23514 and takes the place insert down with it, which is
  -- the entire point of doing both here.
  insert into batchport.place_visits (
    place_id, user_id, visit_date, end_date, occasion_id, occasion_label,
    event_org, event_detail, transport_mode, trip_id, notes
  )
  values (
    v_place, v_user, p_visit_date, p_end_date, p_occasion_id, p_occasion_label,
    p_event_org, p_event_detail, p_transport_mode, p_trip_id, p_visit_notes
  )
  returning id into v_visit;

  return query select v_place, v_visit;
end;
$$;

-- anon has no insert policy on either table, so an anon caller would fail at
-- the first insert anyway; revoking is the statement of intent rather than the
-- mechanism.
revoke all on function batchport.create_place_with_visit(
  text, text, text, text, text, text, uuid, text,
  date, date, uuid, text, text, text, text, uuid, text
) from public, anon;

grant execute on function batchport.create_place_with_visit(
  text, text, text, text, text, text, uuid, text,
  date, date, uuid, text, text, text, text, uuid, text
) to authenticated;

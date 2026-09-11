-- Places, phase 1: the v_places read model.
--
-- Run this in the Supabase dashboard SQL editor (or psql). Safe to re-run.
-- Requires the four 2026-08-31-places-*.sql migrations.
--
-- Additive: v_places is a NEW name. No CREATE OR REPLACE of an existing view
-- (v_user_travel_summary is untouched) and no ALTER TABLE anywhere.
--
-- Until it runs, /places cannot render its list and the data layer's
-- getPlacesList() throws. Everything else in phase 1 (the entry sheet, the
-- search route, create and edit) works without it, because those read and
-- write the base tables.
--
-- What it is: one row per place, carrying the visit rollup the list needs, so
-- the route does not fetch every visit of every place to render a count and a
-- date. security_invoker, like every other view in this schema, so RLS on
-- places, place_visits, and occasions applies to the caller and the shared
-- surfaces keep working with no extra logic.
--
-- Two decisions inside it:
--
--  * A PLACE WITH NO VISITS IS STILL A PLACE. count(*) over an empty lateral
--    is 0, not null, and the row still appears with null dates. That state is
--    reachable: the sheet writes both tables together, but deleting the last
--    visit of a place is a choice the UI offers rather than a cascade, so a
--    visitless place is a thing the list has to be able to draw.
--
--  * "FIRST OCCASION" IS THE OCCASION OF THE EARLIEST VISIT, not the most
--    common one across visits. The list is sorted by first visit and the row
--    reads as "this is when and why you first went", so a mode would caption
--    the row with a reason that belongs to a different date. Ties on
--    visit_date break on created_at, so the answer is stable.

create or replace view batchport.v_places
with (security_invoker = true) as
select
  p.id,
  p.user_id,
  p.name,
  p.place_type,
  p.geom,
  p.country_code,
  p.admin_region,
  p.locality_name,
  p.locality_key,
  p.catalog_item_id,
  p.notes,
  p.created_at,
  p.updated_at,
  rollup.visit_count,
  rollup.first_visit_date,
  rollup.latest_visit_date,
  o.slug  as first_occasion_slug,
  o.label as first_occasion_label,
  o.icon  as first_occasion_icon,
  o.color as first_occasion_color
from batchport.places p
left join lateral (
  select
    count(*)        as visit_count,
    min(visit_date) as first_visit_date,
    max(visit_date) as latest_visit_date
  from batchport.place_visits v
  where v.place_id = p.id
) rollup on true
left join lateral (
  select v.occasion_id
  from batchport.place_visits v
  where v.place_id = p.id
  order by v.visit_date asc, v.created_at asc
  limit 1
) first_visit on true
left join batchport.occasions o on o.id = first_visit.occasion_id;

grant select on batchport.v_places to anon, authenticated;

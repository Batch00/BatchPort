-- Places, migration 4 of 4: coverage views.
--
-- Run this in the Supabase dashboard SQL editor (or psql). Safe to re-run.
-- Requires migrations 2 and 3, and the reference data loaded by
-- scripts/load-admin1.ts.
--
-- Both views are security_invoker, which is the whole access model: they carry
-- no privileges of their own, RLS on destinations, places, place_visits and
-- admin1_boundaries applies to the caller, and a signed-out visitor sees
-- exactly the shared accounts. Nothing here needs to know about sharing.
--
-- NEITHER of these is a CREATE OR REPLACE of an existing view. Both names are
-- new. v_user_travel_summary is not touched by this file.

-- 1. v_presence_points ------------------------------------------------------
--
-- THE canonical set of "the user was physically here". Two tables answer that
-- question today, destinations (a stop on a trip) and places (a venue, a
-- friend's town, anywhere else), and every surface that needs presence must
-- read this view rather than union them again. A second union somewhere else
-- is a second answer to "where has this person been", and the two will
-- disagree the first time one of them learns about planned trips and the
-- other does not.
--
-- Three decisions inside it:
--
--  * PLANNED TRIPS ARE NOT PRESENCE. A planned stop is somewhere you intend to
--    go, which the globe already draws hollow and the stats views already
--    exclude (2026-07-16-stats-exclude-planned-trips.sql). The filter is the
--    same one those views use, t.status <> 'planned', so coverage cannot
--    disagree with the stats page.
--
--  * A DESTINATION'S DATE FALLS BACK THROUGH THE DOCUMENTED CHAIN. Its own
--    arrival, then its departure, then the trip's stored start_date, which is
--    what CLAUDE.md says trips.start_date is for: the fallback for a trip
--    nobody dated a stop on. Null is still possible and is fine; it means the
--    state is visited with no first-visit date to report.
--
--  * A PLACE'S DATE IS ITS EARLIEST VISIT. places carries no date of its own
--    (it is the thing; place_visits is the being there), so the date here is
--    min(visit_date). A place with no visits yet still appears, with a null
--    date, because the pin exists.

create or replace view batchport.v_presence_points
with (security_invoker = true) as
  select
    d.user_id,
    d.name,
    d.geom,
    coalesce(d.arrival_date, d.departure_date, t.start_date) as date,
    'destination'::text as source
  from batchport.destinations d
  join batchport.trips t on t.id = d.trip_id
  where d.geom is not null
    and t.status <> 'planned'

  union all

  select
    p.user_id,
    p.name,
    p.geom,
    (
      select min(v.visit_date)
      from batchport.place_visits v
      where v.place_id = p.id
    ) as date,
    'place'::text as source
  from batchport.places p
  where p.geom is not null;

grant select on batchport.v_presence_points to anon, authenticated;

-- 2. v_state_coverage -------------------------------------------------------
--
-- Which US states a user has set foot in, one row per state per user, visited
-- or not, so a surface can render all 51 without a client-side join against a
-- state list.
--
-- Resolution per point, in order:
--
--   1. ST_Intersects against admin1_boundaries. This answers almost
--      everything: measured against the prepared catalogs, the Census 500k
--      boundaries put 0 of 684 US venues in the wrong state, where Natural
--      Earth 10m put 5 riverfront venues (Busch Stadium, Enterprise Center,
--      Gateway Arch, Great American Ball Park, Paycor Stadium) on the wrong
--      side of a river.
--
--   2. Failing that, the nearest state within 10km, by ST_Distance on
--      geography (metres). This is for the coastal and island points whose
--      coordinate is legitimately just offshore of the polygon.
--
--   3. Failing that, NULL, and the point is simply not counted.
--
-- A NULL IS EXPECTED AND IS NOT AN ERROR. The Canadian NHL arenas, the
-- American Samoa and US Virgin Islands parks, and every international trip
-- destination all resolve to null, because this table holds US states and
-- those are not in the US. Nothing here flags them, counts them as a failure,
-- or asks anybody to review them. If a US coverage surface ever wants to say
-- something about the rest of the world, that is a different view over a
-- different boundary set.
--
-- The 10km fallback is a fallback and not a licence: it cannot rescue a point
-- that is genuinely far offshore. Channel Islands National Park's own P625 is
-- 34km out to sea, which is why scripts/data/catalog-overrides.csv retargets
-- it to Santa Cruz Island rather than leaning on this step.

create or replace view batchport.v_state_coverage
with (security_invoker = true) as
with points as (
  select user_id, geom, date
  from batchport.v_presence_points
  where geom is not null
),
resolved as (
  select
    p.user_id,
    p.date,
    coalesce(hit.code, near.code) as state_code
  from points p
  left join lateral (
    select b.code
    from batchport.admin1_boundaries b
    where b.country_code = 'US'
      and st_intersects(b.boundary, p.geom)
    limit 1
  ) hit on true
  left join lateral (
    select b.code
    from batchport.admin1_boundaries b
    where hit.code is null
      and b.country_code = 'US'
      and st_dwithin(b.boundary, p.geom, 10000)
    order by st_distance(b.boundary, p.geom)
    limit 1
  ) near on true
),
per_state as (
  select
    user_id,
    state_code,
    min(date) as first_visit_date,
    count(*) as point_count
  from resolved
  where state_code is not null
  group by user_id, state_code
),
-- Every user with at least one presence point gets a full 51 row grid. A user
-- with none produces no rows at all rather than 51 zeroes, which is the right
-- empty state: there is nothing to say yet.
present_users as (
  select distinct user_id from points
)
select
  u.user_id,
  b.code as state_code,
  b.name as state_name,
  s.state_code is not null as visited,
  s.first_visit_date,
  coalesce(s.point_count, 0) as point_count,
  count(*) filter (where s.state_code is not null)
    over (partition by u.user_id) as states_visited,
  count(*) over (partition by u.user_id) as states_total,
  round(
    100.0 * count(*) filter (where s.state_code is not null)
      over (partition by u.user_id)
    / nullif(count(*) over (partition by u.user_id), 0),
    1
  ) as pct
from present_users u
cross join batchport.admin1_boundaries b
left join per_state s
  on s.user_id = u.user_id
 and s.state_code = b.code
where b.country_code = 'US';

grant select on batchport.v_state_coverage to anon, authenticated;

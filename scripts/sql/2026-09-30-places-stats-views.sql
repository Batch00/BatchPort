-- Places, phase 2: the stats views.
--
-- Run this in the Supabase dashboard SQL editor (or psql). Safe to re-run.
-- Requires the four 2026-08-31-places-*.sql migrations and
-- 2026-09-04-places-v-places.sql, plus the reference data (occasions,
-- catalogs, admin-1 boundaries).
--
-- ORDER OF OPERATIONS
--
--   1. In a SEPARATE editor tab, run query 0 from
--      2026-09-30-places-stats-views-verify.sql and keep its output.
--   2. Open THIS file in its own tab, make sure nothing is highlighted (the
--      editor runs only the selection when there is one, and reports success),
--      and run it. The last result must read "10 of 10 new views present".
--   3. Back in the verify tab, run query 0 again, then A to E.
--
-- WHAT THIS REPLACES, AND WHY THAT IS ALLOWED
--
-- Two CREATE OR REPLACE statements, both on PHASE 0 PLACES VIEWS, both
-- explicitly approved for this migration (2026-09-30):
--
--   * v_presence_points: future-dated presence is filtered at the source, and
--     it gains a trailing source_id column (appending a column is the one
--     shape change CREATE OR REPLACE VIEW permits; the five existing columns
--     keep their names, order and types).
--   * v_state_coverage: reads the one state resolution rule (v_presence_state)
--     instead of carrying its own copy. Same output columns, same types.
--
-- Neither had an application consumer at the time of writing (only
-- scripts/check-places-schema.ts reads them), which is what made this cheap.
-- v_user_travel_summary, v_yearly_breakdown and v_places are NOT touched. No
-- ALTER TABLE anywhere.
--
-- Every view is security_invoker, which is the whole access model, exactly as
-- in migration 4: RLS on places, place_visits, destinations, trips and the
-- reference tables applies to the caller. RLS is NOT an owner filter (see
-- CLAUDE.md), so every app read of these views must still carry
-- .eq("user_id", user.id).
--
-- DECISIONS THAT APPLY TO ALL OF THEM (confirmed 2026-09-30)
--
--  * PRESENCE MEANS "UP TO TODAY". A place visit dated after current_date is
--    not a visit yet, and a trip stop arriving after current_date is not a
--    stop yet, the same rule bucket fulfillment already applies
--    (2026-09-28-bucket-fulfillment.sql: arrival_date is null or
--    arrival_date <= current_date). A place whose only visit is next month
--    does not fill its state, count as a place, or tick a catalog item until
--    the day arrives. current_date is the database session's date (UTC on
--    Supabase), exactly as in the bucket view. The /places list (v_places) is
--    deliberately NOT filtered: listing an upcoming visit is correct there.
--
--  * A PLACE WITH NO VISITS AT ALL STILL COUNTS. It is a pin the user put on
--    the map, and v_presence_points has always treated it as presence with a
--    null date. That is different from a place whose visits are all in the
--    future: that one has told us when it happens, and it has not happened.
--    Both rules live in exactly one view, v_place_presence.
--
--  * "STATES" MEANS THE 50. v_state_coverage carries 51 rows including DC,
--    which is right for the map (DC gets drawn). Every COUNT labelled states
--    here excludes DC so the "N of 50" line is true, and v_places_summary
--    reports DC as its own flag.
--
--  * THE STATE MAP IS PRESENCE-WIDE, THE PLACE COUNTS ARE PLACES-ONLY. A trip
--    stop in Chicago puts you in Illinois whether or not you logged a place
--    there, so states_visited and new_states read v_state_coverage and agree
--    with the map. Counts of places, localities, catalog items and occasions
--    read the places tables only, because a trip stop is not a place row.
--
-- THE DEPENDENCY CHAIN, so that each rule exists once:
--
--   place_visits -> v_place_visits_to_date      "a visit counts"
--   places       -> v_place_presence            "a place counts"
--   destinations,
--   v_place_presence -> v_presence_points       "the user was here"
--   v_presence_points -> v_presence_state       "which state is that in"
--   v_presence_state  -> v_place_state, v_state_coverage


-- 1. v_place_visits_to_date -------------------------------------------------
--
-- THE definition of a place visit that counts: visit_date on or before
-- today. A multi-day visit that starts today counts today. Every view below
-- that counts visits reads this rather than place_visits, so the date rule is
-- written once.

create or replace view batchport.v_place_visits_to_date
with (security_invoker = true) as
select
  v.id,
  v.place_id,
  v.user_id,
  v.visit_date,
  v.end_date,
  v.occasion_id,
  v.trip_id
from batchport.place_visits v
where v.visit_date <= current_date;

grant select on batchport.v_place_visits_to_date to anon, authenticated;


-- 2. v_place_presence -------------------------------------------------------
--
-- THE definition of a place that counts: it has at least one visit to date,
-- or it has no visits at all. One row per such place, with or without a
-- coordinate (a place with no geom cannot be mapped or put in a state, but it
-- is still a place and still counts in the place totals).
--
-- first_visit_date is the earliest visit to date; null for a visitless place.
-- A place with past AND future visits counts, dated by its past one.

create or replace view batchport.v_place_presence
with (security_invoker = true) as
select
  p.id as place_id,
  p.user_id,
  p.name,
  p.place_type,
  p.geom,
  p.locality_key,
  p.catalog_item_id,
  p.created_at,
  (
    select min(t.visit_date)
    from batchport.v_place_visits_to_date t
    where t.place_id = p.id
  ) as first_visit_date
from batchport.places p
where exists (
        select 1 from batchport.v_place_visits_to_date t
        where t.place_id = p.id
      )
   or not exists (
        select 1 from batchport.place_visits x
        where x.place_id = p.id
      );

grant select on batchport.v_place_presence to anon, authenticated;


-- 3. v_presence_points (REPLACES the phase 0 definition) ---------------------
--
-- Still THE canonical "the user was physically here". Two changes from
-- migration 4, nothing else:
--
--  * Future presence is filtered. Destinations use the bucket rule verbatim
--    (arrival_date null or on/before today, on a non-planned trip); places
--    come from v_place_presence, which applies the visit rule.
--  * source_id is appended: the destination id or the place id. That is what
--    lets v_place_state be a filter on v_presence_state rather than a second
--    resolution of the same points.
--
-- The place branch's date is v_place_presence.first_visit_date, which is
-- min(visit_date) over visits to date: identical to the old min(visit_date)
-- whenever a place has no future visits.

create or replace view batchport.v_presence_points
with (security_invoker = true) as
  select
    d.user_id,
    d.name,
    d.geom,
    coalesce(d.arrival_date, d.departure_date, t.start_date) as date,
    'destination'::text as source,
    d.id as source_id
  from batchport.destinations d
  join batchport.trips t on t.id = d.trip_id
  where d.geom is not null
    and t.status <> 'planned'
    and (d.arrival_date is null or d.arrival_date <= current_date)

  union all

  select
    pp.user_id,
    pp.name,
    pp.geom,
    pp.first_visit_date as date,
    'place'::text as source,
    pp.place_id as source_id
  from batchport.v_place_presence pp
  where pp.geom is not null;

grant select on batchport.v_presence_points to anon, authenticated;


-- 4. v_presence_state -------------------------------------------------------
--
-- THE state resolution rule, and the only copy of it. One row per presence
-- point with the US state it is in, or null. Moved here verbatim from
-- v_state_coverage's old `resolved` CTE:
--
--   1. ST_Intersects against admin1_boundaries.
--   2. Failing that, the nearest state within 10km (coastal and island points
--      legitimately just offshore).
--   3. Failing that, NULL, which is expected for everything outside the US and
--      is not an error. See migration 4 for the full reasoning, including why
--      the 10km fallback is not a licence (Channel Islands).
--
-- A view rather than a SQL function on purpose: a function resolves
-- st_intersects through the CALLER's search_path at run time, which differs
-- between the SQL editor and PostgREST on Supabase, while a view binds the
-- names once, here.

create or replace view batchport.v_presence_state
with (security_invoker = true) as
select
  pt.user_id,
  pt.source,
  pt.source_id,
  pt.date,
  coalesce(hit.code, near.code) as state_code
from batchport.v_presence_points pt
left join lateral (
  select b.code
  from batchport.admin1_boundaries b
  where b.country_code = 'US'
    and st_intersects(b.boundary, pt.geom)
  limit 1
) hit on true
left join lateral (
  select b.code
  from batchport.admin1_boundaries b
  where hit.code is null
    and b.country_code = 'US'
    and st_dwithin(b.boundary, pt.geom, 10000)
  order by st_distance(b.boundary, pt.geom)
  limit 1
) near on true
where pt.geom is not null;

grant select on batchport.v_presence_state to anon, authenticated;


-- 5. v_place_state ----------------------------------------------------------
--
-- One row per counted place with a coordinate: which state it is in, or null.
-- A filter on v_presence_state, not a resolution of its own. Used by
-- v_occasion_breakdown ("which states did the game visits reach").

create or replace view batchport.v_place_state
with (security_invoker = true) as
select
  ps.source_id as place_id,
  ps.user_id,
  ps.state_code
from batchport.v_presence_state ps
where ps.source = 'place';

grant select on batchport.v_place_state to anon, authenticated;


-- 6. v_state_coverage (REPLACES the phase 0 definition) ----------------------
--
-- Identical output to migration 4, column for column and type for type. The
-- only change is where `resolved` comes from: v_presence_state rather than
-- its own laterals. Everything from per_state down is the migration 4 text
-- unchanged, including the 51-row grid per present user and the "no presence,
-- no rows" empty state.
--
-- Its output moves only where presence moved: a future-only place or a
-- future-arriving stop no longer counts. Query 0 is the before/after check.

create or replace view batchport.v_state_coverage
with (security_invoker = true) as
with resolved as (
  select user_id, date, state_code
  from batchport.v_presence_state
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
  select distinct user_id from resolved
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


-- 7. v_place_counts ---------------------------------------------------------
--
-- One row per user with at least one counted place: the type counters and
-- the locality count.
--
-- WIDE, one column per place_type, because the counters are a fixed row of
-- tiles and a long shape would make the client pivot and zero-fill it. The
-- cost is that a new enum value would be missed silently, so total_places is
-- carried beside them: if the typed columns ever stop summing to it, a value
-- was added without a column here (query B).
--
-- localities is count(distinct locality_key), and locality_key is null for a
-- place with no locality (normal for a stadium or a park, per CLAUDE.md), so
-- those places contribute no locality. It is NOT the same number as `cities`:
-- a city is a place the user logged AS a city, a locality is any town a place
-- of theirs sits in. Five localities and two city rows is an ordinary result.

create or replace view batchport.v_place_counts
with (security_invoker = true) as
select
  pp.user_id,
  count(*) as total_places,
  count(distinct pp.locality_key) as localities,
  count(*) filter (where pp.place_type = 'city') as cities,
  count(*) filter (where pp.place_type = 'campus') as campuses,
  count(*) filter (where pp.place_type = 'stadium') as stadiums,
  count(*) filter (where pp.place_type = 'park') as parks,
  count(*) filter (where pp.place_type = 'landmark') as landmarks,
  count(*) filter (where pp.place_type = 'other') as others
from batchport.v_place_presence pp
group by pp.user_id;

grant select on batchport.v_place_counts to anon, authenticated;


-- 8. v_places_summary -------------------------------------------------------
--
-- One row per user who has either a counted place or any presence point (a
-- user with trips and no places still has states, and the map draws them).
--
--   places_visited    counted places (v_place_presence)
--   states_visited    of the 50, from v_state_coverage, so it is the map's
--                     own number; includes trip stops
--   states_total      the 50, counted from admin1_boundaries rather than
--                     typed, so the denominator is the loaded data
--   dc_visited        DC is on the map and not in the count
--   localities        from v_place_counts, so there is one definition of it
--   first_place_date  the earliest place visit to date; null when no place
--                     has one. Places only: a trip in 2019 does not make 2019
--                     the year the user started logging places.
--
-- Separate from v_user_travel_summary by decision; nothing here reads or
-- replaces it.

create or replace view batchport.v_places_summary
with (security_invoker = true) as
with state_rollup as (
  select
    sc.user_id,
    count(*) filter (where sc.visited and sc.state_code <> 'DC') as states_visited,
    bool_or(sc.visited and sc.state_code = 'DC') as dc_visited
  from batchport.v_state_coverage sc
  group by sc.user_id
),
first_visit as (
  select pp.user_id, min(pp.first_visit_date) as first_place_date
  from batchport.v_place_presence pp
  group by pp.user_id
),
users as (
  select user_id from batchport.v_place_presence
  union
  select user_id from state_rollup
),
states_total as (
  select count(*) as n
  from batchport.admin1_boundaries b
  where b.country_code = 'US'
    and b.code <> 'DC'
)
select
  u.user_id,
  coalesce(pc.total_places, 0) as places_visited,
  coalesce(sr.states_visited, 0) as states_visited,
  st.n as states_total,
  coalesce(sr.dc_visited, false) as dc_visited,
  coalesce(pc.localities, 0) as localities,
  fv.first_place_date
from users u
cross join states_total st
left join batchport.v_place_counts pc on pc.user_id = u.user_id
left join state_rollup sr on sr.user_id = u.user_id
left join first_visit fv on fv.user_id = u.user_id;

grant select on batchport.v_places_summary to anon, authenticated;


-- 9. v_catalog_items_status -------------------------------------------------
--
-- One row per (user, catalog, item): every item of every catalog, visited or
-- not, for every user with at least one counted place. 695 membership rows
-- per user, which is small, and it lets a surface list "the 30 ballparks, 2
-- ticked" without a client-side join against the catalog.
--
-- An item appearing in two catalogs (Madison Square Garden is in three)
-- appears once per catalog; its visited flag is the same in each because it
-- is one building.
--
-- visited means the user has a COUNTED place linked to the item
-- (places.catalog_item_id). Nothing else counts: a trip stop that happens to
-- sit on a stadium is a destination, not a catalog visit, and matching them
-- by distance would be a guess this view should not make. first_visit_date is
-- the earliest visit to date and is null for a linked place with no visits
-- (visited stays true).
--
-- place_id is the user's place for the item, so a row can link to
-- /places/[id]. Dedup should keep it to one place per item; if there are two,
-- the one first visited (then first created) wins so the answer is stable.

create or replace view batchport.v_catalog_items_status
with (security_invoker = true) as
with present_users as (
  select distinct user_id from batchport.v_place_presence
),
per_item as (
  select distinct on (pp.user_id, pp.catalog_item_id)
    pp.user_id,
    pp.catalog_item_id,
    pp.place_id,
    -- The ORDER BY below puts the earliest dated place first, so this row's
    -- date IS the item's earliest visit.
    pp.first_visit_date
  from batchport.v_place_presence pp
  where pp.catalog_item_id is not null
  order by
    pp.user_id,
    pp.catalog_item_id,
    pp.first_visit_date asc nulls last,
    pp.created_at asc
)
select
  u.user_id,
  c.id as catalog_id,
  c.slug as catalog_slug,
  i.id as catalog_item_id,
  i.name,
  i.city,
  i.state,
  i.country_code,
  pi.catalog_item_id is not null as visited,
  pi.first_visit_date,
  pi.place_id
from present_users u
cross join batchport.place_catalog_item_memberships m
join batchport.place_catalogs c on c.id = m.catalog_id
join batchport.place_catalog_items i on i.id = m.catalog_item_id
left join per_item pi
  on pi.user_id = u.user_id
 and pi.catalog_item_id = m.catalog_item_id;

grant select on batchport.v_catalog_items_status to anon, authenticated;


-- 10. v_catalog_progress ----------------------------------------------------
--
-- One row per (user, catalog), all seven catalogs for every user with at least
-- one counted place, INCLUDING the ones at zero. The UI's "rings for started,
-- compact list for the rest" split needs the zeroes to exist to list them.
--
-- total is the loaded membership count for the catalog, which is the number
-- of BUILDINGS, not teams: 30 for the NFL's 32 clubs, 374 for NCAA basketball
-- until the missing-coords rows are filled. denominator_note is carried so a
-- surface can quote why.
--
-- Derived from v_catalog_items_status rather than recounting, so the ring and
-- the item list under it can never disagree.
--
-- A user with no counted places gets no rows, and the section renders its own
-- empty state rather than seven zero rings.

create or replace view batchport.v_catalog_progress
with (security_invoker = true) as
select
  s.user_id,
  c.id as catalog_id,
  c.slug as catalog_slug,
  c.label,
  c.denominator_note,
  c.sort_order,
  count(*) as total,
  count(*) filter (where s.visited) as visited,
  round(100.0 * count(*) filter (where s.visited) / nullif(count(*), 0), 1) as pct,
  min(s.first_visit_date) as first_visit_date
from batchport.v_catalog_items_status s
join batchport.place_catalogs c on c.id = s.catalog_id
group by s.user_id, c.id, c.slug, c.label, c.denominator_note, c.sort_order;

grant select on batchport.v_catalog_progress to anon, authenticated;


-- 11. v_occasion_breakdown --------------------------------------------------
--
-- One row per (user, occasion) the user has at least one visit to date under:
-- how many visits, how many distinct places, how many distinct states (of the
-- 50) those places are in.
--
-- VISITS, not places, are what occasions attach to: the same stadium can be a
-- game in April and a concert in July, so it counts once under each. That is
-- why places is count(distinct) and visits is count(*).
--
-- A visit with no occasion is its OWN row, with a null occasion_id and null
-- label fields, rather than being folded into "other": "other" is a choice the
-- user made and "none" is a choice they did not. The UI labels it. Occasions
-- with zero visits get no row.
--
-- occasion_label (the free text override) is deliberately NOT a grouping key.
-- "Dave and Priya's wedding" groups under Wedding.

create or replace view batchport.v_occasion_breakdown
with (security_invoker = true) as
select
  v.user_id,
  v.occasion_id,
  o.slug,
  o.label,
  o.icon,
  o.color,
  o.sort_order,
  count(*) as visits,
  count(distinct v.place_id) as places,
  count(distinct ps.state_code) filter (where ps.state_code <> 'DC') as states
from batchport.v_place_visits_to_date v
left join batchport.occasions o on o.id = v.occasion_id
left join batchport.v_place_state ps on ps.place_id = v.place_id
group by v.user_id, v.occasion_id, o.slug, o.label, o.icon, o.color, o.sort_order;

grant select on batchport.v_occasion_breakdown to anon, authenticated;


-- 12. v_yearly_places -------------------------------------------------------
--
-- Per (user, year): the same shape as v_yearly_breakdown, a count and its
-- "new" half, keyed by user_id and an int year, counts left as bigint.
--
--   visits       place visits dated in the year (to date)
--   places       distinct places visited in the year
--   new_places   places whose FIRST visit is in the year (new to the
--                traveller, not new to the year, the same rule
--                v_yearly_breakdown uses for countries)
--   new_states   states (of the 50) whose first visit, per
--                v_state_coverage.first_visit_date, falls in the year
--
-- ONE DEPARTURE FROM THE SIBLING'S SHAPE: there is no "states reached this
-- year" column, only new_states. v_state_coverage keeps only each state's
-- FIRST date; a per-year reach count would need a per-point, per-visit state
-- rollup that nothing asks for yet. It can be built on v_presence_state
-- without a second resolution rule if it is ever wanted.
--
-- new_states is presence-wide, like the map: a state first reached on a 2019
-- trip is new in 2019 whether or not a place was logged. So a year can appear
-- here with zero places and a new state. That is true, not padding.
--
-- A visit spanning new year counts in the year of visit_date. A visitless
-- place has no year and appears in no row.

create or replace view batchport.v_yearly_places
with (security_invoker = true) as
with year_visits as (
  select
    v.user_id,
    extract(year from v.visit_date)::int as year,
    count(*) as visits,
    count(distinct v.place_id) as places
  from batchport.v_place_visits_to_date v
  group by v.user_id, extract(year from v.visit_date)::int
),
year_new_places as (
  select
    pp.user_id,
    extract(year from pp.first_visit_date)::int as year,
    count(*) as new_places
  from batchport.v_place_presence pp
  where pp.first_visit_date is not null
  group by pp.user_id, extract(year from pp.first_visit_date)::int
),
year_new_states as (
  select
    sc.user_id,
    extract(year from sc.first_visit_date)::int as year,
    count(*) as new_states
  from batchport.v_state_coverage sc
  where sc.visited
    and sc.first_visit_date is not null
    and sc.state_code <> 'DC'
  group by sc.user_id, extract(year from sc.first_visit_date)::int
),
keys as (
  select user_id, year from year_visits
  union
  select user_id, year from year_new_states
)
select
  k.user_id,
  k.year,
  coalesce(yv.visits, 0) as visits,
  coalesce(yv.places, 0) as places,
  coalesce(yp.new_places, 0) as new_places,
  coalesce(ys.new_states, 0) as new_states
from keys k
left join year_visits yv on yv.user_id = k.user_id and yv.year = k.year
left join year_new_places yp on yp.user_id = k.user_id and yp.year = k.year
left join year_new_states ys on ys.user_id = k.user_id and ys.year = k.year;

grant select on batchport.v_yearly_places to anon, authenticated;


-- ===========================================================================
-- POSTCONDITION
-- ===========================================================================
--
-- The last thing the file does is prove it did something. A run that created
-- nothing (for instance, the editor executing only a highlighted selection,
-- which it does silently) cannot reach this block, so it cannot print the row
-- below. If the result pane does not show "10 of 10", the file did not run.
--
-- The DO block fails LOUDLY on a partial apply, which the SQL editor reports
-- as an error rather than as "Success. No rows returned".

do $$
declare
  missing text;
begin
  select string_agg(v, ', ') into missing
  from unnest(array[
    'v_place_visits_to_date', 'v_place_presence', 'v_presence_points',
    'v_presence_state', 'v_place_state', 'v_state_coverage',
    'v_place_counts', 'v_places_summary', 'v_catalog_items_status',
    'v_catalog_progress', 'v_occasion_breakdown', 'v_yearly_places'
  ]) as v
  where not exists (
    select 1 from pg_views
    where schemaname = 'batchport' and viewname = v
  );
  if missing is not null then
    raise exception 'places stats migration incomplete, missing: %', missing;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'batchport'
      and table_name = 'v_presence_points'
      and column_name = 'source_id'
  ) then
    raise exception 'v_presence_points was not replaced (no source_id column)';
  end if;
end
$$;

select
  count(*) || ' of 10 new views present, v_presence_points and v_state_coverage replaced'
    as places_stats_migration
from pg_views
where schemaname = 'batchport'
  and viewname in (
    'v_place_visits_to_date', 'v_place_presence', 'v_presence_state',
    'v_place_state', 'v_place_counts', 'v_places_summary',
    'v_catalog_items_status', 'v_catalog_progress', 'v_occasion_breakdown',
    'v_yearly_places'
  );

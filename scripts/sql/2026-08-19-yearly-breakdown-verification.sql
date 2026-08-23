-- Verification harness for the v_yearly_breakdown change.
--
-- Companion to 2026-08-19-trip-days-alignment.sql section 2. Nothing here is
-- part of the migration: it exists so that replacing that view is a DIFF OF
-- ROWS rather than a judgment about a definition, after section 1 shipped a
-- silent precision change that only a diff would have caught.
--
-- It creates exactly one thing, batchport._yb_before, and step 5 drops it.
-- That table gets no grants, so PostgREST (anon and authenticated) cannot read
-- it; it is visible to the service role and the SQL editor only.
--
-- EVERY REFERENCE IN THIS FILE IS SCHEMA-QUALIFIED, deliberately. The Supabase
-- SQL editor's search_path does not include batchport, so an unqualified
-- _yb_before resolves against public and fails with 42P01 even while pg_tables
-- can plainly see the table. If a statement here is ever retyped by hand
-- rather than run from the file, qualify it.
--
-- It is a REGULAR table rather than a temp table for the same reason: the
-- steps run either side of a migration, in different editor sessions, and a
-- temp table would not survive between them. An empty step 4 against a
-- vanished temp table would look exactly like an empty step 4 against a real
-- one, which is the worst possible way for this check to pass.
--
-- ORDER, and each step says which side of the migration it belongs on:
--
--   1. BEFORE   snapshot the live view
--   2. BEFORE   stored vs resolved trip years (isolates data findings)
--   3. BEFORE   which new_countries rule the LIVE view actually implements
--   4. AFTER    diff the snapshot against the new view
--   5. AFTER    drop the snapshot
--
-- Step 3 is the one that matters most and it can only run BEFORE, because it
-- interrogates the definition that is about to be replaced.
--
-- OUTCOME OF THE 2026-08-22 RUN, kept because a harness whose result is not
-- recorded gets run again from scratch by the next person:
--
--   resync   14 trips, 0 reordered, 0 redated. The stored columns were already
--            in sync, so step 2 returned nothing and step 4 should be empty.
--   step 3b  multi_year_countries = 0. NO COUNTRY IN EITHER ACCOUNT HAS BEEN
--            VISITED IN TWO DIFFERENT YEARS, not even across the demo's 2019
--            to 2026 span, so both new_countries rules reproduce live and the
--            comparison is VACUOUS. Reported rather than hidden, which is the
--            entire reason multi_year_countries is in the output.
--   step 3b  the planned exclusion IS settled empirically: the
--            planned-excluded candidate matched live on all 8 rows and the
--            planned-included one diverged on a 2026 planned trip that live
--            correctly omits.
--
-- So the new_countries rule was settled by reading pg_get_viewdef (live builds
-- first_visit as min(yr) per country, the earliest-year rule) and not by this
-- harness. If a country is ever revisited in a later year, re-running step 3
-- would become able to confirm that independently.
--
--   step 4   NO ROWS, and the pass was not vacuous: _yb_before was a real
--            table holding the pre-migration snapshot, so the comparison had
--            its input. Backed up independently by reading the new view
--            directly and matching all 8 rows against step 3's live_ columns,
--            which agreed exactly, with still no 2026 row for the owner:
--
--              me    2025   2 / 10 / 10      demo  2023   1 / 3 / 3
--              demo  2019   1 /  5 /  5      demo  2024   2 / 3 / 3
--              demo  2021   1 /  1 /  1      demo  2025   1 / 2 / 2
--              demo  2022   1 /  4 /  4      demo  2026   2 / 2 / 2
--
-- WHAT THIS RUN DID NOT ESTABLISH. Difference 3's rider (a year whose trips
-- have no country-coded stops, where live yields null and the new view yields
-- 0) NEVER FIRED. With no null country codes anywhere it needs a non-planned
-- trip holding no destinations at all, and whether one exists was not checked.
-- So that difference is UNCONFIRMED, not confirmed inert. An empty step 4 is
-- consistent with the case being absent and equally consistent with it never
-- having been looked for, and those are not the same result.
--
-- WHOSE DATA CAN ANSWER WHAT. The owner account's trips are both 2025, so no
-- country appears in two different years and steps 2 and 3 will look identical
-- under every candidate rule. The DEMO account (703fbe07-db8a-41bd-bdee-
-- 928c2fa88107) spans 2019 to 2026 and is the only data in the project that
-- can distinguish "earliest year is this year" from "appears in no other
-- year". Every query below covers both users for that reason. A step 3 that
-- reports the same answer for every candidate is a step 3 that found no demo
-- rows, not a step 3 that proved anything.


-- ===========================================================================
-- 1. BEFORE: snapshot
-- ===========================================================================

drop table if exists batchport._yb_before;

create table batchport._yb_before as
select user_id, year, trips, countries, new_countries
from batchport.v_yearly_breakdown;

-- Sanity: what was captured, and from how many users.
select
  count(*) as rows_captured,
  count(distinct user_id) as users,
  min(year) as earliest_year,
  max(year) as latest_year,
  count(*) filter (where year is null) as null_year_rows
from batchport._yb_before;


-- ===========================================================================
-- 2. BEFORE (after resync): stored year vs resolved year
-- ===========================================================================
--
-- Run this once scripts/resync-trip-schedules.ts has been applied. Any row it
-- returns is a trip whose stored start_date disagrees with the range its own
-- stops describe, which means the new view will legitimately file it under a
-- different year. That is a DATA finding and must be separated from the
-- definition change before step 4 runs, or the two are indistinguishable in
-- the diff.
--
-- Expected result after a successful resync: no rows.

select
  t.user_id,
  t.id as trip_id,
  t.name,
  t.status,
  t.start_date as stored_start,
  td.start_date as resolved_start,
  extract(year from t.start_date)::int as stored_year,
  extract(year from td.start_date)::int as resolved_year,
  td.derived as range_came_from_stops
from batchport.trips t
join batchport.v_trip_days td on td.trip_id = t.id
where extract(year from t.start_date) is distinct from extract(year from td.start_date)
order by t.user_id, t.start_date;


-- ===========================================================================
-- 3. BEFORE: which definition is the live one
-- ===========================================================================
--
-- Reproduces v_yearly_breakdown under each candidate reading and puts the
-- results beside what the live view actually returns. Whichever candidate
-- matches on every row IS the live definition, which turns pg_get_viewdef from
-- the primary evidence into a confirmation.
--
-- Two axes, because they are the two the type contract cannot police:
--
--   planned trips  p0 = excluded (what every other stat does)
--                  p1 = included
--   new_countries  a  = "this is the earliest year the country appears"
--                  b  = "the country appears in no other year"
--
-- Rules a and b differ ONLY for a country visited in more than one year: under
-- a it is new in the first of them, under b it is new in none. That case does
-- not exist in the owner's rows and does exist in the demo's.
--
-- The year here is the STORED start date, deliberately: this is measuring the
-- old definition, and step 2 has already established whether stored and
-- resolved agree.

with trip_year as (
  select
    t.user_id,
    t.id as trip_id,
    t.status,
    extract(year from t.start_date)::int as year
  from batchport.trips t
  where t.start_date is not null
),
tc_p0 as (
  select distinct ty.user_id, ty.year, d.country_code
  from trip_year ty
  join batchport.destinations d on d.trip_id = ty.trip_id
  where ty.status <> 'planned'
    and d.country_code is not null
),
tc_p1 as (
  select distinct ty.user_id, ty.year, d.country_code
  from trip_year ty
  join batchport.destinations d on d.trip_id = ty.trip_id
  where d.country_code is not null
),
span_p0 as (
  select user_id, country_code, min(year) as first_year, count(*) as year_count
  from tc_p0 group by user_id, country_code
),
span_p1 as (
  select user_id, country_code, min(year) as first_year, count(*) as year_count
  from tc_p1 group by user_id, country_code
),
agg_p0 as (
  select
    tc.user_id,
    tc.year,
    count(*) as countries,
    count(*) filter (where tc.year = s.first_year) as new_a,
    count(*) filter (where s.year_count = 1) as new_b
  from tc_p0 tc
  join span_p0 s on s.user_id = tc.user_id and s.country_code = tc.country_code
  group by tc.user_id, tc.year
),
agg_p1 as (
  select
    tc.user_id,
    tc.year,
    count(*) as countries,
    count(*) filter (where tc.year = s.first_year) as new_a,
    count(*) filter (where s.year_count = 1) as new_b
  from tc_p1 tc
  join span_p1 s on s.user_id = tc.user_id and s.country_code = tc.country_code
  group by tc.user_id, tc.year
),
trips_p0 as (
  select user_id, year, count(distinct trip_id) as trips
  from trip_year where status <> 'planned' group by user_id, year
),
trips_p1 as (
  select user_id, year, count(distinct trip_id) as trips
  from trip_year group by user_id, year
),
-- Every (user, year) either side knows about, so a year the live view emits
-- and the candidates do not (or the reverse) shows up instead of vanishing.
keys as (
  select user_id, year from batchport.v_yearly_breakdown
  union
  select user_id, year from trip_year
)
select
  k.user_id,
  k.year,
  -- What live says
  live.trips          as live_trips,
  live.countries      as live_countries,
  live.new_countries  as live_new,
  -- Planned excluded
  tp0.trips           as trips_p0,
  a0.countries        as countries_p0,
  a0.new_a            as new_a_p0,
  a0.new_b            as new_b_p0,
  -- Planned included
  tp1.trips           as trips_p1,
  a1.countries        as countries_p1,
  a1.new_a            as new_a_p1,
  a1.new_b            as new_b_p1
from keys k
left join batchport.v_yearly_breakdown live
  on live.user_id = k.user_id and live.year is not distinct from k.year
left join trips_p0 tp0 on tp0.user_id = k.user_id and tp0.year = k.year
left join trips_p1 tp1 on tp1.user_id = k.user_id and tp1.year = k.year
left join agg_p0 a0 on a0.user_id = k.user_id and a0.year = k.year
left join agg_p1 a1 on a1.user_id = k.user_id and a1.year = k.year
order by k.user_id, k.year;


-- ---------------------------------------------------------------------------
-- 3b. BEFORE: the same thing as a verdict
-- ---------------------------------------------------------------------------
--
-- One row. A true column is a candidate that matches live on EVERY row above.
-- Expect exactly one of new_rule_is_earliest_year / new_rule_is_only_year to
-- be true; if both are true the data cannot tell them apart (no country in two
-- years) and reading pg_get_viewdef is the only way. If both are false, live
-- implements a third rule and the reconstruction must not be run.
--
-- rows_compared is the guard against a vacuous pass: a verdict computed over
-- one user's two 2025 rows proves almost nothing.

with trip_year as (
  select
    t.user_id, t.id as trip_id, t.status,
    extract(year from t.start_date)::int as year
  from batchport.trips t
  where t.start_date is not null
),
tc_p0 as (
  select distinct ty.user_id, ty.year, d.country_code
  from trip_year ty
  join batchport.destinations d on d.trip_id = ty.trip_id
  where ty.status <> 'planned' and d.country_code is not null
),
tc_p1 as (
  select distinct ty.user_id, ty.year, d.country_code
  from trip_year ty
  join batchport.destinations d on d.trip_id = ty.trip_id
  where d.country_code is not null
),
span_p0 as (
  select user_id, country_code, min(year) as first_year, count(*) as year_count
  from tc_p0 group by user_id, country_code
),
span_p1 as (
  select user_id, country_code, min(year) as first_year, count(*) as year_count
  from tc_p1 group by user_id, country_code
),
agg_p0 as (
  select tc.user_id, tc.year, count(*) as countries,
    count(*) filter (where tc.year = s.first_year) as new_a,
    count(*) filter (where s.year_count = 1) as new_b
  from tc_p0 tc join span_p0 s
    on s.user_id = tc.user_id and s.country_code = tc.country_code
  group by tc.user_id, tc.year
),
agg_p1 as (
  select tc.user_id, tc.year, count(*) as countries,
    count(*) filter (where tc.year = s.first_year) as new_a,
    count(*) filter (where s.year_count = 1) as new_b
  from tc_p1 tc join span_p1 s
    on s.user_id = tc.user_id and s.country_code = tc.country_code
  group by tc.user_id, tc.year
),
trips_p0 as (
  select user_id, year, count(distinct trip_id) as trips
  from trip_year where status <> 'planned' group by user_id, year
),
trips_p1 as (
  select user_id, year, count(distinct trip_id) as trips
  from trip_year group by user_id, year
),
joined as (
  select
    live.user_id, live.year,
    coalesce(live.trips, 0)         as live_trips,
    coalesce(live.countries, 0)     as live_countries,
    coalesce(live.new_countries, 0) as live_new,
    coalesce(tp0.trips, 0) as trips_p0, coalesce(tp1.trips, 0) as trips_p1,
    coalesce(a0.countries, 0) as countries_p0, coalesce(a1.countries, 0) as countries_p1,
    coalesce(a0.new_a, 0) as new_a_p0, coalesce(a0.new_b, 0) as new_b_p0,
    coalesce(a1.new_a, 0) as new_a_p1, coalesce(a1.new_b, 0) as new_b_p1
  from batchport.v_yearly_breakdown live
  left join trips_p0 tp0 on tp0.user_id = live.user_id and tp0.year = live.year
  left join trips_p1 tp1 on tp1.user_id = live.user_id and tp1.year = live.year
  left join agg_p0 a0 on a0.user_id = live.user_id and a0.year = live.year
  left join agg_p1 a1 on a1.user_id = live.user_id and a1.year = live.year
)
select
  count(*) as rows_compared,
  count(distinct user_id) as users_compared,
  -- How many countries appear in more than one year. If this is 0, the two
  -- new_countries rules are indistinguishable on this data and the verdict
  -- below is vacuous.
  (select count(*) from span_p0 where year_count > 1) as multi_year_countries,
  bool_and(live_trips = trips_p0) as trips_match_planned_excluded,
  bool_and(live_trips = trips_p1) as trips_match_planned_included,
  bool_and(live_countries = countries_p0) as countries_match_planned_excluded,
  bool_and(live_countries = countries_p1) as countries_match_planned_included,
  bool_and(live_new = new_a_p0) as new_rule_is_earliest_year,
  bool_and(live_new = new_b_p0) as new_rule_is_only_year,
  bool_and(live_new = new_a_p1) as new_rule_is_earliest_year_incl_planned,
  bool_and(live_new = new_b_p1) as new_rule_is_only_year_incl_planned
from joined;


-- ===========================================================================
-- 4. AFTER: diff the snapshot against the new view
-- ===========================================================================
--
-- Run once section 2 has been applied. FULL OUTER JOIN, so a year that
-- appeared or disappeared shows as a row with nulls on one side rather than
-- silently dropping out of the comparison.
--
-- Counts are compared as numeric so an int/bigint/numeric type change does not
-- read as a value change. The type change is real and expected; a VALUE change
-- is what this is looking for.
--
-- Expected result: no rows, unless step 2 returned trips whose year moves.

select
  coalesce(b.user_id, a.user_id) as user_id,
  coalesce(b.year, a.year) as year,
  case
    when b.user_id is null then 'year appeared'
    when a.user_id is null then 'year disappeared'
    else 'values changed'
  end as change,
  b.trips as before_trips,          a.trips as after_trips,
  b.countries as before_countries,  a.countries as after_countries,
  b.new_countries as before_new,    a.new_countries as after_new
from batchport._yb_before b
full outer join batchport.v_yearly_breakdown a
  on a.user_id = b.user_id
 and a.year is not distinct from b.year
where b.user_id is null
   or a.user_id is null
   or b.trips::numeric         is distinct from a.trips::numeric
   or b.countries::numeric     is distinct from a.countries::numeric
   or b.new_countries::numeric is distinct from a.new_countries::numeric
order by 1, 2;


-- ===========================================================================
-- 5. AFTER: clean up
-- ===========================================================================

drop table if exists batchport._yb_before;

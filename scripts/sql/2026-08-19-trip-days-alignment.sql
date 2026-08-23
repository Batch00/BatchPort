-- Align the stats views with the app's own definition of a trip's range.
--
-- ############################################################################
-- #  THIS FILE IS NOT A BLIND RUN. DIFF BOTH SECTIONS AGAINST THE LIVE       #
-- #  DEFINITIONS FIRST:                                                      #
-- #                                                                          #
-- #    select pg_get_viewdef('batchport.v_user_travel_summary', true);       #
-- #    select pg_get_viewdef('batchport.v_yearly_breakdown', true);          #
-- #                                                                          #
-- #  Section 1 was FIRST WRITTEN AS A DIFF AGAINST THE WRONG THING. It was   #
-- #  copied from 2026-07-18-experience-status.sql, which is the only         #
-- #  definition of v_user_travel_summary this repo carries, on the           #
-- #  assumption that the checked-in statement matched the database. It does  #
-- #  not. That file casts every count to ::int and computes world_pct as     #
-- #  round(x * 100 / 195, 2); the live view returns bigint from raw count()  #
-- #  and computes round(x / 195 * 100, 1).                                   #
-- #                                                                          #
-- #  So "this changes only the travel_days CTE" was true of the repo file    #
-- #  and false of the database, which is the failure mode this banner        #
-- #  exists to prevent. The statement below now matches live, and the only   #
-- #  thing it changes is travel_days.                                        #
-- #                                                                          #
-- #  CREATE OR REPLACE VIEW ENFORCES THE TYPE CONTRACT. It cannot change a   #
-- #  column's name, order, OR TYPE, so the ::int casts surfaced as:          #
-- #                                                                          #
-- #    ERROR 42P16: cannot change data type of view column                   #
-- #    "countries_visited" from bigint to integer                            #
-- #                                                                          #
-- #  That is the good case. The world_pct precision change would have        #
-- #  applied silently and moved a number on the stats page for no reason,    #
-- #  because Postgres does not police an expression, only a type. A diff is  #
-- #  the only thing that catches the second kind.                            #
-- #                                                                          #
-- #  Section 2 re-creates v_yearly_breakdown, whose live definition has      #
-- #  never been in this repo at all. It began as a reconstruction and HAS    #
-- #  NOW BEEN DIFFED (2026-08-22) against both pg_get_viewdef and the live   #
-- #  rows. The core semantics match; it ships three deliberate differences,  #
-- #  each recorded as a decision in section 2's own header. Read those       #
-- #  before running it. Counts are bigint, as section 1's were.              #
-- #                                                                          #
-- #  The verification harness for section 2 is a separate file, and steps    #
-- #  1 to 3 of it must run BEFORE section 2 because they interrogate the     #
-- #  definition being replaced:                                              #
-- #                                                                          #
-- #    scripts/sql/2026-08-19-yearly-breakdown-verification.sql              #
-- ############################################################################
--
-- Run this in the Supabase dashboard SQL editor (or psql). Safe to re-run.
-- It DEPENDS on batchport.v_trip_days, created in 2026-08-19-expenses.sql, so
-- run that one first. It is otherwise independent of the expenses feature and
-- can be applied or reverted on its own.
--
-- WHY
--
-- src/lib/trip-dates.ts (resolveTripDates) says a dated trip's range is its
-- stops, and the stored trips.start_date / end_date columns are the fallback
-- for a trip nobody has dated a stop on. Every read path in the app applies
-- that. v_user_travel_summary.days_traveling does not: it reads the stored
-- columns directly, because a view cannot call a TypeScript function.
--
-- lib/trip-schedule.ts keeps the columns in sync so the two agree in practice,
-- but that sync is best-effort by design (it logs rather than throwing), and
-- scripts/resync-trip-schedules.ts exists precisely because the columns are
-- the weak link. So "the views are allowed to be stale" was a tolerable gap
-- while nothing else derived a trip's length in SQL.
--
-- The expenses feature does derive it in SQL (v_trip_expense_summary.trip_days
-- feeds the cost-per-day figure, which is the whole point of the feature). Two
-- SQL views deriving a trip's length two ways would print two different day
-- counts on two pages of the same app, and the person hitting that has no way
-- to tell which to believe. So both read one object, v_trip_days, which is the
-- SQL mirror of resolveTripDates.
--
-- This also demotes the column sync from a correctness dependency to an
-- optimization, which is where a best-effort write belongs.
--
-- BEFORE RUNNING
--
-- Run scripts/resync-trip-schedules.ts first:
--
--   npm run resync-trip-schedules -- --dry-run
--   npm run resync-trip-schedules
--
-- With the columns already in sync this change is a no-op on today's data. If
-- a number DOES move afterwards, that is a trip whose stored columns were
-- stale, which is a finding rather than a regression.
--
-- The live view definition is stored only in Supabase. Compare before running:
--
--   select pg_get_viewdef('batchport.v_user_travel_summary', true);
--
-- The statement below is the definition from 2026-07-18-experience-status.sql
-- with ONLY the travel_days CTE changed. If the live shape has drifted
-- (world_pct denominator, extra columns), keep the live definition and merge
-- in only the travel_days change.
--
-- CREATE OR REPLACE VIEW fails with "cannot change name of view column" when
-- the column order differs. The column set here is unchanged, so replace
-- should succeed; if it does not, drop and re-create, then re-issue the grant
-- at the bottom of this file (a drop takes its grants with it).
--
-- security_invoker is spelled explicitly rather than relied on to survive a
-- replace. Every view in this schema has it, and a checked-in statement that
-- omits it is a re-run away from being the one that does not.

-- 1. v_user_travel_summary --------------------------------------------------

create or replace view batchport.v_user_travel_summary
with (security_invoker = true) as
with users as (
  select distinct user_id from batchport.trips
),
trips_all as (
  -- A planned trip is still a trip; only its stops and experiences are
  -- excluded from the visited aggregates below.
  select user_id, count(*) as total_trips
  from batchport.trips
  group by user_id
),
visited as (
  select
    d.user_id,
    count(distinct d.country_code)
      filter (where d.country_code is not null) as countries_visited,
    count(distinct c.continent)
      filter (where c.continent is not null) as continents_visited,
    count(*) as total_destinations
  from batchport.destinations d
  join batchport.trips t on t.id = d.trip_id and t.status <> 'planned'
  left join batchport.countries c on c.code = d.country_code
  group by d.user_id
),
done_experiences as (
  select e.user_id, count(*) as total_experiences
  from batchport.experiences e
  join batchport.destinations d on d.id = e.destination_id
  join batchport.trips t on t.id = d.trip_id and t.status <> 'planned'
  where e.status <> 'planned'
  group by e.user_id
),
travel_days as (
  -- THE ONLY CHANGE IN THIS VIEW. It was sum(end_date - start_date + 1)
  -- straight off the trips columns. v_trip_days resolves the stops first and
  -- falls back to those columns, which is what src/lib/trip-dates.ts does and
  -- therefore what every screen in the app already shows.
  --
  -- The type is preserved along with the semantics: v_trip_days.days is
  -- integer (a date minus a date), sum() of integer is bigint, and the live
  -- column was bigint from sum() for the same reason. No cast.
  select user_id, coalesce(sum(days), 0) as days_traveling
  from batchport.v_trip_days
  where status <> 'planned'
    and days is not null
  group by user_id
)
select
  u.user_id,
  coalesce(v.countries_visited, 0) as countries_visited,
  -- Live precision, left alone: one decimal, and divided before it is scaled.
  round(coalesce(v.countries_visited, 0)::numeric / 195 * 100, 1) as world_pct,
  coalesce(v.continents_visited, 0) as continents_visited,
  coalesce(t.total_trips, 0) as total_trips,
  coalesce(v.total_destinations, 0) as total_destinations,
  coalesce(e.total_experiences, 0) as total_experiences,
  coalesce(td.days_traveling, 0) as days_traveling
from users u
left join trips_all t on t.user_id = u.user_id
left join visited v on v.user_id = u.user_id
left join done_experiences e on e.user_id = u.user_id
left join travel_days td on td.user_id = u.user_id;

grant select on batchport.v_user_travel_summary to anon, authenticated;

-- 2. v_yearly_breakdown -----------------------------------------------------
--
-- Same staleness, one level worse: it buckets a trip into a YEAR off
-- trips.start_date, so a stale column does not merely shorten a trip, it can
-- file the whole trip under the wrong year.
--
-- DIFFED AGAINST THE LIVE DEFINITION 2026-08-22. The statement below started
-- as a re-creation from the four columns the app reads (year, trips,
-- countries, new_countries, keyed by user_id, see getYearlyBreakdown in
-- src/lib/stats-data.ts), because this view's definition has never been in the
-- repo. It has since been compared against pg_get_viewdef and against the
-- live rows (scripts/sql/2026-08-19-yearly-breakdown-verification.sql).
--
-- VERDICT: the core semantics match. Live builds first_visit as min(yr) per
-- country, which is the earliest-year rule this statement implements, and it
-- excludes planned trips. The planned exclusion was confirmed EMPIRICALLY
-- (step 3b: the planned-excluded candidate matched live on all 8 rows, and the
-- planned-included one diverged on a 2026 planned trip live correctly omits).
-- The new_countries rule was confirmed BY DEFINITION and could not be
-- confirmed by data: step 3b reported multi_year_countries = 0, so no country
-- in either account has been visited in two different years and both candidate
-- rules reproduce live exactly. That is the vacuous pass the step exists to
-- report rather than hide.
--
-- THREE DELIBERATE DIFFERENCES FROM LIVE. None is caught by the type contract,
-- so each is a decision recorded here rather than an accident of how a CTE got
-- written.
--
--  1. NULL country_code is filtered out, and live does not filter it.
--     This is a FIX, not preserved semantics. Live's dest_years keeps rows
--     with a null country_code, so first_visit forms a null group that
--     new_per_year counts as a new country, while countries_per_year drops it
--     through count(distinct). Live can therefore report new_countries GREATER
--     THAN countries, which renders as "3 countries, 4 new" on the stats page
--     and feeds the recap's insight ladder.
--
--     Shipped inside this migration rather than separately for one reason: the
--     usual argument for one change at a time is that a bundled change hides
--     in the diff, and this one cannot. destinations.country_code is nullable
--     and a stop saved without a location is an ordinary state in this app, so
--     the case is reachable; but where no such stop exists the fix is provably
--     inert and produces byte-identical rows. Where such stops DO exist the
--     verification harness's step 4 shows exactly which years moved, so the
--     change is visible either way.
--
--     CONFIRMED 0 ON 2026-08-22, across every destination in the project, so
--     this fix changed nothing on the day it was applied and is purely
--     forward-looking. Re-check before applying this file to any other data:
--
--       select count(*) filter (where country_code is null)
--       from batchport.destinations;
--
--  2. The year gate is v_trip_days.start_date; live gates on
--     t.start_date is not null. This is the intended improvement and the
--     reason the file exists: a trip whose stored columns are null but whose
--     stops carry dates gets a year here and is dropped entirely by live.
--     Identical output whenever the columns are in sync, which is what
--     scripts/resync-trip-schedules.ts guarantees, and correct rather than
--     merely identical when they are not.
--
--  3. The three aggregate CTEs are joined LEFT from year_trips; live FULL
--     JOINs them. Equivalent for which rows exist, and provably so rather than
--     by inspection: year_countries derives from trip_countries, which derives
--     from trip_years, which is exactly what year_trips groups, so its key set
--     is a subset and the LEFT JOIN is complete.
--
--     One value difference rides on it. A year with trips but no
--     country-coded stops appears in year_trips and not in year_countries;
--     this statement coalesces countries to 0 and live's FULL JOIN would leave
--     it null. Same on screen (num() coerces null to 0) and the same column
--     type, so CREATE OR REPLACE will not object, but step 4 of the harness
--     would show it as a changed row.
--
--     Note the trigger is NOT a null country_code, which is the easy thing to
--     assume given difference 1. With no null country codes anywhere, every
--     trip holding at least one destination reaches year_countries, so this
--     reduces to a non-planned trip with NO DESTINATIONS AT ALL:
--
--       select t.id, t.name from batchport.trips t
--       where t.status <> 'planned'
--         and not exists (
--           select 1 from batchport.destinations d where d.trip_id = t.id
--         );
--
--     If that is empty, this rider is inert alongside the other two and step 4
--     has no expected exceptions at all, which makes any row it returns a real
--     finding rather than something to reconcile. Not confirmed at the time of
--     writing: the 0 confirmed on 2026-08-22 was null country codes
--     (difference 1), which is a different question from a stopless trip.
--
-- If any of the above is not what you want, keep the live definition and swap
-- only the date source into it:
--
--   join batchport.v_trip_days td on td.trip_id = t.id
--
-- reading td.start_date in place of t.start_date.

create or replace view batchport.v_yearly_breakdown
with (security_invoker = true) as
with trip_years as (
  -- The resolved start date decides the year. Planned trips are excluded, as
  -- everywhere else. A trip that resolves to no date at all drops out here;
  -- the app also defensively filters null years on read.
  --
  -- extract() returns numeric, and a year is not a numeric, so this cast is
  -- deliberate rather than the reflex that broke section 1. It is also the one
  -- column here whose live type is a real question: confirm it against
  -- pg_get_viewdef before running, because CREATE OR REPLACE will refuse a
  -- change and (worse) a matching type with different rounding would not.
  select
    td.user_id,
    td.trip_id,
    extract(year from td.start_date)::int as year
  from batchport.v_trip_days td
  where td.status <> 'planned'
    and td.start_date is not null
),
trip_countries as (
  select distinct
    ty.user_id,
    ty.year,
    d.country_code
  from trip_years ty
  join batchport.destinations d on d.trip_id = ty.trip_id
  -- DIFFERENCE 1 IN THE HEADER, and the whole of it. Live keeps these rows,
  -- which lets a null country_code form its own first_visit group and be
  -- counted as a new country while count(distinct) drops it from the total.
  -- Removing this line reproduces live exactly, bug included.
  where d.country_code is not null
),
first_seen as (
  -- The year a country was first reached, so "new" means new to the traveller
  -- rather than new to the year.
  select user_id, country_code, min(year) as first_year
  from trip_countries
  group by user_id, country_code
),
year_trips as (
  -- Counts are left as bigint, matching the house style the live views use.
  -- Casting them to int is what made section 1 fail.
  select user_id, year, count(distinct trip_id) as trips
  from trip_years
  group by user_id, year
),
year_countries as (
  select
    tc.user_id,
    tc.year,
    count(*) as countries,
    count(*) filter (where fs.first_year = tc.year) as new_countries
  from trip_countries tc
  join first_seen fs
    on fs.user_id = tc.user_id
   and fs.country_code = tc.country_code
  group by tc.user_id, tc.year
)
select
  yt.user_id,
  yt.year,
  yt.trips,
  coalesce(yc.countries, 0) as countries,
  coalesce(yc.new_countries, 0) as new_countries
from year_trips yt
left join year_countries yc
  on yc.user_id = yt.user_id
 and yc.year = yt.year;

grant select on batchport.v_yearly_breakdown to anon, authenticated;

-- Not touched, and deliberately: batchport.f_distance_traveled measures
-- between destinations rather than reading trip dates, so it is unaffected by
-- everything in this file.

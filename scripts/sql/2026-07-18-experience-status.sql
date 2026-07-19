-- Trip planner: planned experiences.
--
-- Adds a status column to experiences ('planned' ideas vs 'done' logged
-- activities) and excludes planned experiences from the two stats surfaces
-- that count experiences. Run in the Supabase SQL editor.
--
-- The app degrades gracefully until this runs: writes retry without the
-- status key on PGRST204, reads treat a missing status as 'done', and the
-- stats layer applies a defensive app-side subtraction of planned rows.

-- 1. The status column ------------------------------------------------------

alter table batchport.experiences
  add column if not exists status text not null default 'done'
  check (status in ('planned', 'done'));

-- 2. Stats views ------------------------------------------------------------
--
-- The live view definitions are stored only in Supabase (see
-- 2026-07-16-stats-exclude-planned-trips.sql, which documents the
-- planned-trips filter without full statements). The statements below
-- re-create both experience-counting views with that filter plus the new
-- e.status <> 'planned' predicate. Before running, compare with the live
-- definitions:
--
--   select pg_get_viewdef('batchport.v_user_travel_summary', true);
--   select pg_get_viewdef('batchport.v_experiences_by_category', true);
--
-- If the live shape differs (world_pct denominator, days_traveling formula,
-- extra columns), keep the live definition and merge in only the
-- "e.status <> 'planned'" predicate wherever experiences are aggregated.
--
-- CREATE OR REPLACE VIEW fails with "cannot change name of view column" when
-- the column order differs from the live view. In that case drop first:
--
--   drop view batchport.v_user_travel_summary;
--   drop view batchport.v_experiences_by_category;
--
-- (PostgREST selects columns by name, so a drop and re-create is safe.)

create or replace view batchport.v_experiences_by_category as
select
  e.user_id,
  c.slug,
  c.label,
  c.color,
  count(*)::int as experience_count,
  round(avg(e.rating)::numeric / 2, 1) as avg_rating_stars
from batchport.experiences e
join batchport.categories c on c.id = e.category_id
where e.status <> 'planned'
group by e.user_id, c.slug, c.label, c.color;

create or replace view batchport.v_user_travel_summary as
with users as (
  select distinct user_id from batchport.trips
),
trips_all as (
  -- A planned trip is still a trip; only its stops and experiences are
  -- excluded from the visited aggregates below.
  select user_id, count(*)::int as total_trips
  from batchport.trips
  group by user_id
),
visited as (
  select
    d.user_id,
    count(distinct d.country_code)
      filter (where d.country_code is not null)::int as countries_visited,
    count(distinct c.continent)
      filter (where c.continent is not null)::int as continents_visited,
    count(*)::int as total_destinations
  from batchport.destinations d
  join batchport.trips t on t.id = d.trip_id and t.status <> 'planned'
  left join batchport.countries c on c.code = d.country_code
  group by d.user_id
),
done_experiences as (
  select e.user_id, count(*)::int as total_experiences
  from batchport.experiences e
  join batchport.destinations d on d.id = e.destination_id
  join batchport.trips t on t.id = d.trip_id and t.status <> 'planned'
  where e.status <> 'planned'
  group by e.user_id
),
travel_days as (
  select user_id,
         coalesce(sum(end_date - start_date + 1), 0)::int as days_traveling
  from batchport.trips
  where status <> 'planned'
    and start_date is not null
    and end_date is not null
  group by user_id
)
select
  u.user_id,
  coalesce(v.countries_visited, 0) as countries_visited,
  round(coalesce(v.countries_visited, 0)::numeric * 100 / 195, 2) as world_pct,
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

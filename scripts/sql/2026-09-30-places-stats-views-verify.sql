-- Places, phase 2: verification for 2026-09-30-places-stats-views.sql.
--
-- A SEPARATE FILE so that no query here ever has to be run by highlighting it
-- inside the migration. Open this file in its own SQL editor tab and run one
-- query at a time. Nothing in it writes.
--
--   0  v_state_coverage per user. Run BEFORE and AFTER the migration.
--   A  every place's state is visited on the map. Expected: no rows.
--   B  type counters sum to total_places. Expected: no rows.
--   C  catalog progress, 7 rows per user. Eyeball the totals.
--   D  summary states_visited equals the map's count less DC. Expected: no rows.
--   E  yearly new_places sum to places with a visit to date. Expected: no rows.

-- ===========================================================================
-- VERIFICATION (select only; nothing here writes)
-- ===========================================================================
--
-- These run in the SQL editor, which is the SERVICE ROLE and bypasses RLS.
-- They check the arithmetic and the before/after of the two replaced views.
-- They cannot check the access model; that needs the anon and authenticated
-- keys and belongs in scripts/check-places-schema.ts.

-- 0. BEFORE AND AFTER: v_state_coverage's output per user. Run it on its own
--    BEFORE applying the migration, keep the result, and run it again after. Any
--    difference is presence that moved. Only two things may move it: a place
--    whose visits are all after today, or a stop on a non-planned trip whose
--    arrival is after today. A read-only probe on 2026-09-30 found NEITHER in
--    the data (zero future place visits, zero future-arriving stops on
--    non-planned trips), so the two runs are expected to be identical.
select
  user_id,
  count(*) as grid_rows,
  count(*) filter (where visited) as visited_incl_dc,
  sum(point_count) as points,
  string_agg(
    state_code || ':' || coalesce(first_visit_date::text, '-'),
    ',' order by state_code
  ) filter (where visited) as visited_states
from batchport.v_state_coverage
group by user_id
order by user_id;

-- A. Regression: every state v_place_state resolves is visited in
--    v_state_coverage. Both now read v_presence_state, so this can only fail
--    if one of them stops doing so. Expected: no rows.
select ps.user_id, ps.place_id, ps.state_code
from batchport.v_place_state ps
left join batchport.v_state_coverage sc
  on sc.user_id = ps.user_id
 and sc.state_code = ps.state_code
where ps.state_code is not null
  and sc.visited is not true;

-- B. Type counters sum to the total. Any row means a place_type value exists
--    that v_place_counts has no column for. Expected: no rows.
select *
from batchport.v_place_counts
where cities + campuses + stadiums + parks + landmarks + others <> total_places;

-- C. Catalog totals are the loaded membership counts, and every user with a
--    counted place has all seven. Eyeball: 7 rows per user, the totals the
--    loader reported (ncaa_basketball_arenas 374, ncaa_fbs_football 136).
select user_id, catalog_slug, total, visited, pct
from batchport.v_catalog_progress
order by user_id, sort_order;

-- D. Summary against the map. states_visited must equal v_state_coverage's
--    own visited count less DC. Expected: no rows.
select s.user_id, s.states_visited, cov.n as coverage_states_ex_dc
from batchport.v_places_summary s
join (
  select user_id, count(*) filter (where visited and state_code <> 'DC') as n
  from batchport.v_state_coverage
  group by user_id
) cov on cov.user_id = s.user_id
where s.states_visited <> cov.n;

-- E. The yearly view's new_places sum to the number of places with a visit
--    to date. Expected: no rows.
select y.user_id, y.total_new, p.n as places_with_visits
from (
  select user_id, sum(new_places) as total_new
  from batchport.v_yearly_places
  group by user_id
) y
join (
  select user_id, count(distinct place_id) as n
  from batchport.v_place_visits_to_date
  group by user_id
) p on p.user_id = y.user_id
where y.total_new <> p.n;

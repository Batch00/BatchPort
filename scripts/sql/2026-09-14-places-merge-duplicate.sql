-- One-off repair: merge the two American Family Field places into one.
--
-- NOT a migration. This is a data fix for rows created by a bug (the log flow
-- had no duplicate guard, so logging a catalog venue that was already logged
-- created a second place instead of adding a visit). The guard now lives in
-- createPlaceAction, so this situation cannot recur; this file only cleans up
-- what already happened.
--
-- Read this before running it. It touches exactly two tables and only rows
-- belonging to one user.
--
-- WHAT IT DOES
--   1. Picks the SURVIVOR: the oldest of the duplicate places, so the place's
--      created_at keeps meaning "when I first logged this".
--   2. Re-points every visit of the younger duplicates at the survivor.
--      Visit rows are moved, never recreated, so visit_date, end_date,
--      occasion_id, event_org, event_detail, transport_mode, notes, and their
--      own ids and created_at all survive untouched.
--   3. Deletes the now-visitless duplicate place rows.
--
-- WHAT IT DOES NOT DO
--   - It does not touch the survivor's own columns. locality_key is generated
--     and nothing here changes its inputs.
--   - It does not touch any place whose catalog_item_id is null, so a Photon
--     place that happens to share a name is out of scope.
--   - It does not touch another user's rows: every statement is scoped to the
--     owner below.
--
-- Expected result for the current data: American Family Field becomes one place
-- with TWO visits, 2026-05-12 and 2026-08-29, both keeping event_org
-- "Milwaukee Brewers". Lambeau Field and every other place are untouched.
--
-- SAFE TO RE-RUN: once merged there are no duplicates left to find, so a second
-- run does nothing.

-- The account to repair. Change this if you run it for somebody else.
\set owner '1ca08f60-c0eb-4fae-8297-1a2c73fb9cfc'

begin;

-- What is about to be merged. Read this output before committing.
with dupes as (
  select
    catalog_item_id,
    count(*) as place_rows,
    min(created_at) as oldest,
    string_agg(id::text, ', ' order by created_at) as ids
  from batchport.places
  where user_id = :'owner'
    and catalog_item_id is not null
  group by catalog_item_id
  having count(*) > 1
)
select
  c.name,
  d.place_rows,
  d.ids
from dupes d
join batchport.place_catalog_items c on c.id = d.catalog_item_id;

-- 1 and 2. Move the visits onto the survivor.
with ranked as (
  select
    id,
    catalog_item_id,
    row_number() over (partition by catalog_item_id order by created_at, id) as rn
  from batchport.places
  where user_id = :'owner'
    and catalog_item_id is not null
    and catalog_item_id in (
      select catalog_item_id
      from batchport.places
      where user_id = :'owner' and catalog_item_id is not null
      group by catalog_item_id
      having count(*) > 1
    )
),
survivor as (select catalog_item_id, id from ranked where rn = 1),
doomed as (select catalog_item_id, id from ranked where rn > 1)
update batchport.place_visits v
set place_id = s.id,
    updated_at = now()
from doomed d
join survivor s on s.catalog_item_id = d.catalog_item_id
where v.place_id = d.id
  and v.user_id = :'owner';

-- 3. Remove the duplicates, which now have no visits.
--
-- The visitless check is a belt: if step 2 somehow missed a visit, the delete
-- would cascade it away, and a cascade is not what this repair is for.
with ranked as (
  select
    id,
    catalog_item_id,
    row_number() over (partition by catalog_item_id order by created_at, id) as rn
  from batchport.places
  where user_id = :'owner'
    and catalog_item_id is not null
)
delete from batchport.places p
using ranked r
where p.id = r.id
  and r.rn > 1
  and p.user_id = :'owner'
  and not exists (select 1 from batchport.place_visits v where v.place_id = p.id);

-- What the result looks like. Expect American Family Field, 2 visits.
select
  p.name,
  p.locality_key,
  count(v.id) as visits,
  min(v.visit_date) as first_visit,
  max(v.visit_date) as latest_visit,
  string_agg(distinct v.event_org, ', ') as event_orgs
from batchport.places p
left join batchport.place_visits v on v.place_id = p.id
where p.user_id = :'owner'
group by p.id, p.name, p.locality_key
order by min(v.visit_date) nulls last;

-- Inspect the two result sets above, then:
commit;
-- or, if anything looks wrong:
-- rollback;

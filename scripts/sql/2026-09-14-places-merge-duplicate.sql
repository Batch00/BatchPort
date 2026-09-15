-- One-off repair: merge duplicate places that share a catalog venue into one.
--
-- Run this in the Supabase dashboard SQL editor. Safe to re-run: once merged
-- there are no duplicates left to find and it does nothing.
--
-- NOT a migration. This is a data fix for rows created by a bug: the log flow
-- had no duplicate guard, so logging a catalog venue that was already logged
-- created a second place instead of adding a visit. The guard now lives in
-- createPlaceAction, sharing lib/place-dedup.ts with scripts/seed-places.ts, so
-- this cannot recur; this file only cleans up what already happened.
--
-- DIALECT, third attempt, and the reason it took three. The editor is not psql
-- and it is not one psql session:
--
--   1. \set and :'owner' are psql CLIENT meta-commands. psql expands them
--      before sending anything, so the server never sees valid SQL.
--   2. A TEMPORARY table is session-scoped, and the editor does not hold one
--      session across statements, so a later statement cannot see it:
--      42P01 relation "_merge_owner" does not exist.
--   3. begin; / commit; are unnecessary: the editor wraps statements itself.
--
-- What the sibling files in this directory actually use, all of which have run
-- here successfully: no transaction control, no temp tables, no backslash
-- commands, plain top-level statements, and DO blocks. This file uses exactly
-- that and nothing else.
--
-- WHY A DO BLOCK RATHER THAN ONE CTE CHAIN. A data-modifying CTE runs all of
-- its sub-statements against ONE SNAPSHOT with no guaranteed ordering between
-- them. place_visits.place_id is ON DELETE CASCADE, so a chain that moved the
-- visits and deleted the old places in a single statement could have the
-- cascade take away the very rows the update had just re-pointed. Inside a DO
-- block the two statements run in order, so the move provably completes before
-- the delete. Correctness first; it is one statement either way.
--
-- WHAT IT DOES
--   1. Picks the SURVIVOR: the oldest place per catalog item, so created_at
--      keeps meaning "when I first logged this". Same rule the app's dedup uses
--      (lib/place-dedup.ts matches oldest-first), so the two cannot disagree.
--   2. MOVES every visit off the younger duplicates onto the survivor. Visit
--      rows are re-pointed, never recreated, so visit_date, end_date,
--      occasion_id, event_org, event_detail, transport_mode, notes, and their
--      own ids and created_at all survive untouched.
--   3. Deletes the now-visitless duplicates, behind a not-exists guard so a
--      visit that somehow did not move cannot be cascaded away.
--
-- WHAT IT DOES NOT TOUCH
--   - The survivor's own columns. locality_key is generated and nothing here
--     changes its inputs.
--   - Any place with a null catalog_item_id, so a geocoded place that happens
--     to share a name is out of scope.
--   - Any other account. The owner id below is the only account referenced.

do $$
declare
  -- The account to repair. The only place this id appears.
  v_owner constant uuid := '1ca08f60-c0eb-4fae-8297-1a2c73fb9cfc';
  v_moved integer;
  v_deleted integer;
begin
  -- 1 and 2. Move the visits onto the survivor.
  with ranked as (
    select
      p.id,
      p.catalog_item_id,
      row_number() over (
        partition by p.catalog_item_id order by p.created_at, p.id
      ) as rn
    from batchport.places p
    where p.user_id = v_owner
      and p.catalog_item_id is not null
  ),
  survivor as (
    select catalog_item_id, id from ranked where rn = 1
  ),
  doomed as (
    select d.id, s.id as survivor_id
    from ranked d
    join survivor s on s.catalog_item_id = d.catalog_item_id
    where d.rn > 1
  )
  update batchport.place_visits v
  set place_id = d.survivor_id,
      updated_at = now()
  from doomed d
  where v.place_id = d.id
    and v.user_id = v_owner;
  get diagnostics v_moved = row_count;

  -- 3. Remove the duplicates, which now have no visits.
  --
  -- `ranked` is recomputed here rather than carried over, and that is safe:
  -- it reads only created_at and catalog_item_id, neither of which the update
  -- above touched, so it ranks the same rows the same way.
  with ranked as (
    select
      p.id,
      row_number() over (
        partition by p.catalog_item_id order by p.created_at, p.id
      ) as rn
    from batchport.places p
    where p.user_id = v_owner
      and p.catalog_item_id is not null
  )
  delete from batchport.places p
  using ranked r
  where p.id = r.id
    and r.rn > 1
    and p.user_id = v_owner
    and not exists (
      select 1 from batchport.place_visits v where v.place_id = p.id
    );
  get diagnostics v_deleted = row_count;

  raise notice 'visits moved: %, duplicate places deleted: %', v_moved, v_deleted;
end
$$;


-- ---------------------------------------------------------------------------
-- VERIFICATION. Run this separately, after the block above.
--
-- The raise notice may not surface in the editor, so this select is the actual
-- evidence rather than a convenience. Expect American Family Field once, with
-- 3 visits (2026-05-12, 2026-08-29, 2026-09-10), and dupes = 0 on every row.
-- ---------------------------------------------------------------------------

select
  p.name,
  p.locality_key,
  count(v.id) as visits,
  min(v.visit_date) as first_visit,
  max(v.visit_date) as latest_visit,
  -- PARTITION BY groups NULLs TOGETHER (unlike `=`, which yields NULL for
  -- them), so partitioning on catalog_item_id alone put every non-catalog
  -- place in one partition and had each report the other ten as "sharing its
  -- venue". A place with no catalog item shares a venue with nothing.
  case
    when p.catalog_item_id is null then 0
    else count(*) over (partition by p.catalog_item_id) - 1
  end as other_rows_sharing_this_venue
from batchport.places p
left join batchport.place_visits v on v.place_id = p.id
where p.user_id = '1ca08f60-c0eb-4fae-8297-1a2c73fb9cfc'
group by p.id, p.name, p.locality_key, p.catalog_item_id
order by p.name;

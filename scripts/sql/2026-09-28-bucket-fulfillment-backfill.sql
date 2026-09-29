-- One-off: fulfill existing bucket list items from existing trips.
--
-- Run this in the Supabase dashboard SQL editor, AFTER
-- 2026-09-28-bucket-fulfillment.sql (it reads the view that file creates).
-- Safe to re-run: the view only lists unfulfilled items, so a second run finds
-- nothing to do.
--
-- Three parts, run SEPARATELY and in order:
--
--   1. REPORT. Writes nothing. Every place item with its nearest qualifying
--      stop and the distance, matched or not, so the 25km radius can be
--      eyeballed against real near misses; then every country item and
--      whether it matched.
--   2. APPLY. A DO block that fulfills exactly what the view lists.
--   3. VERIFY. What is fulfilled now, by which trip, on which date.
--
-- Dialect matches the siblings that have run here: no \set, no temp tables,
-- no begin/commit, plain statements and one DO block. See the header of
-- 2026-09-14-places-merge-duplicate.sql for why each of those fails in the
-- editor.
--
-- Only the account below is touched. It is the only place its id appears in
-- parts 1 to 3, repeated because the editor runs each part on its own.


-- ---------------------------------------------------------------------------
-- 1. REPORT (writes nothing)
-- ---------------------------------------------------------------------------

-- 1a. Place items: nearest non-planned stop, and whether it is inside 25km.
-- A row with would_match = false and a small distance is the one to look at.
select
  b.place_name,
  n.destination_name as nearest_stop,
  n.trip_name,
  n.trip_status,
  round((n.distance_m / 1000)::numeric, 2) as distance_km,
  n.distance_m <= 25000 as would_match,
  m.trip_name as matched_trip,
  m.fulfilled_on,
  m.date_source
from batchport.bucket_list b
left join lateral (
  select
    d.name as destination_name,
    t.name as trip_name,
    t.status as trip_status,
    st_distance(b.geom::geography, d.geom::geography) as distance_m
  from batchport.destinations d
  join batchport.trips t on t.id = d.trip_id
  where d.user_id = b.user_id
    and t.status in ('completed', 'ongoing')
    and d.geom is not null
  order by b.geom::geography <-> d.geom::geography
  limit 1
) n on true
left join batchport.v_bucket_fulfillment_matches m on m.bucket_id = b.id
where b.user_id = '1ca08f60-c0eb-4fae-8297-1a2c73fb9cfc'
  and b.type = 'place'
  and b.fulfilled_at is null
order by n.distance_m nulls last;

-- 1b. Country items: matched trip, if any.
select
  b.country_code,
  m.destination_name as first_stop_there,
  m.trip_name as matched_trip,
  m.fulfilled_on,
  m.date_source
from batchport.bucket_list b
left join batchport.v_bucket_fulfillment_matches m on m.bucket_id = b.id
where b.user_id = '1ca08f60-c0eb-4fae-8297-1a2c73fb9cfc'
  and b.type = 'country'
  and b.fulfilled_at is null
order by b.country_code;


-- ---------------------------------------------------------------------------
-- 2. APPLY
-- ---------------------------------------------------------------------------

do $$
declare
  v_owner constant uuid := '1ca08f60-c0eb-4fae-8297-1a2c73fb9cfc';
  v_fulfilled integer;
begin
  -- fulfilled_on is a date; the editor's session runs in UTC, so this lands
  -- as midnight UTC on the visit day, which is what the bucket card prints.
  update batchport.bucket_list b
  set fulfilled_trip_id = m.trip_id,
      fulfilled_at = m.fulfilled_on
  from batchport.v_bucket_fulfillment_matches m
  where m.bucket_id = b.id
    and b.user_id = v_owner
    and b.fulfilled_at is null;
  get diagnostics v_fulfilled = row_count;

  raise notice 'bucket items fulfilled: %', v_fulfilled;
end
$$;


-- ---------------------------------------------------------------------------
-- 3. VERIFY. Run separately, after part 2.
-- ---------------------------------------------------------------------------

select
  b.type,
  coalesce(b.place_name, b.country_code) as item,
  t.name as fulfilled_by,
  b.fulfilled_at
from batchport.bucket_list b
left join batchport.trips t on t.id = b.fulfilled_trip_id
where b.user_id = '1ca08f60-c0eb-4fae-8297-1a2c73fb9cfc'
order by b.fulfilled_at nulls last, item;

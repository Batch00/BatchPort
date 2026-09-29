-- Bucket list auto-fulfillment: the match rule, as one view.
--
-- Run this in the Supabase dashboard SQL editor. Safe to re-run.
--
-- NOT a CREATE OR REPLACE of an existing view: the name is new. No table is
-- altered.
--
-- WHY A VIEW. The rule has two readers, the app (lib/bucket-list.ts, after a
-- destination or trip write) and the one-off backfill
-- (2026-09-28-bucket-fulfillment-backfill.sql). Place items match on
-- ST_DWithin over geography, which the app cannot evaluate without SQL, and a
-- second copy of the rule in TypeScript would be a second answer to "have I
-- been here" that drifts from the first. So both read this view.
--
-- THE RULE
--
--  * Only trips with status 'completed' or 'ongoing'. A planned trip is an
--    intention, not a visit (the same line v_presence_points draws).
--  * A stop on an ongoing trip dated in the future has not happened yet, so a
--    stop whose arrival is after today does not count. An undated stop does.
--  * Country items match on country_code equality.
--  * Place items match on proximity: ST_DWithin on geography, 25km. Their
--    country_code is ignored, so a place near a border still matches.
--  * When several stops qualify, the EARLIEST visit wins (ties broken by the
--    closer stop, then by id so the answer is stable). That is the trip that
--    fulfilled it; later returns do not.
--  * fulfilled_on is the visit's date, not today: the stop's arrival, then its
--    departure, then the trip's start and end (the documented fallback chain),
--    and only for a trip nobody has dated at all, the day the trip was
--    recorded. date_source says which answered, so the backfill report shows
--    any row that fell through to the last resort.
--
-- Only unfulfilled items appear. A manual fulfillment is never revisited.
--
-- NOTHING EVER AUTO-UNFULFILLS, deliberately and permanently. A trip set back
-- to planned or a deleted stop leaves the item fulfilled. A silent revocation
-- is worse than a stale fulfillment, because the owner has no way to notice
-- it. Un-fulfilling is the owner's call, from the card.
--
-- security_invoker, so RLS on bucket_list, destinations and trips applies to
-- the caller. RLS is NOT an owner filter here any more than anywhere else:
-- every app read of this view carries .eq("user_id", user.id).

create or replace view batchport.v_bucket_fulfillment_matches
with (security_invoker = true) as
with visits as (
  select
    d.user_id,
    d.id as destination_id,
    d.name as destination_name,
    d.country_code,
    d.geom,
    t.id as trip_id,
    t.name as trip_name,
    coalesce(
      d.arrival_date, d.departure_date, t.start_date, t.end_date,
      t.created_at::date
    ) as visited_on,
    case
      when d.arrival_date is not null then 'arrival'
      when d.departure_date is not null then 'departure'
      when t.start_date is not null then 'trip start'
      when t.end_date is not null then 'trip end'
      else 'trip created'
    end as date_source
  from batchport.destinations d
  join batchport.trips t on t.id = d.trip_id
  where t.status in ('completed', 'ongoing')
    and (d.arrival_date is null or d.arrival_date <= current_date)
),
candidates as (
  select
    b.id as bucket_id,
    b.user_id,
    b.type as bucket_type,
    coalesce(b.place_name, b.country_code) as bucket_label,
    v.destination_id,
    v.destination_name,
    v.trip_id,
    v.trip_name,
    case
      when b.type = 'place'
        then round((st_distance(b.geom::geography, v.geom::geography) / 1000)::numeric, 2)
    end as distance_km,
    v.visited_on as fulfilled_on,
    v.date_source
  from batchport.bucket_list b
  join visits v on v.user_id = b.user_id
  where b.fulfilled_at is null
    and (
      (b.type = 'country' and b.country_code is not null
        and v.country_code = b.country_code)
      or
      (b.type = 'place' and b.geom is not null and v.geom is not null
        and st_dwithin(b.geom::geography, v.geom::geography, 25000))
    )
)
select distinct on (bucket_id)
  bucket_id,
  user_id,
  bucket_type,
  bucket_label,
  destination_id,
  destination_name,
  trip_id,
  trip_name,
  distance_km,
  fulfilled_on,
  date_source
from candidates
order by bucket_id, fulfilled_on, distance_km nulls first, destination_id;

grant select on batchport.v_bucket_fulfillment_matches to authenticated;

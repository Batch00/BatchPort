-- Transport legs: how you got from one stop to the next.
--
-- Run this in the Supabase dashboard SQL editor (or psql). Safe to re-run.
--
-- Until it runs, the app degrades gracefully: the trip page renders no leg
-- rows at all (rather than dead "How did you get here?" affordances), arcs on
-- the globe keep their default styling, the stats page shows no distance
-- breakdown, and the read-only surfaces simply have nothing to show.
--
-- Design notes worth keeping with the schema:
--
--  * A leg BELONGS TO THE ARRIVING DESTINATION, one row per stop, rather than
--    naming an origin and a destination. Order within a trip is already fully
--    determined by destinations.order_index, so a stored origin id would be a
--    second copy of that ordering, and it would be wrong the moment a stop is
--    reordered or deleted. "The leg into stop N" is therefore a unique
--    constraint on destination_id and nothing more, and the leg on the FIRST
--    stop is the journey out from home, which needs no extra modelling.
--
--    The one thing this model cannot express is the journey home after the
--    last stop. That is deliberate: it is not a leg between two things this
--    app knows about, and giving every leg a nullable destination_id to hold
--    it would cost the unique key that makes the rest of this simple.
--
--  * trip_id is denormalized off the destination so the trip page, the globe,
--    and the stats breakdown can each read a trip's (or a user's) legs in one
--    query without a join. Nothing in this app moves a destination between
--    trips, so the copy cannot drift.
--
--  * mode is the only required field. Recording that a leg was a train at all
--    is the whole feature; carrier, duration, distance, and notes are for the
--    people who want them, and the entry sheet asks for none of them.
--
--  * distance_km is an OVERRIDE, not a computed value. The app measures legs
--    as great-circle distance between the two stops, which is honest for a
--    flight and an understatement for a road; a user who knows the real road
--    distance can say so here, and nothing invents one when they do not.

create table if not exists batchport.transport_legs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trip_id uuid not null references batchport.trips (id) on delete cascade,
  destination_id uuid not null references batchport.destinations (id) on delete cascade,
  mode text not null check (
    mode in ('flight', 'train', 'bus', 'car', 'ferry', 'bike', 'walk', 'other')
  ),
  -- "Eurostar", "BA 342", "the overnight bus". Free text on purpose.
  carrier text,
  -- Minutes, capped at two weeks so a typo cannot render as a decade.
  duration_minutes integer check (
    duration_minutes is null
    or (duration_minutes > 0 and duration_minutes <= 20160)
  ),
  distance_km numeric check (distance_km is null or distance_km > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transport_legs_one_per_stop unique (destination_id)
);

-- The read pattern is always "every leg on this trip" or "every leg for this
-- user"; the unique constraint already indexes destination_id.
create index if not exists transport_legs_trip_idx
  on batchport.transport_legs (trip_id);
create index if not exists transport_legs_user_idx
  on batchport.transport_legs (user_id);

alter table batchport.transport_legs enable row level security;

-- Same policy shape as every other user table: full access to your own rows,
-- plus anonymous SELECT through the is_shared() helper so the demo and
-- /share/[slug] surfaces can render legs read-only.
drop policy if exists transport_legs_select on batchport.transport_legs;
create policy transport_legs_select on batchport.transport_legs
  for select
  using (auth.uid() = user_id or batchport.is_shared(user_id));

drop policy if exists transport_legs_insert on batchport.transport_legs;
create policy transport_legs_insert on batchport.transport_legs
  for insert
  with check (auth.uid() = user_id);

drop policy if exists transport_legs_update on batchport.transport_legs;
create policy transport_legs_update on batchport.transport_legs
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists transport_legs_delete on batchport.transport_legs;
create policy transport_legs_delete on batchport.transport_legs
  for delete
  using (auth.uid() = user_id);

grant select on batchport.transport_legs to anon;
grant select, insert, update, delete on batchport.transport_legs to authenticated;

-- Keep updated_at honest. Reuses the trigger function the other batchport
-- tables use if it exists; creates it in the batchport schema otherwise.
create or replace function batchport.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists transport_legs_set_updated_at on batchport.transport_legs;
create trigger transport_legs_set_updated_at
  before update on batchport.transport_legs
  for each row execute function batchport.set_updated_at();

-- Travel journal: one freeform entry per trip per calendar day.
--
-- Run this in the Supabase dashboard SQL editor (or psql). Safe to re-run.
--
-- Until it runs, the app degrades gracefully: the journal section on the trip
-- page renders its day list read-only with a one-line note that journaling is
-- not available yet, saving reports a friendly error instead of pretending to
-- have saved, and the story view simply has no journal text to interleave.
--
-- Design notes worth keeping with the schema:
--
--  * The key is (user_id, trip_id, entry_date). There is deliberately NO
--    destination_id. Which stop a day belongs to is already fully determined
--    by the destination arrival/departure ranges the trip page lays days out
--    with, so storing it a second time would only create a copy that drifts
--    the moment a destination's dates are edited. The read side derives it
--    (see destinationForDate in src/lib/journal.ts).
--
--  * entry_date is a plain date, not a timestamp. "The day you were there" is
--    a calendar day in the place you were standing, not an instant, and the
--    destination date ranges it joins against are dates too.
--
--  * A blank body is not stored. Clearing an entry deletes the row, so
--    "has a journal entry" never needs a length check.

create table if not exists batchport.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trip_id uuid not null references batchport.trips (id) on delete cascade,
  entry_date date not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint journal_entries_unique_day unique (user_id, trip_id, entry_date)
);

-- The read pattern is always "every entry for this trip, in date order".
create index if not exists journal_entries_trip_date_idx
  on batchport.journal_entries (trip_id, entry_date);

alter table batchport.journal_entries enable row level security;

-- Same policy shape as every other user table: full access to your own rows,
-- plus anonymous SELECT through the is_shared() helper so the demo and
-- /share/[slug] surfaces can render the story view read-only.
drop policy if exists journal_entries_select on batchport.journal_entries;
create policy journal_entries_select on batchport.journal_entries
  for select
  using (auth.uid() = user_id or batchport.is_shared(user_id));

drop policy if exists journal_entries_insert on batchport.journal_entries;
create policy journal_entries_insert on batchport.journal_entries
  for insert
  with check (auth.uid() = user_id);

drop policy if exists journal_entries_update on batchport.journal_entries;
create policy journal_entries_update on batchport.journal_entries
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists journal_entries_delete on batchport.journal_entries;
create policy journal_entries_delete on batchport.journal_entries
  for delete
  using (auth.uid() = user_id);

grant select on batchport.journal_entries to anon;
grant select, insert, update, delete on batchport.journal_entries to authenticated;

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

drop trigger if exists journal_entries_set_updated_at on batchport.journal_entries;
create trigger journal_entries_set_updated_at
  before update on batchport.journal_entries
  for each row execute function batchport.set_updated_at();

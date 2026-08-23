-- Trip expenses: what a trip cost, at the transaction level.
--
-- Run this in the Supabase dashboard SQL editor (or psql). Safe to re-run.
--
-- Until it runs, the app degrades gracefully: the expenses summary card is
-- left off the trip page entirely (rather than linking to a route that cannot
-- read), /trips/[id]/expenses says the feature is not set up on this database
-- yet, and the demo surface simply has no spending to show.
--
-- Design notes worth keeping with the schema:
--
--  * PRIVATE BY DESIGN. This is the first table in the app that is NOT
--    readable through is_shared(). That helper grants both the demo account
--    and any user with public sharing enabled, and /share/[slug] resolves a
--    slug for either one, so an is_shared() policy would publish a real
--    person's ledger on their public profile. The policy below uses
--    is_demo_account(), which grants the demo account and nothing else.
--
--    RLS is only half of it. The demo account also has a public_slug, so
--    /share/demo renders the demo user through the same SharedProfileView the
--    demo page uses, and an anon SELECT is legal there. The surface must gate
--    it too: getSharedProfile takes an explicit expenses flag defaulting to
--    false, and only src/app/demo/page.tsx passes true. Two independent gates,
--    because either one alone is wrong.
--
--  * AMOUNTS ARE SIGNED, and subtotals are net. A refund or an offset is a
--    negative row against the charge it cancels (a 689 flight against a -700,
--    a 382 rail pass against a -355), not an adjustment to the original. Zero
--    is never a transaction, so it is rejected rather than stored.
--
--  * amount_usd, NOT amount. The app is USD only and has no FX table. Naming
--    the column for its currency is what keeps the door open cheaply: adding
--    original_amount, original_currency, and fx_rate later is three nullable
--    "add column if not exists" statements with no backfill and no view
--    changes, because amount_usd stays the reporting figure every view sums.
--    A bare "amount" plus a currency column added later would mean backfilling
--    every row and re-reading every view to ask which currency it is summing.
--
--  * destination_id is an OVERRIDE, not the computed answer. Which stop a
--    spend belongs to is already fully determined by the destination date
--    ranges, exactly as it is for a journal day, so storing the derived answer
--    would be a copy that drifts the moment a stop's dates are edited. Null
--    means "derive it" and v_expense_rows below does, under the same boundary
--    rule as lib/stays.ts. A non-null value means the traveller overruled it,
--    the same way transport_legs.distance_km overrules a measured distance.
--
--  * category_id is NULLABLE, and that is the entry model, not an oversight.
--    A day's spending gets logged from a phone in a hostel or it does not get
--    logged at all, so amount plus vendor plus Enter has to be a complete
--    write. Uncategorized is a first-class state, counted in the ledger header
--    so it nags, and swept in one pass later. The alternative was five
--    per-group catch-all categories that exist only to stop entry stalling.
--
--  * is_alcohol is a CROSS-CUT, not a category. Store-bought beer belongs in
--    Groceries and Markets and still counts toward the drinking total. It
--    therefore overlaps Food and Drink, Other, and occasionally Activities,
--    and every surface must present it as "of which alcohol" rather than as a
--    slice alongside the groups.
--
--  * COLUMN TYPES MATCH THE EXISTING STATS VIEWS, which matters for the views
--    at the bottom of this file and for every view phase 1 adds. The house
--    style is:
--
--      - a count is left as bigint. Do NOT write count(*)::int. The live
--        stats views return bigint, stats-data.ts num() coerces either way,
--        and an ::int here would simply disagree with every other view in the
--        schema for no benefit.
--      - money is shaped with round(x, 2), not a ::numeric(12,2) cast.
--      - cast only where the type is genuinely wrong for the value, which in
--        this file is exactly one place: extract() returns numeric and a year
--        is not a numeric.
--
--    This is written down because the first draft of the companion migration
--    (2026-08-19-trip-days-alignment.sql) casts counts to ::int throughout,
--    inherited from the checked-in statement in
--    2026-07-18-experience-status.sql, which does not match the database.
--    CREATE OR REPLACE VIEW caught it there because an existing view has a
--    type contract. A new view has none, so nothing would catch it here.
--
--  * The id may be supplied by the client. It buys two things: the offline
--    queue can replay an expense create idempotently by primary key, and the
--    workbook import can assign a deterministic uuid per source row so it is
--    re-runnable. A server-side duplicate check would be actively wrong here,
--    because two 4.50 coffees at the same cafe on the same day are two real
--    transactions.

-- 1. Reference taxonomy -----------------------------------------------------
--
-- Global and seeded, mirroring batchport.categories: no user_id, no per-user
-- editing. Two levels because a flat four bucket list hid 46 percent of a trip
-- inside one Travel bar, and because the level people plan against (lodging)
-- was buried in the level they book (travel).
--
-- Two deliberate omissions from the first draft of this taxonomy:
--
--   - No separate "Casual and Fast Food" beside Restaurants. It is the one
--     split that has to be adjudicated per transaction and is never queried
--     apart, which is pure entry cost. The tier lives in the vendor name.
--   - Rail is not split into passes and reservations. That is two rows in one
--     trip against a picker row on every transaction forever.
--
-- icon values are lucide kebab-case names, read the same way
-- categories.icon is (see src/components/category-icon.tsx). A name the icon
-- map does not know yet renders as a pin, so seeding ahead of the map is safe.

create table if not exists batchport.expense_groups (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  color text,
  sort_order integer not null default 0
);

create table if not exists batchport.expense_categories (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references batchport.expense_groups (id),
  slug text not null unique,
  label text not null,
  icon text,
  sort_order integer not null default 0
);

create index if not exists expense_categories_group_idx
  on batchport.expense_categories (group_id, sort_order);

insert into batchport.expense_groups (slug, label, color, sort_order) values
  ('transport',     'Transport',     '#60a5fa', 1),
  ('lodging',       'Lodging',       '#a78bfa', 2),
  ('food-and-drink','Food and Drink','#fbbf24', 3),
  ('activities',    'Activities',    '#34d399', 4),
  ('other',         'Other',         '#94a3b8', 5)
on conflict (slug) do update
  set label = excluded.label,
      color = excluded.color,
      sort_order = excluded.sort_order;

insert into batchport.expense_categories (group_id, slug, label, icon, sort_order)
select g.id, v.slug, v.label, v.icon, v.sort_order
from (values
  ('transport',      'flights',                   'Flights',                   'plane',           1),
  ('transport',      'rail',                      'Rail',                      'train-front',     2),
  ('transport',      'transit-and-passes',        'Transit and Passes',        'tram-front',      3),
  ('transport',      'taxi-and-rideshare',        'Taxi and Rideshare',        'car-taxi-front',  4),
  ('transport',      'micromobility',             'Micromobility',             'bike',            5),
  ('transport',      'ferry',                     'Ferry',                     'ship',            6),
  ('transport',      'car-and-fuel',              'Car and Fuel',              'fuel',            7),
  ('lodging',        'hotel',                     'Hotel',                     'hotel',           1),
  ('lodging',        'hostel',                    'Hostel',                    'bed',             2),
  ('lodging',        'short-term-rental',         'Short-term Rental',         'house',           3),
  ('food-and-drink', 'restaurants',               'Restaurants',               'utensils',        1),
  ('food-and-drink', 'cafe-and-bakery',           'Cafe and Bakery',           'coffee',          2),
  ('food-and-drink', 'groceries-and-markets',     'Groceries and Markets',     'shopping-cart',   3),
  ('food-and-drink', 'bars-and-nightlife',        'Bars and Nightlife',        'martini',         4),
  ('activities',     'attractions-and-landmarks', 'Attractions and Landmarks', 'landmark',        1),
  ('activities',     'museums-and-galleries',     'Museums and Galleries',     'building-2',      2),
  ('activities',     'tours-and-guides',          'Tours and Guides',          'compass',         3),
  ('activities',     'outdoors-and-nature',       'Outdoors and Nature',       'trees',           4),
  ('activities',     'entertainment-and-events',  'Entertainment and Events',  'ticket',          5),
  ('activities',     'wellness-and-spa',          'Wellness and Spa',          'flower-2',        6),
  ('other',          'shopping-and-souvenirs',    'Shopping and Souvenirs',    'shopping-bag',    1),
  ('other',          'convenience-and-sundries',  'Convenience and Sundries',  'store',           2),
  ('other',          'fees-and-admin',            'Fees and Admin',            'receipt',         3),
  ('other',          'connectivity',              'Connectivity',              'smartphone',      4),
  ('other',          'health-and-pharmacy',       'Health and Pharmacy',       'pill',            5),
  ('other',          'misc',                      'Misc',                      'circle-ellipsis', 6)
) as v(group_slug, slug, label, icon, sort_order)
join batchport.expense_groups g on g.slug = v.group_slug
on conflict (slug) do update
  set group_id = excluded.group_id,
      label = excluded.label,
      icon = excluded.icon,
      sort_order = excluded.sort_order;

-- 2. The ledger -------------------------------------------------------------

create table if not exists batchport.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trip_id uuid not null references batchport.trips (id) on delete cascade,
  -- The override. Null means "derive it" (see v_expense_rows). A deleted stop
  -- releases the pin rather than taking the spend with it: the money was still
  -- spent on the trip.
  destination_id uuid references batchport.destinations (id) on delete set null,
  -- Optional link to the thing the money was for. Same reasoning on delete.
  experience_id uuid references batchport.experiences (id) on delete set null,
  category_id uuid references batchport.expense_categories (id),
  vendor text,
  amount_usd numeric(12,2) not null check (amount_usd <> 0),
  -- Nullable, and may fall outside the trip window. An expense belongs to a
  -- trip regardless of when it was paid, so a prepaid flight booked in March
  -- for a May trip is a May trip expense with a March date, or with none.
  spent_on date,
  is_alcohol boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The read patterns are "this trip's ledger in date order", "everything this
-- user has spent" (the cross-trip views), and the vendor typeahead, which
-- groups case-insensitively so a vendor typed two ways is one suggestion.
create index if not exists expenses_trip_date_idx
  on batchport.expenses (trip_id, spent_on);
create index if not exists expenses_user_idx
  on batchport.expenses (user_id);
create index if not exists expenses_vendor_idx
  on batchport.expenses (user_id, lower(vendor));

-- 3. Access -----------------------------------------------------------------
--
-- is_demo_account is deliberately NOT is_shared(). It grants the demo account
-- and nothing else, which is the whole privacy model of this feature. security
-- definer for the same reason is_shared() needs it: the anon role cannot read
-- user_settings directly.

create or replace function batchport.is_demo_account(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = batchport, public
as $$
  select exists (
    select 1
    from batchport.user_settings s
    where s.user_id = p_user
      and s.is_demo = true
  );
$$;

alter table batchport.expenses enable row level security;

drop policy if exists expenses_select on batchport.expenses;
create policy expenses_select on batchport.expenses
  for select
  using (auth.uid() = user_id or batchport.is_demo_account(user_id));

drop policy if exists expenses_insert on batchport.expenses;
create policy expenses_insert on batchport.expenses
  for insert
  with check (auth.uid() = user_id);

drop policy if exists expenses_update on batchport.expenses;
create policy expenses_update on batchport.expenses
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists expenses_delete on batchport.expenses;
create policy expenses_delete on batchport.expenses
  for delete
  using (auth.uid() = user_id);

grant select on batchport.expenses to anon;
grant select, insert, update, delete on batchport.expenses to authenticated;

-- The taxonomy is reference data, world-readable like batchport.categories.
grant select on batchport.expense_groups to anon, authenticated;
grant select on batchport.expense_categories to anon, authenticated;

create or replace function batchport.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists expenses_set_updated_at on batchport.expenses;
create trigger expenses_set_updated_at
  before update on batchport.expenses
  for each row execute function batchport.set_updated_at();

-- 4. A trip's range, once ---------------------------------------------------
--
-- The SQL mirror of resolveTripDates in src/lib/trip-dates.ts: a dated trip's
-- range is its stops, and the stored trips.start_date / end_date columns are
-- the fallback for a trip nobody has dated a stop on, never a second opinion
-- about one that has been.
--
-- It exists as its own view rather than inline in the summary below because
-- v_user_travel_summary needs the same answer (see the companion migration
-- 2026-08-19-trip-days-alignment.sql). Two views deriving a trip's length two
-- ways would print two different day counts on two pages of the same app.
--
-- This demotes lib/trip-schedule.ts's column sync from a correctness
-- dependency to an optimization, which is where a best-effort write that logs
-- rather than throws belongs.
--
-- Note it mirrors derivedTripWindow specifically, which does NOT swap a
-- departure typed before its arrival. lib/stays.ts DOES normalize that pair
-- when deciding who owns a day, and v_expense_rows below mirrors stays.ts. The
-- two TypeScript functions differ on that edge today; each view copies the one
-- it is the mirror of rather than harmonizing them unilaterally here.

create or replace view batchport.v_trip_days
with (security_invoker = true) as
with stop_window as (
  select
    d.trip_id,
    min(coalesce(d.arrival_date, d.departure_date)) as start_date,
    max(coalesce(d.departure_date, d.arrival_date)) as end_date
  from batchport.destinations d
  where d.arrival_date is not null
     or d.departure_date is not null
  group by d.trip_id
)
select
  t.user_id,
  t.id as trip_id,
  t.status,
  -- All or nothing: a trip whose stops carry any date takes BOTH ends from
  -- them, exactly as resolveTripDates does. Never one end from each source.
  case when w.trip_id is not null then w.start_date else t.start_date end as start_date,
  case when w.trip_id is not null then w.end_date   else t.end_date   end as end_date,
  case
    when w.trip_id is not null and w.end_date >= w.start_date
      then (w.end_date - w.start_date + 1)
    when w.trip_id is null
      and t.start_date is not null
      and t.end_date is not null
      and t.end_date >= t.start_date
      then (t.end_date - t.start_date + 1)
    else null
  end as days,
  (w.trip_id is not null) as derived
from batchport.trips t
left join stop_window w on w.trip_id = t.id;

grant select on batchport.v_trip_days to anon, authenticated;

-- 5. The resolution layer ---------------------------------------------------
--
-- Every expense with its stop resolved, its taxonomy joined, and nothing
-- aggregated. Every other expense view builds on this one, and the ledger
-- reads it directly for filtering and for "biggest line items"
-- (order by abs(amount_usd) desc), so the attribution rule has exactly one
-- definition in SQL.
--
-- THE BOUNDARY RULE, and it is the same one src/lib/stays.ts applies:
--
--   A day belongs to the stay that ARRIVED most recently on or before it.
--
-- Not "the stop whose range contains it". Ranges overlap at every transfer
-- (a departure date equal to the next arrival) and one stop can nest inside
-- another, so containment returns two answers on the everyday case. Ties break
-- on stored visit order, which also settles a nested stop.
--
-- A day no stay contains belongs to NOBODY, and that is the right answer for a
-- prepaid flight, a spend the day before the trip started, and an undated row:
-- effective_destination_id is null and the spend is the trip's. It is never
-- pushed onto the nearest stop.
--
-- The lateral mirrors stayRange: a stop dated on one side only covers that
-- single day, and a departure typed before its arrival is read as the pair it
-- must have meant.
--
-- This rule now lives in two places, here and in stays.ts. That duplication is
-- accepted (a view cannot call a TypeScript function) and is ASSERTED rather
-- than commented: scripts/check-stays.ts runs this view against a fixture
-- covering the transfer day, the nested stop, the gap day, and the undated
-- stop. Comments do not fail a build.

create or replace view batchport.v_expense_rows
with (security_invoker = true) as
select
  e.id,
  e.user_id,
  e.trip_id,
  t.name as trip_name,
  t.status as trip_status,
  -- What the traveller pinned, kept separate so the ledger can show that an
  -- attribution was overruled rather than derived.
  e.destination_id as pinned_destination_id,
  coalesce(e.destination_id, s.destination_id) as effective_destination_id,
  d.name as destination_name,
  d.country_code,
  d.order_index as destination_order,
  e.experience_id,
  e.category_id,
  c.slug as category_slug,
  c.label as category_label,
  c.icon as category_icon,
  g.slug as group_slug,
  g.label as group_label,
  g.color as group_color,
  e.vendor,
  e.amount_usd,
  e.spent_on,
  -- The one cast in these views, and a deliberate one: extract() returns
  -- numeric and a year is not a numeric. Counts are left alone (see the type
  -- note in the header).
  extract(year from e.spent_on)::int as spend_year,
  e.is_alcohol,
  e.note,
  e.created_at,
  e.updated_at
from batchport.expenses e
join batchport.trips t on t.id = e.trip_id
left join lateral (
  select d2.id as destination_id
  from batchport.destinations d2
  cross join lateral (
    select
      least(
        coalesce(d2.arrival_date, d2.departure_date),
        coalesce(d2.departure_date, d2.arrival_date)
      ) as stay_start,
      greatest(
        coalesce(d2.arrival_date, d2.departure_date),
        coalesce(d2.departure_date, d2.arrival_date)
      ) as stay_end
  ) r
  where e.destination_id is null
    and e.spent_on is not null
    and d2.trip_id = e.trip_id
    and r.stay_start is not null
    and e.spent_on between r.stay_start and r.stay_end
  -- Latest arrival wins, then stored visit order. This IS the boundary rule.
  order by r.stay_start desc, d2.order_index desc
  limit 1
) s on true
left join batchport.destinations d
  on d.id = coalesce(e.destination_id, s.destination_id)
left join batchport.expense_categories c on c.id = e.category_id
left join batchport.expense_groups g on g.id = c.group_id;

grant select on batchport.v_expense_rows to anon, authenticated;

-- 6. Per-trip summary -------------------------------------------------------
--
-- The numbers the trip page card and the expenses page header show.
--
-- undated_usd and unattributed_usd are carried so the surfaces can SAY that
-- the trip total does not equal the sum of the per-stop totals, rather than
-- leaving it to look like a rounding error. A prepaid flight belongs to no
-- stay by design, so the gap is expected and should be named.

create or replace view batchport.v_trip_expense_summary
with (security_invoker = true) as
select
  r.user_id,
  r.trip_id,
  r.trip_name,
  r.trip_status,
  td.start_date,
  td.end_date,
  td.days as trip_days,
  -- Counts stay bigint, and money is shaped with round() rather than a
  -- numeric(12,2) cast. Both are the house style the live stats views already
  -- use, and stats-data.ts num() coerces either way. Casting counts to ::int
  -- here would not have failed (these views are new, so there is no type
  -- contract to violate) and that is exactly why it is worth getting right
  -- now: it would simply have sat there disagreeing with every other view.
  round(sum(r.amount_usd), 2) as total_usd,
  count(*) as txn_count,
  min(r.spent_on) as first_spend_on,
  max(r.spent_on) as last_spend_on,
  case
    when td.days is not null and td.days > 0
      then round(sum(r.amount_usd) / td.days, 2)
    else null
  end as usd_per_day,
  round(coalesce(sum(r.amount_usd) filter (where r.is_alcohol), 0), 2)
    as alcohol_usd,
  round(coalesce(sum(r.amount_usd) filter (where r.spent_on is null), 0), 2)
    as undated_usd,
  round(
    coalesce(
      sum(r.amount_usd) filter (where r.effective_destination_id is null), 0
    ),
    2
  ) as unattributed_usd,
  count(*) filter (where r.category_id is null) as uncategorized_count,
  count(*) filter (where r.amount_usd < 0) as refund_count
from batchport.v_expense_rows r
left join batchport.v_trip_days td on td.trip_id = r.trip_id
group by
  r.user_id, r.trip_id, r.trip_name, r.trip_status,
  td.start_date, td.end_date, td.days;

grant select on batchport.v_trip_expense_summary to anon, authenticated;

-- The remaining metrics views (by group, by category, by day, per destination
-- with days_owned and the on-ground figure, and the vendor typeahead) ship
-- with the ledger surface in the phase 1 migration. This file is what the
-- workbook import needs to run and verify itself against.
--
-- ONE CONTRACT TO CARRY FORWARD, because the imported data proved it matters.
-- v_expense_vendors will offer "this vendor's usual category" as a prefill for
-- fast entry. VENDOR IS NOT CATEGORY, and the real ledger says so twice: the
-- Fram Museum is a museum admission (14) and a museum cafe lunch (4), and
-- Fauno, Belushi's and Bridge Tap each appear as both a bar and a restaurant.
-- So the prefill:
--
--   * applies on vendor SELECTION only, never as a background effect,
--   * never overwrites a row that already carries a category, and
--   * never fires silently while editing an existing row.
--
-- It is a suggestion offered once, not a rule the ledger enforces. A prefill
-- that quietly recategorized the second Fram Museum row would be worse than no
-- prefill at all, because nothing on screen would say it had happened.

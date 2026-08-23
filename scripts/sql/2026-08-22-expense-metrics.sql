-- Expense metrics: the five views the ledger surface reads.
--
-- Run this in the Supabase dashboard SQL editor (or psql). Safe to re-run.
--
-- !! AMENDED 2026-08-23: v_trip_expense_by_day gained spend_usd and refund_usd.
-- !! RE-RUN THIS FILE if you applied an earlier copy, or the per-day chart will
-- !! net refunds away instead of drawing them. The new columns are appended, so
-- !! CREATE OR REPLACE accepts them without a drop.
-- DEPENDS on scripts/sql/2026-08-19-expenses.sql (expenses, v_trip_days,
-- v_expense_rows, v_trip_expense_summary).
--
-- Nothing here is new logic. Every one of these builds on v_expense_rows, so
-- the boundary rule that decides which stop a spend belongs to has exactly one
-- definition in SQL and these five cannot disagree with each other or with
-- lib/stays.ts. If a number looks wrong, it is wrong in v_expense_rows.
--
-- TYPES follow the house style established in the phase 0 file: a count stays
-- bigint, money is shaped with round(x, 2), and nothing is cast unless the
-- type is genuinely wrong for the value. stats-data.ts num() coerces whatever
-- PostgREST serializes.
--
-- All five are security_invoker, so the expenses policy applies: the owner
-- sees their own rows and anon sees the demo account's. That is what lets
-- /demo render spending while /share/[slug] cannot, and it is only half the
-- gate (see the phase 0 header).


-- ===========================================================================
-- 1. Where the money went, by group and by category
-- ===========================================================================
--
-- pct_of_trip is computed with a window over the trip's own total rather than
-- by the caller, so two surfaces cannot round it differently. It is nulled
-- rather than divided when a trip nets to zero, which a trip of pure offsets
-- genuinely can.
--
-- UNCATEGORIZED IS ITS OWN BUCKET, not dropped. category_id is nullable by
-- design (an expense is loggable with amount and vendor alone), so hiding
-- those rows here would make the group chart quietly disagree with the trip
-- total the header prints.

create or replace view batchport.v_trip_expense_by_group
with (security_invoker = true) as
select
  r.user_id,
  r.trip_id,
  coalesce(r.group_slug, 'uncategorized') as group_slug,
  coalesce(r.group_label, 'Uncategorized') as group_label,
  r.group_color,
  round(sum(r.amount_usd), 2) as total_usd,
  count(*) as txn_count,
  round(
    100 * sum(r.amount_usd)
      / nullif(sum(sum(r.amount_usd)) over (partition by r.trip_id), 0),
    1
  ) as pct_of_trip
from batchport.v_expense_rows r
group by
  r.user_id, r.trip_id,
  coalesce(r.group_slug, 'uncategorized'),
  coalesce(r.group_label, 'Uncategorized'),
  r.group_color;

grant select on batchport.v_trip_expense_by_group to anon, authenticated;


create or replace view batchport.v_trip_expense_by_category
with (security_invoker = true) as
select
  r.user_id,
  r.trip_id,
  coalesce(r.group_slug, 'uncategorized') as group_slug,
  coalesce(r.group_label, 'Uncategorized') as group_label,
  r.group_color,
  coalesce(r.category_slug, 'uncategorized') as category_slug,
  coalesce(r.category_label, 'Uncategorized') as category_label,
  r.category_icon,
  round(sum(r.amount_usd), 2) as total_usd,
  count(*) as txn_count,
  round(
    100 * sum(r.amount_usd)
      / nullif(sum(sum(r.amount_usd)) over (partition by r.trip_id), 0),
    1
  ) as pct_of_trip
from batchport.v_expense_rows r
group by
  r.user_id, r.trip_id,
  coalesce(r.group_slug, 'uncategorized'),
  coalesce(r.group_label, 'Uncategorized'),
  r.group_color,
  coalesce(r.category_slug, 'uncategorized'),
  coalesce(r.category_label, 'Uncategorized'),
  r.category_icon;

grant select on batchport.v_trip_expense_by_category to anon, authenticated;


-- ===========================================================================
-- 2. Spend per day, dense
-- ===========================================================================
--
-- A day with no spending is a row with 0, not a missing row, so the chart is a
-- straight read and a gap in the trip is visibly a gap rather than a shorter
-- axis.
--
-- The series spans the UNION of the trip's resolved window and the actual
-- spend dates, not just the window. That matters: the Pre Job Trip's first
-- stop arrives 2025-09-28 and two real expenses are dated 2025-09-27, the
-- departure day from home. Clipping to the window would drop them from the
-- chart while the trip total still counted them, which is the kind of quiet
-- disagreement between two surfaces this whole file exists to avoid.
--
-- Undated rows are absent here and cannot be otherwise. They are in the trip
-- total and in v_trip_expense_summary.undated_usd, which is what the surface
-- should say out loud rather than pretending they fell on a day.

create or replace view batchport.v_trip_expense_by_day
with (security_invoker = true) as
with spend_bounds as (
  select trip_id, min(spent_on) as min_day, max(spent_on) as max_day
  from batchport.expenses
  where spent_on is not null
  group by trip_id
),
bounds as (
  select
    t.id as trip_id,
    t.user_id,
    -- Same all-or-nothing coalesce shape as derivedTripWindow: either side
    -- standing in for the other when only one exists.
    least(
      coalesce(td.start_date, sb.min_day),
      coalesce(sb.min_day, td.start_date)
    ) as from_day,
    greatest(
      coalesce(td.end_date, sb.max_day),
      coalesce(sb.max_day, td.end_date)
    ) as to_day
  from batchport.trips t
  left join batchport.v_trip_days td on td.trip_id = t.id
  left join spend_bounds sb on sb.trip_id = t.id
),
day_series as (
  select b.trip_id, b.user_id, gs::date as spend_date
  from bounds b
  cross join lateral generate_series(b.from_day, b.to_day, interval '1 day') gs
  where b.from_day is not null
    and b.to_day is not null
    and b.to_day >= b.from_day
)
-- AMENDED 2026-08-23: spend_usd and refund_usd added alongside total_usd.
--
-- total_usd is the NET, and a net is the wrong thing to draw. A day holding a
-- 689 charge and a -700 refund nets to -11, which a bar chart renders as a
-- quiet dip on an otherwise ordinary day; the two facts that actually happened
-- are invisible. Same for a "biggest expenses" list: showing 689 without -700
-- beside it is telling half a fact.
--
-- So the gross halves are carried separately and the surfaces draw both. All
-- three columns are kept rather than deriving one, because total_usd is what
-- reconciles against v_trip_expense_summary and the two halves are what get
-- drawn. spend_usd + refund_usd = total_usd by construction (refund_usd is
-- negative or zero).
select
  d.user_id,
  d.trip_id,
  d.spend_date,
  round(coalesce(sum(r.amount_usd), 0), 2) as total_usd,
  round(coalesce(sum(r.amount_usd) filter (where r.amount_usd > 0), 0), 2)
    as spend_usd,
  round(coalesce(sum(r.amount_usd) filter (where r.amount_usd < 0), 0), 2)
    as refund_usd,
  count(r.id) as txn_count,
  round(coalesce(sum(r.amount_usd) filter (where r.is_alcohol), 0), 2)
    as alcohol_usd
from day_series d
left join batchport.v_expense_rows r
  on r.trip_id = d.trip_id
 and r.spent_on = d.spend_date
group by d.user_id, d.trip_id, d.spend_date;

grant select on batchport.v_trip_expense_by_day to anon, authenticated;


-- ===========================================================================
-- 3. Per stop, with days_owned and the on-ground figure
-- ===========================================================================
--
-- The headline planning metric: what a place cost per day.
--
-- days_owned APPLIES THE SAME BOUNDARY RULE as v_expense_rows, deliberately,
-- so the numerator and the denominator agree about who owns a day. Containment
-- would double-count every transfer day (a departure date equal to the next
-- arrival) and the per-stop days would sum to more than the trip's length.
-- Under this rule they sum to exactly the trip's dated days, so the per-city
-- figures reconcile.
--
-- A STOP IS A ROW, NOT A PLACE NAME. The Post Grad Trip begins and ends in
-- London, and those are two stays with their own days, their own spend, and
-- their own cost per day. Never aggregate this view by destination_name.
--
-- ON_GROUND excludes the Transport group and keeps Lodging, because "what a
-- city costs per day" is a question about being there rather than about
-- getting there. A 630 flight landing on an arrival day would otherwise make
-- that city look like a 700 a day city, which is not a fact about the city.
-- Uncategorized rows count as on-ground (`is distinct from`, so a null slug is
-- included): unknown is not the same as transport.
--
-- Stops with no spend still appear, with their days and zeros. A stop you
-- spent nothing at is a real and interesting row.

create or replace view batchport.v_destination_expense
with (security_invoker = true) as
with stay as (
  select
    d.id,
    d.user_id,
    d.trip_id,
    d.name,
    d.country_code,
    d.order_index,
    -- Mirrors stayRange in lib/stays.ts: a stop dated on one side covers that
    -- single day, and a reversed pair is read as the pair it must have meant.
    least(
      coalesce(d.arrival_date, d.departure_date),
      coalesce(d.departure_date, d.arrival_date)
    ) as stay_start,
    greatest(
      coalesce(d.arrival_date, d.departure_date),
      coalesce(d.departure_date, d.arrival_date)
    ) as stay_end
  from batchport.destinations d
),
trip_day as (
  select td.trip_id, gs::date as day
  from batchport.v_trip_days td
  cross join lateral generate_series(td.start_date, td.end_date, interval '1 day') gs
  where td.start_date is not null
    and td.end_date is not null
    and td.end_date >= td.start_date
),
owner_of_day as (
  select tday.trip_id, tday.day, o.id as destination_id
  from trip_day tday
  left join lateral (
    select s.id
    from stay s
    where s.trip_id = tday.trip_id
      and s.stay_start is not null
      and tday.day between s.stay_start and s.stay_end
    -- Latest arrival wins, then stored visit order. THE BOUNDARY RULE, the
    -- same ordering v_expense_rows uses.
    order by s.stay_start desc, s.order_index desc
    limit 1
  ) o on true
),
days_owned as (
  select destination_id, count(*) as days_owned
  from owner_of_day
  where destination_id is not null
  group by destination_id
),
spend as (
  select
    r.effective_destination_id as destination_id,
    sum(r.amount_usd) as total_usd,
    sum(r.amount_usd) filter (where r.group_slug is distinct from 'transport')
      as on_ground_usd,
    sum(r.amount_usd) filter (where r.is_alcohol) as alcohol_usd,
    count(*) as txn_count
  from batchport.v_expense_rows r
  where r.effective_destination_id is not null
  group by r.effective_destination_id
)
select
  s.user_id,
  s.trip_id,
  s.id as destination_id,
  s.name as destination_name,
  s.country_code,
  s.order_index,
  s.stay_start as arrival_date,
  s.stay_end as departure_date,
  coalesce(dow.days_owned, 0) as days_owned,
  round(coalesce(sp.total_usd, 0), 2) as total_usd,
  round(coalesce(sp.on_ground_usd, 0), 2) as on_ground_usd,
  round(coalesce(sp.alcohol_usd, 0), 2) as alcohol_usd,
  coalesce(sp.txn_count, 0) as txn_count,
  case
    when coalesce(dow.days_owned, 0) > 0
      then round(coalesce(sp.total_usd, 0) / dow.days_owned, 2)
    else null
  end as usd_per_day,
  case
    when coalesce(dow.days_owned, 0) > 0
      then round(coalesce(sp.on_ground_usd, 0) / dow.days_owned, 2)
    else null
  end as on_ground_usd_per_day
from stay s
left join days_owned dow on dow.destination_id = s.id
left join spend sp on sp.destination_id = s.id;

grant select on batchport.v_destination_expense to anon, authenticated;


-- ===========================================================================
-- 4. Vendor typeahead
-- ===========================================================================
--
-- Grouped case-insensitively, because "Barcelona Bus" and "Barcelona bus" are
-- one vendor typed twice and should be one suggestion. The label shown is the
-- most recent spelling rather than a normalized one, so the suggestion looks
-- like something the user actually typed.
--
-- last_category_id IS A PREFILL, NOT A RULE, and the imported ledger proves
-- why. Exactly three vendors carry more than one category, verified against
-- this view after the import: the Fram Museum (a 14 admission and a 4 museum
-- cafe lunch), Fauno, and Bridge Tap (each a bar and a restaurant). A vendor
-- does not determine a category. The surface contract, restated here because
-- this view is where the temptation lives:
--
--   * apply on vendor SELECTION only, never as a background effect,
--   * never overwrite a row that already carries a category,
--   * never fire silently while editing an existing row.
--
-- A prefill that quietly recategorized the second Fram Museum row would be
-- worse than no prefill, because nothing on screen would say it had happened.

create or replace view batchport.v_expense_vendors
with (security_invoker = true) as
select
  e.user_id,
  lower(btrim(e.vendor)) as vendor_key,
  (array_agg(
    btrim(e.vendor) order by e.spent_on desc nulls last, e.created_at desc
  ))[1] as vendor_label,
  count(*) as uses,
  round(sum(e.amount_usd), 2) as total_usd,
  max(e.spent_on) as last_spent_on,
  -- The ORDER BY belongs INSIDE the aggregate. Without it this is "some
  -- category this vendor once had", which would be indistinguishable from the
  -- intended value most of the time and wrong exactly when a vendor has been
  -- filed two ways, which is the case the prefill has to get right.
  (array_agg(
    e.category_id order by e.spent_on desc nulls last, e.created_at desc
  ) filter (where e.category_id is not null))[1] as last_category_id,
  count(distinct e.category_id) as distinct_categories
from batchport.expenses e
where e.vendor is not null
  and btrim(e.vendor) <> ''
group by e.user_id, lower(btrim(e.vendor));

grant select on batchport.v_expense_vendors to anon, authenticated;

-- distinct_categories is carried so the entry surface can tell a vendor with
-- one settled category apart from one that has legitimately been two things.
-- Offering a prefill for the Fram Museum at all is arguably wrong; offering it
-- without saying it has been filed two ways certainly is.

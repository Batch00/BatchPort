-- Places, migration 3 of 4: row level security.
--
-- Run this in the Supabase dashboard SQL editor (or psql). Safe to re-run.
-- Requires migration 2.
--
-- Two rules, both learned the expensive way and both written out rather than
-- inherited from how a neighbouring table happens to behave:
--
--  1. A SHARED-READ POLICY IS SCOPED TO anon AND authenticated, never to anon
--     alone. Policies are permissive and OR together, so the owner policy and
--     the shared policy each grant on their own; but a shared policy scoped to
--     anon only means a SIGNED-IN visitor looking at somebody else's public
--     profile matches no policy and reads zero rows, while a signed-out
--     visitor on the same page reads it fine. That is invisible in the SQL
--     editor and invisible to any service-role script.
--
--  2. RLS WITH ZERO POLICIES RETURNS ZERO ROWS AND NO ERROR. Supabase enables
--     RLS on new tables by default, so "the reference tables are world
--     readable" is only true if it is written down. A missing GRANT is the
--     loud failure (42501); a missing policy is the silent one. This is what
--     shipped expense_groups and expense_categories granted-but-policyless
--     and produced an empty category picker over 226 categorised rows.
--
-- Verify with the ANON key, not here. The SQL editor and every service-role
-- script bypass RLS and therefore cannot see either failure. The gate in
-- scripts/check-places-schema.ts does it with the anon key.

-- 1. User data --------------------------------------------------------------

alter table batchport.places enable row level security;
alter table batchport.place_visits enable row level security;

-- Owner: everything, for signed-in users, on their own rows.
drop policy if exists places_select_own on batchport.places;
create policy places_select_own on batchport.places
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists places_insert on batchport.places;
create policy places_insert on batchport.places
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists places_update on batchport.places;
create policy places_update on batchport.places
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists places_delete on batchport.places;
create policy places_delete on batchport.places
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- Shared read: BOTH roles. See rule 1 above.
drop policy if exists places_select_shared on batchport.places;
create policy places_select_shared on batchport.places
  for select
  to anon, authenticated
  using (batchport.is_shared(user_id));

drop policy if exists place_visits_select_own on batchport.place_visits;
create policy place_visits_select_own on batchport.place_visits
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists place_visits_insert on batchport.place_visits;
create policy place_visits_insert on batchport.place_visits
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists place_visits_update on batchport.place_visits;
create policy place_visits_update on batchport.place_visits
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists place_visits_delete on batchport.place_visits;
create policy place_visits_delete on batchport.place_visits
  for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists place_visits_select_shared on batchport.place_visits;
create policy place_visits_select_shared on batchport.place_visits
  for select
  to anon, authenticated
  using (batchport.is_shared(user_id));

grant select on batchport.places to anon;
grant select on batchport.place_visits to anon;
grant select, insert, update, delete on batchport.places to authenticated;
grant select, insert, update, delete on batchport.place_visits to authenticated;

-- 2. Reference data ---------------------------------------------------------
--
-- World readable, service-role writable, and the absence of an insert, update,
-- or delete policy is the write rule: these tables are loaded by
-- scripts/seed-occasions.ts, scripts/seed-place-catalogs.ts, and
-- scripts/load-admin1.ts, and edited by nothing else. Service role bypasses
-- RLS, so those scripts work with no policy naming them.
--
-- admin1_boundaries matters here beyond its own reads: v_state_coverage is
-- security_invoker, so it joins these boundaries AS THE CALLER. Without a read
-- policy the join would match nothing and every user would look like they had
-- visited no states, with no error anywhere. That is the v_expense_rows
-- failure exactly.

alter table batchport.occasions enable row level security;
alter table batchport.place_catalogs enable row level security;
alter table batchport.place_catalog_items enable row level security;
alter table batchport.place_catalog_item_memberships enable row level security;
alter table batchport.admin1_boundaries enable row level security;

drop policy if exists occasions_read on batchport.occasions;
create policy occasions_read on batchport.occasions
  for select to anon, authenticated using (true);

drop policy if exists place_catalogs_read on batchport.place_catalogs;
create policy place_catalogs_read on batchport.place_catalogs
  for select to anon, authenticated using (true);

drop policy if exists place_catalog_items_read on batchport.place_catalog_items;
create policy place_catalog_items_read on batchport.place_catalog_items
  for select to anon, authenticated using (true);

drop policy if exists place_catalog_item_memberships_read
  on batchport.place_catalog_item_memberships;
create policy place_catalog_item_memberships_read
  on batchport.place_catalog_item_memberships
  for select to anon, authenticated using (true);

drop policy if exists admin1_boundaries_read on batchport.admin1_boundaries;
create policy admin1_boundaries_read on batchport.admin1_boundaries
  for select to anon, authenticated using (true);

grant select on batchport.occasions to anon, authenticated;
grant select on batchport.place_catalogs to anon, authenticated;
grant select on batchport.place_catalog_items to anon, authenticated;
grant select on batchport.place_catalog_item_memberships to anon, authenticated;
grant select on batchport.admin1_boundaries to anon, authenticated;

-- 3. Verification helpers ---------------------------------------------------
--
-- The phase 0 gate has to ASSERT that every new table has RLS on and at least
-- one policy, rather than confirm it by reading this file. PostgREST cannot
-- reach pg_catalog and cannot call ST_IsValid, so these two functions are the
-- only way scripts/check-places-schema.ts can ask.
--
-- They are read-only, service-role only, and exist for the gate. pg_class and
-- pg_policies are world readable, so no SECURITY DEFINER is needed or wanted.

create or replace function batchport.places_rls_report()
returns table (table_name text, rls_enabled boolean, policy_count bigint)
language sql
stable
as $$
  select
    c.relname::text,
    c.relrowsecurity,
    (select count(*) from pg_policies p
      where p.schemaname = 'batchport' and p.tablename = c.relname)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'batchport'
    and c.relname in (
      'places', 'place_visits', 'occasions', 'place_catalogs',
      'place_catalog_items', 'place_catalog_item_memberships',
      'admin1_boundaries'
    )
  order by c.relname;
$$;

create or replace function batchport.admin1_validity_report()
returns table (
  code text,
  name text,
  geom_type text,
  is_valid boolean,
  invalid_reason text,
  n_points integer
)
language sql
stable
as $$
  select
    b.code,
    b.name,
    st_geometrytype(b.boundary::geometry)::text,
    st_isvalid(b.boundary::geometry),
    st_isvalidreason(b.boundary::geometry),
    st_npoints(b.boundary::geometry)
  from batchport.admin1_boundaries b
  order by b.name;
$$;

revoke all on function batchport.places_rls_report() from public, anon, authenticated;
revoke all on function batchport.admin1_validity_report() from public, anon, authenticated;
grant execute on function batchport.places_rls_report() to service_role;
grant execute on function batchport.admin1_validity_report() to service_role;

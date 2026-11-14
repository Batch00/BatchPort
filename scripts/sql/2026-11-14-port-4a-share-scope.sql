-- PORT-4 part A: share settings, helpers and lookup functions.
--
-- Additive. Nothing the app shows changes when this runs:
-- * two share settings columns on user_settings (defaults: past trips, no journal)
-- * helper functions in batchport_private that part B's policies call
-- * resolve_share_slug() and demo_user_id(), which the app switches to before part B
-- * signed-in browsers lose INSERT, UPDATE and DELETE on user_settings. Every app
--   write already goes through a server action with the admin client, so the app
--   is unaffected. This closes audit L3 (any account could set is_demo on itself).
--
-- Run by hand in the Supabase SQL editor. Idempotent. See audit-port-4-design.md.

begin;

-- 1. Share settings ------------------------------------------------------------

alter table batchport.user_settings
  add column if not exists share_trip_scope text not null default 'past',
  add column if not exists share_journal boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_settings_share_trip_scope_check'
      and conrelid = 'batchport.user_settings'::regclass
  ) then
    alter table batchport.user_settings
      add constraint user_settings_share_trip_scope_check
      check (share_trip_scope in ('past', 'current', 'all'));
  end if;
end $$;

comment on column batchport.user_settings.share_trip_scope is
  'Trips a shared profile includes: past = completed only, current = completed and ongoing, all = every status. Ignored for the demo account, which shares everything.';
comment on column batchport.user_settings.share_journal is
  'Whether a shared profile includes journal entries on its shared trips. Ignored for the demo account.';

-- 2. Helpers --------------------------------------------------------------------
-- Not in an API-exposed schema: policies can call them, REST cannot. Definer so
-- they can read user_settings and rows the caller is not allowed to see (a place
-- with only a future visit must not look visitless).

create schema if not exists batchport_private;
revoke all on schema batchport_private from public;
grant usage on schema batchport_private to anon, authenticated;

-- 'demo' for the demo account, the owner's trip scope for a shared profile,
-- null when the profile is not shared.
create or replace function batchport_private.share_scope(p_user uuid)
returns text
language sql stable security definer
set search_path = batchport, pg_temp
as $$
  select case when s.is_demo then 'demo'
              when s.public_share_enabled then s.share_trip_scope end
  from batchport.user_settings s
  where s.user_id = p_user
$$;

create or replace function batchport_private.trip_is_public(p_trip uuid)
returns boolean
language sql stable security definer
set search_path = batchport, pg_temp
as $$
  select coalesce((
    select case batchport_private.share_scope(t.user_id)
             when 'demo' then true
             when 'all' then true
             when 'current' then t.status in ('completed', 'ongoing')
             when 'past' then t.status = 'completed'
             else false
           end
    from batchport.trips t
    where t.id = p_trip
  ), false)
$$;

create or replace function batchport_private.destination_is_public(p_destination uuid)
returns boolean
language sql stable security definer
set search_path = batchport, pg_temp
as $$
  select coalesce((
    select batchport_private.trip_is_public(d.trip_id)
    from batchport.destinations d
    where d.id = p_destination
  ), false)
$$;

create or replace function batchport_private.photo_is_public(p_owner_type text, p_owner_id uuid)
returns boolean
language sql stable security definer
set search_path = batchport, pg_temp
as $$
  select case p_owner_type
    when 'trip' then batchport_private.trip_is_public(p_owner_id)
    when 'destination' then batchport_private.destination_is_public(p_owner_id)
    when 'experience' then coalesce((
      select batchport_private.destination_is_public(e.destination_id)
      from batchport.experiences e
      where e.id = p_owner_id
    ), false)
    else false
  end
$$;

-- journal_entries.trip_id is not null, so every entry belongs to a trip.
create or replace function batchport_private.journal_is_public(p_user uuid, p_trip uuid)
returns boolean
language sql stable security definer
set search_path = batchport, pg_temp
as $$
  select case batchport_private.share_scope(p_user)
    when 'demo' then true
    else coalesce((select s.share_journal from batchport.user_settings s
                   where s.user_id = p_user), false)
         and batchport_private.trip_is_public(p_trip)
  end
$$;

-- A place is public when its owner shares it and it has a visit to date or no
-- visits at all (the demo shows everything). It must see future visits the
-- caller cannot: otherwise a place whose only visit is in the future would look
-- visitless to v_place_presence, which counts visitless places as visited, and
-- it would be pinned on the public map.
create or replace function batchport_private.place_is_public(p_place uuid)
returns boolean
language sql stable security definer
set search_path = batchport, pg_temp
as $$
  select coalesce((
    select case batchport_private.share_scope(p.user_id)
             when 'demo' then true
             else batchport_private.share_scope(p.user_id) is not null
               and (
                 exists (select 1 from batchport.place_visits v
                         where v.place_id = p.id and v.visit_date <= current_date)
                 or not exists (select 1 from batchport.place_visits v
                                where v.place_id = p.id)
               )
           end
    from batchport.places p
    where p.id = p_place
  ), false)
$$;

revoke execute on all functions in schema batchport_private from public;
grant execute on all functions in schema batchport_private to anon, authenticated;

-- 3. Lookups the app calls instead of reading user_settings ---------------------

create or replace function batchport.resolve_share_slug(p_slug text)
returns uuid
language sql stable security definer
set search_path = batchport, pg_temp
as $$
  select s.user_id
  from batchport.user_settings s
  where s.public_slug = p_slug
    and (s.public_share_enabled or s.is_demo)
$$;

-- Null unless exactly one demo row exists, so a second is_demo row can never
-- take over /demo. The app falls back to its DEMO_USER_ID constant.
create or replace function batchport.demo_user_id()
returns uuid
language sql stable security definer
set search_path = batchport, pg_temp
as $$
  select case when count(*) = 1 then (array_agg(s.user_id))[1] end
  from batchport.user_settings s
  where s.is_demo
$$;

revoke execute on function batchport.resolve_share_slug(text) from public;
revoke execute on function batchport.demo_user_id() from public;
grant execute on function batchport.resolve_share_slug(text) to anon, authenticated;
grant execute on function batchport.demo_user_id() to anon, authenticated;

comment on function batchport.resolve_share_slug(text) is
  'User id for a shared or demo profile slug, else null. Replaces reading user_settings from the share page.';
comment on function batchport.demo_user_id() is
  'User id of the single demo account, else null.';

-- 4. Audit L3: browsers cannot write user_settings ------------------------------
-- Every write goes through a server action using the admin client.

revoke insert, update, delete on table batchport.user_settings from authenticated;

commit;

notify pgrst, 'reload schema';

-- Rollback for PORT-4 part A. Only valid while part B is NOT applied and before
-- the app code that calls resolve_share_slug() and demo_user_id() is deployed.
-- If part B is applied, run 2026-11-14-port-4b-rollback.sql first; the drops
-- below fail (no cascade) while any policy still uses a helper.

begin;

grant insert, update, delete on table batchport.user_settings to authenticated;

drop function if exists batchport.resolve_share_slug(text);
drop function if exists batchport.demo_user_id();

drop function if exists batchport_private.place_is_public(uuid);
drop function if exists batchport_private.journal_is_public(uuid, uuid);
drop function if exists batchport_private.photo_is_public(text, uuid);
drop function if exists batchport_private.destination_is_public(uuid);
drop function if exists batchport_private.trip_is_public(uuid);
drop function if exists batchport_private.share_scope(uuid);
drop schema if exists batchport_private;

alter table batchport.user_settings
  drop constraint if exists user_settings_share_trip_scope_check,
  drop column if exists share_trip_scope,
  drop column if exists share_journal;

commit;

notify pgrst, 'reload schema';

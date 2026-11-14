-- Rollback for PORT-4 part B: restores the policies exactly as they were on
-- Nov 14 2026 (from the live catalog), except user_settings stays at the Nov 14
-- stopgap for anon (four columns readable, not the whole row).

begin;

alter policy trips_shared_read on batchport.trips using (batchport.is_shared(user_id));
alter policy destinations_shared_read on batchport.destinations using (batchport.is_shared(user_id));
alter policy experiences_shared_read on batchport.experiences using (batchport.is_shared(user_id));
alter policy photos_shared_read on batchport.photos using (batchport.is_shared(user_id));
alter policy transport_legs_select on batchport.transport_legs
  using ((auth.uid() = user_id) or batchport.is_shared(user_id));
alter policy journal_entries_select on batchport.journal_entries
  using ((auth.uid() = user_id) or batchport.is_shared(user_id));
alter policy places_select_shared on batchport.places using (batchport.is_shared(user_id));
alter policy place_visits_select_shared on batchport.place_visits using (batchport.is_shared(user_id));
alter policy lists_shared_read on batchport.lists using (batchport.is_shared(user_id));
alter policy list_items_shared_read on batchport.list_items using (batchport.is_shared(user_id));

drop policy if exists user_settings_public on batchport.user_settings;
create policy user_settings_public on batchport.user_settings
  for select to anon, authenticated
  using (public_share_enabled or is_demo);
grant select (user_id, public_slug, public_share_enabled, is_demo)
  on table batchport.user_settings to anon;

commit;

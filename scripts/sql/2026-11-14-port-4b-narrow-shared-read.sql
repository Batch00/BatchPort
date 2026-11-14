-- PORT-4 part B: narrow what a shared profile exposes through the API.
--
-- Run only after part A is applied AND the app code that resolves slugs through
-- resolve_share_slug() and demo_user_id() is live. Dropping user_settings_public
-- before that would break every share page.
--
-- Changes only the USING clause of each policy; roles and commands stay as they
-- are. bucket_list_shared_read and expenses_select are unchanged.
-- Rollback: 2026-11-14-port-4b-rollback.sql. See audit-port-4-design.md.

begin;

alter policy trips_shared_read on batchport.trips
  using (batchport_private.trip_is_public(id));

alter policy destinations_shared_read on batchport.destinations
  using (batchport_private.trip_is_public(trip_id));

alter policy experiences_shared_read on batchport.experiences
  using (batchport_private.destination_is_public(destination_id));

alter policy photos_shared_read on batchport.photos
  using (batchport_private.photo_is_public(owner_type, owner_id));

alter policy transport_legs_select on batchport.transport_legs
  using ((auth.uid() = user_id) or batchport_private.trip_is_public(trip_id));

alter policy journal_entries_select on batchport.journal_entries
  using ((auth.uid() = user_id) or batchport_private.journal_is_public(user_id, trip_id));

alter policy places_select_shared on batchport.places
  using (batchport_private.place_is_public(id));

alter policy place_visits_select_shared on batchport.place_visits
  using (batchport.is_demo_account(user_id)
         or (batchport.is_shared(user_id) and visit_date <= current_date));

-- No lists UI exists yet; only the demo shares lists.
alter policy lists_shared_read on batchport.lists
  using (batchport.is_demo_account(user_id));

alter policy list_items_shared_read on batchport.list_items
  using (batchport.is_demo_account(user_id));

-- Nobody but the owner reads a settings row. The app resolves slugs and the demo
-- id through definer functions; is_shared() and is_demo_account() are definer.
drop policy if exists user_settings_public on batchport.user_settings;
revoke select (user_id, public_slug, public_share_enabled, is_demo)
  on table batchport.user_settings from anon;

commit;

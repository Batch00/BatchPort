-- Widen the geocode_cache provider check constraint.
--
-- The original constraint only allows 'photon' and 'nominatim'. Every other
-- cache write (photon_poi, wikimedia, and the discover_* providers added by
-- the Discovery panel) violates it and fails silently, so those lookups hit
-- their upstream APIs on every request instead of caching.
--
-- Run this in the Supabase dashboard SQL editor (or psql). Safe to re-run.

alter table batchport.geocode_cache
  drop constraint if exists geocode_cache_provider_check;

alter table batchport.geocode_cache
  add constraint geocode_cache_provider_check
  check (provider in (
    'photon',
    'photon_poi',
    'nominatim',
    'wikimedia',
    'discover_country',
    'discover_cities',
    'discover_city'
  ));

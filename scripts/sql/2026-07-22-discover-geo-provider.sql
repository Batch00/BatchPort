-- Attractions explore layer: allow the discover_geo cache provider.
--
-- Supersedes 2026-07-20-planner-completion.sql's provider constraint (this
-- widens the same constraint, now also allowing 'discover_geo', used by the
-- globe's "Show attractions" viewport Wikipedia geosearch).
--
-- Run this in the Supabase dashboard SQL editor (or psql). Safe to re-run.
--
-- Until it runs, the app degrades gracefully: attraction lookups fetch, fail
-- to cache (a logged warning), and every viewport settle re-hits Wikipedia
-- instead of serving from geocode_cache.

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
    'discover_city',
    'discover_poi',
    'discover_climate',
    'discover_geo'
  ));

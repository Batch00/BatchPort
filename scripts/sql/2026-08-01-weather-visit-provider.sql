-- Historical weather at time of visit: allow the weather_visit cache provider.
--
-- Supersedes 2026-07-22-discover-geo-provider.sql's provider constraint (this
-- widens the same constraint, now also allowing 'weather_visit', used by the
-- observed daily high/low/precipitation lookup on dated destinations).
--
-- Run this in the Supabase dashboard SQL editor (or psql). Safe to re-run.
--
-- Until it runs, the app degrades gracefully: the "While you were here" line
-- still renders, but every request re-hits the Open-Meteo ERA5 archive because
-- the cache insert is rejected.

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
    'discover_geo',
    'weather_visit'
  ));

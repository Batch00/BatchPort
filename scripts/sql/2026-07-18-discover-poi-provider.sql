-- Add the discover_poi provider to the geocode_cache check constraint.
--
-- The Discovery panel's POI detail view caches its aggregated payloads under
-- provider 'discover_poi'. Until this runs, those cache writes fail (logged as
-- a warning) and every POI open hits Wikipedia directly.
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
    'discover_city',
    'discover_poi'
  ));

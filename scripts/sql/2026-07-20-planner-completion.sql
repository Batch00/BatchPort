-- Planner completion: climate cache provider + planned_day column.
--
-- Two independent changes bundled for one editor visit. Supersedes
-- 2026-07-18-discover-poi-provider.sql (this widens the same provider
-- constraint, now also allowing 'discover_climate').
--
-- Run this in the Supabase dashboard SQL editor (or psql). Safe to re-run.
--
-- Until it runs, the app degrades gracefully:
--   * Climate lines fetch, fail to cache (a logged warning), and every request
--     re-hits Open-Meteo instead of serving from geocode_cache.
--   * Day assignment writes fail; the planner surfaces "Could not assign the
--     day" and reads treat a missing planned_day as unassigned, so the plan
--     block still renders as a flat (or fully-unassigned) list.

-- 1. Allow the discover_climate provider (plus every provider already in use).
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
    'discover_climate'
  ));

-- 2. Day-planning slot for planned experiences. Day 1 = the destination's
-- arrival date; null = unassigned (the default, and how every existing row
-- reads).
alter table batchport.experiences
  add column if not exists planned_day integer;

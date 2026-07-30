-- Home location labels.
--
-- user_settings.home_geom already exists (geography(Point,4326)) but nothing
-- ever wrote to it, and a bare point cannot be shown back to the user. These
-- two columns store the label the location typeahead resolved so Settings can
-- render "Denver, United States" instead of a coordinate pair.
--
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- Until this runs the app degrades: saving a home location retries without the
-- label columns (the point is still stored, so every distance-from-home
-- feature works), and the label falls back to the coordinates.

alter table batchport.user_settings
  add column if not exists home_geom geography(Point, 4326);

alter table batchport.user_settings
  add column if not exists home_name text;

alter table batchport.user_settings
  add column if not exists home_country_code text;

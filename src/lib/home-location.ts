import { cache } from "react";

import { createAdminClient } from "@/utils/supabase/admin";
import { haversineKm, parseEwkbPoint } from "@/lib/geo";

// Read side of the user's home location. Like share settings, this is an
// owner-only read already gated by requireUser at the call site, and the admin
// client sidesteps RLS edge cases around a user_settings row that may not exist
// yet. The admin client is not schema-scoped, so name batchport explicitly.
//
// Everything downstream of a home location is optional by design: when this
// returns null, the distance lines, the furthest-from-home tile, and the
// timezone chip simply do not render. Nothing anywhere prompts for a home.

export interface HomeLocation {
  /** The label the typeahead resolved, or null before the label columns exist. */
  name: string | null;
  country_code: string | null;
  lat: number;
  lng: number;
}

// Wrapped in React cache() so several server components on one page (a trip
// banner, a stats tile) share a single round-trip.
export const getHomeLocation = cache(
  async (userId: string): Promise<HomeLocation | null> => {
    const admin = createAdminClient();
    // select * so the read keeps working whether or not the label columns from
    // 2026-07-29-home-location.sql have been added; missing columns read as
    // undefined rather than erroring the whole query.
    const { data } = await admin
      .schema("batchport")
      .from("user_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return null;

    const row = data as {
      home_geom?: string | null;
      home_name?: string | null;
      home_country_code?: string | null;
    };
    const point = row.home_geom ? parseEwkbPoint(row.home_geom) : null;
    if (!point) return null;

    return {
      name: row.home_name ?? null,
      country_code: row.home_country_code ?? null,
      lat: point.lat,
      lng: point.lng,
    };
  },
);

/** What Settings shows back to the user, falling back to coordinates when the
 * label columns have not been added yet. */
export function homeLabel(home: HomeLocation): string {
  if (home.name) {
    return home.country_code ? `${home.name}, ${home.country_code}` : home.name;
  }
  return `${home.lat.toFixed(2)}, ${home.lng.toFixed(2)}`;
}

/** Distance from home to a point, or null when either side is unknown. */
export function distanceFromHome(
  home: HomeLocation | null,
  lat: number | null,
  lng: number | null,
): number | null {
  if (!home || lat === null || lng === null) return null;
  return haversineKm(home.lat, home.lng, lat, lng);
}

/** The furthest of a set of points from home. Null when nothing is locatable. */
export function furthestFrom<T extends { lat: number | null; lng: number | null }>(
  home: HomeLocation | null,
  points: T[],
): { point: T; distanceKm: number } | null {
  if (!home) return null;
  let best: { point: T; distanceKm: number } | null = null;
  for (const point of points) {
    const distanceKm = distanceFromHome(home, point.lat, point.lng);
    if (distanceKm === null) continue;
    if (!best || distanceKm > best.distanceKm) best = { point, distanceKm };
  }
  return best;
}

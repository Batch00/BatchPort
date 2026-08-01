import { unstable_cache } from "next/cache";

import { getMapData } from "@/lib/map-data";
import { getDemoUserId } from "@/lib/share-data";
import { createPublicClient } from "@/utils/supabase/public";
import type { GlobeArc, GlobeDestination } from "@/components/map/globe-types";

// The landing hero's globe data: the public demo account's real travel history,
// so the first thing a visitor sees is the same world /demo shows rather than a
// hardcoded mock.
//
// Two constraints shape this module:
//
// 1. Anon read path only. The demo account is readable through the is_shared()
//    RLS helper, so the sessionless anon client is enough and no session or
//    service-role key is ever involved.
// 2. Cacheable. The root layout exports force-dynamic (it prevents a Next 16
//    Turbopack prerender crash on the internal _not-found and _global-error
//    routes), and a page cannot loosen a parent's force-dynamic, so the route
//    itself cannot be ISR. Caching the data instead gets the same result where
//    it matters: the hot path renders a tiny component tree from the Next data
//    cache and never touches Supabase. That is why the read goes through the
//    cookie-free client: cookies() is not allowed inside a cache scope.

/** How long the hero's copy of the demo world is reused before it is refetched.
 * The demo dataset changes only when it is reseeded, so an hour is generous. */
const LANDING_REVALIDATE_SECONDS = 3600;

/** Cache tag, so a reseed can purge the hero on demand with revalidateTag. */
export const LANDING_GLOBE_TAG = "landing-globe";

export interface LandingGlobeData {
  visitedCountryCodes: string[];
  destinations: GlobeDestination[];
  arcs: GlobeArc[];
}

// The hero shows where the demo traveller has actually been: visited country
// fills, destination pins, and the arcs between them. Planned trips are left
// out on purpose. Their hollow pins and dashed arcs are meaningful next to the
// legend and trip list on /demo, but at hero scale, behind a gradient and with
// nothing to explain them, they read as rendering artefacts.
async function fetchLandingGlobeData(): Promise<LandingGlobeData | null> {
  const supabase = createPublicClient();
  if (!supabase) return null;

  try {
    const userId = await getDemoUserId(supabase);
    const mapData = await getMapData(userId, supabase);

    const destinations: GlobeDestination[] = mapData.destinations
      .filter((destination) => !destination.planned)
      .map((destination) => ({
        id: destination.id,
        tripId: destination.tripId,
        tripName: destination.tripName,
        name: destination.name,
        countryCode: destination.countryCode,
        lat: destination.lat,
        lng: destination.lng,
        arrivalDate: null,
        departureDate: null,
        categoryColor: destination.category?.color ?? null,
      }));

    // An empty result is a failure for hero purposes (an unseeded demo account
    // on a fresh deploy), so it degrades to the static fallback rather than
    // rendering a bare globe.
    if (destinations.length === 0) return null;

    const arcs: GlobeArc[] = mapData.arcs
      .filter((arc) => !arc.planned)
      .map((arc) => ({
        sourcePosition: arc.sourcePosition,
        targetPosition: arc.targetPosition,
        tripName: arc.tripName,
        sourceCity: arc.sourceCity,
        targetCity: arc.targetCity,
        mode: arc.mode,
      }));

    return {
      visitedCountryCodes: mapData.visitedCountryCodes,
      destinations,
      arcs,
    };
  } catch (error) {
    // Never let the hero fail the page: the caller falls back to the bundled
    // snapshot of the same world.
    console.warn("Landing globe data unavailable, using the fallback:", error);
    return null;
  }
}

/**
 * The demo world for the landing hero, or null when it cannot be read. Null is
 * cached too, so a broken or unseeded demo account costs one failed query per
 * revalidation window rather than one per visitor.
 */
export const getLandingGlobeData = unstable_cache(
  fetchLandingGlobeData,
  [LANDING_GLOBE_TAG],
  { revalidate: LANDING_REVALIDATE_SECONDS, tags: [LANDING_GLOBE_TAG] },
);

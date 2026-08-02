import { createClient } from "@/utils/supabase/server";
import { parseEwkbPoint, placeKey } from "@/lib/geo";
import { legModesByDestination } from "@/lib/transport-data";
import { chronologicalDestinations, derivedTripWindow } from "@/lib/trip-dates";
import type { TransportMode } from "@/lib/transport";

// Server-side data layer for the globe. getMapData fetches everything the map
// needs in a minimal set of parallel queries and pre-computes the arcs so the
// client component stays pure rendering. RLS (and the is_shared() helper for
// public/demo views) scopes every query, so passing a userId is safe.

/** The category a destination pin is tinted by, from its primary experience. */
export interface MapCategory {
  slug: string;
  label: string;
  color: string | null;
}

/** A single mappable stop: a destination with the bits the globe renders. */
export interface MapDestination {
  id: string;
  tripId: string;
  tripName: string;
  tripStartDate: string | null;
  tripEndDate: string | null;
  /** True when the owning trip is still in the planned state. */
  planned: boolean;
  name: string;
  countryCode: string | null;
  lat: number;
  lng: number;
  orderIndex: number;
  arrivalDate: string | null;
  departureDate: string | null;
  category: MapCategory | null;
  /** The leg recorded on this stop: how the traveller got here. Null when
   * nothing was recorded. Feeds the replay's per-family arc styling, the same
   * way MapArc.mode feeds the static arcs. */
  transportMode: TransportMode | null;
}

/** A great-circle leg between two consecutive stops on a trip. */
export interface MapArc {
  /** [lng, lat], GeoJSON coordinate order. */
  sourcePosition: [number, number];
  targetPosition: [number, number];
  tripName: string;
  sourceCity: string;
  targetCity: string;
  /** True when the trip is planned; rendered dashed. */
  planned: boolean;
  /** How this hop was travelled, from the leg recorded on the arriving stop.
   * Null when nothing was recorded, which draws the original arc styling. */
  mode: TransportMode | null;
}

/** An unfulfilled place-type bucket list item, rendered as an amber pin. */
export interface MapBucketPlace {
  id: string;
  name: string;
  countryCode: string | null;
  /** Null when the item was saved without coordinates (no pin, list only). */
  lat: number | null;
  lng: number | null;
}

export interface MapStats {
  countries: number;
  trips: number;
  destinations: number;
}

export interface MapData {
  destinations: MapDestination[];
  /** Countries with at least one non-planned destination (blue fill). */
  visitedCountryCodes: string[];
  /** Countries visited only by planned trips (outline-only treatment). */
  plannedCountryCodes: string[];
  /**
   * Countries on the user's unfulfilled bucket list. Unfiltered: the globe
   * subtracts visited codes for the amber fill, while the discovery panel
   * needs the complete list for its "on your bucket list" state.
   */
  bucketCountryCodes: string[];
  /** Unfulfilled place-type bucket items (amber pins when they have coords). */
  bucketPlaces: MapBucketPlace[];
  arcs: MapArc[];
  stats: MapStats;
}

// Shape of a destination row with its embedded trip and experiences. PostgREST
// returns the to-one trip as an object and the to-many experiences as an array.
interface DestinationRow {
  id: string;
  trip_id: string;
  name: string;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  order_index: number;
  arrival_date: string | null;
  departure_date: string | null;
  trips: {
    name: string;
    start_date: string | null;
    end_date: string | null;
    status: string;
  } | null;
  experiences: {
    rating: number | null;
    categories: { slug: string; label: string; color: string | null } | null;
  }[];
}

const DESTINATION_SELECT = `
  id, trip_id, name, country_code, latitude, longitude, order_index,
  arrival_date, departure_date,
  trips ( name, start_date, end_date, status ),
  experiences ( rating, categories ( slug, label, color ) )
`;

function emptyMapData(): MapData {
  return {
    destinations: [],
    visitedCountryCodes: [],
    plannedCountryCodes: [],
    bucketCountryCodes: [],
    bucketPlaces: [],
    arcs: [],
    stats: { countries: 0, trips: 0, destinations: 0 },
  };
}

// The pin category: the category of the highest-rated experience that has one,
// mirroring the landing page's mock behaviour so colours stay consistent.
function primaryCategory(
  experiences: DestinationRow["experiences"],
): MapCategory | null {
  const withCategory = experiences.filter((e) => e.categories);
  if (withCategory.length === 0) return null;
  withCategory.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const category = withCategory[0].categories!;
  return { slug: category.slug, label: category.label, color: category.color };
}

// Trip start_date first (nulls last), then order within the trip.
function byTripThenOrder(a: MapDestination, b: MapDestination): number {
  const aStart = a.tripStartDate ?? "";
  const bStart = b.tripStartDate ?? "";
  if (aStart !== bStart) {
    if (!aStart) return 1;
    if (!bStart) return -1;
    return aStart < bStart ? -1 : 1;
  }
  return a.orderIndex - b.orderIndex;
}

/** The Supabase client getMapData reads through. Defaults to the cookie-backed
 * server client; callers in a cache scope pass the sessionless anon client
 * instead, since cookies() cannot be read there. */
export type MapDataClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Fetch everything the globe needs for a user. Without a userId, the
 * authenticated user is used; with one, that user's data is queried directly
 * (demo/public share), relying on RLS for access control.
 *
 * An explicit client can be supplied to read outside a request context (the
 * landing hero caches the demo user's globe through the sessionless anon
 * client). Passing one without a userId is meaningless: a sessionless client
 * has no authenticated user to fall back to.
 */
export async function getMapData(
  userId?: string,
  client?: MapDataClient,
): Promise<MapData> {
  const supabase = client ?? (await createClient());

  let resolvedUserId = userId ?? null;
  if (!resolvedUserId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    resolvedUserId = user?.id ?? null;
  }
  if (!resolvedUserId) return emptyMapData();

  // Parallel queries: the destination payload (which also yields the visited
  // countries, arcs, and most counts), an exact trip count so the overlay
  // reflects every trip, and one query for all unfulfilled bucket items
  // (countries and places split in memory rather than in two round trips).
  // The fourth query is the transport legs, which style the arcs by how each
  // hop was travelled. It degrades to an empty map, so a database without the
  // table renders exactly the arcs it always did.
  const [destResult, tripCountResult, bucketResult, legModes] = await Promise.all([
    supabase
      .from("destinations")
      .select(DESTINATION_SELECT)
      .eq("user_id", resolvedUserId)
      .order("order_index", { ascending: true }),
    supabase
      .from("trips")
      .select("id", { count: "exact", head: true })
      .eq("user_id", resolvedUserId),
    supabase
      .from("bucket_list")
      .select("id, type, place_name, country_code, geom")
      .eq("user_id", resolvedUserId)
      .is("fulfilled_at", null),
    legModesByDestination(supabase, resolvedUserId),
  ]);

  if (destResult.error) throw destResult.error;
  if (tripCountResult.error) throw tripCountResult.error;
  if (bucketResult.error) throw bucketResult.error;

  const bucketRows = (bucketResult.data ?? []) as {
    id: string;
    type: string;
    place_name: string | null;
    country_code: string | null;
    geom: string | null;
  }[];

  const rows = (destResult.data ?? []) as unknown as DestinationRow[];

  // Stops go in visit order within each trip, and orderIndex is re-issued as
  // the position in that order rather than copied from the stored column. Every
  // consumer of this payload (the arcs below, the replay timeline, the photo
  // fallbacks) sorts by orderIndex alone, so this is the single place the
  // chronological rule has to be applied for all of them. The stored column is
  // renumbered to match on write (lib/trip-schedule.ts); doing it here as well
  // means rows written before that existed are still ordered correctly.
  //
  // The trip's own range is derived from the same stops, so the replay's
  // per-trip timing and the pin popups agree with the trip page.
  const rowsByTrip = new Map<string, DestinationRow[]>();
  for (const row of rows) {
    const list = rowsByTrip.get(row.trip_id) ?? [];
    list.push(row);
    rowsByTrip.set(row.trip_id, list);
  }

  const destinations: MapDestination[] = [];
  for (const list of rowsByTrip.values()) {
    const window = derivedTripWindow(list);
    chronologicalDestinations(list).forEach((row, index) => {
      if (row.latitude === null || row.longitude === null) return;
      destinations.push({
        id: row.id,
        tripId: row.trip_id,
        tripName: row.trips?.name ?? "Trip",
        tripStartDate: window?.start ?? row.trips?.start_date ?? null,
        tripEndDate: window?.end ?? row.trips?.end_date ?? null,
        planned: row.trips?.status === "planned",
        name: row.name,
        countryCode: row.country_code,
        lat: row.latitude as number,
        lng: row.longitude as number,
        orderIndex: index,
        arrivalDate: row.arrival_date,
        departureDate: row.departure_date,
        category: primaryCategory(row.experiences),
        transportMode: legModes.get(row.id) ?? null,
      });
    });
  }
  destinations.sort(byTripThenOrder);

  // Visited means actually been there: ongoing and completed trips count,
  // planned ones do not. Countries reached only by planned trips get the
  // separate outline-only treatment.
  const visitedCountryCodes = Array.from(
    new Set(
      rows
        .filter((row) => row.trips?.status !== "planned")
        .map((row) => row.country_code)
        .filter((code): code is string => Boolean(code)),
    ),
  );
  const visitedSet = new Set(visitedCountryCodes);
  const plannedCountryCodes = Array.from(
    new Set(
      rows
        .filter((row) => row.trips?.status === "planned")
        .map((row) => row.country_code)
        .filter(
          (code): code is string => Boolean(code) && !visitedSet.has(code as string),
        ),
    ),
  );

  // Arcs: consecutive stops within each trip, in visit order.
  const byTrip = new Map<string, MapDestination[]>();
  for (const destination of destinations) {
    const list = byTrip.get(destination.tripId) ?? [];
    list.push(destination);
    byTrip.set(destination.tripId, list);
  }
  const arcs: MapArc[] = [];
  for (const list of byTrip.values()) {
    const ordered = [...list].sort((a, b) => a.orderIndex - b.orderIndex);
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const source = ordered[i];
      const target = ordered[i + 1];
      arcs.push({
        sourcePosition: [source.lng, source.lat],
        targetPosition: [target.lng, target.lat],
        tripName: source.tripName,
        sourceCity: source.name,
        targetCity: target.name,
        planned: source.planned,
        // A leg belongs to the stop it arrives at, so the hop's mode is the
        // mode recorded on its target.
        mode: legModes.get(target.id) ?? null,
      });
    }
  }

  const bucketCountryCodes = Array.from(
    new Set(
      bucketRows
        .filter((row) => row.type === "country")
        .map((row) => row.country_code)
        .filter((code): code is string => code !== null),
    ),
  );

  // Place items keep a stable identity even without coordinates (the panel
  // needs them for duplicate detection); only coordinate-bearing ones pin.
  // Deduplicate by name + country so double-saved rows render one pin.
  const seenPlaces = new Set<string>();
  const bucketPlaces: MapBucketPlace[] = [];
  for (const row of bucketRows) {
    if (row.type !== "place" || !row.place_name) continue;
    const key = placeKey(row.place_name, row.country_code);
    if (seenPlaces.has(key)) continue;
    seenPlaces.add(key);
    const point = row.geom ? parseEwkbPoint(row.geom) : null;
    bucketPlaces.push({
      id: row.id,
      name: row.place_name,
      countryCode: row.country_code,
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
    });
  }

  const stats: MapStats = {
    countries: visitedCountryCodes.length,
    trips: tripCountResult.count ?? 0,
    destinations: rows.length,
  };

  return {
    destinations,
    visitedCountryCodes,
    plannedCountryCodes,
    bucketCountryCodes,
    bucketPlaces,
    arcs,
    stats,
  };
}

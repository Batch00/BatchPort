import { createClient } from "@/utils/supabase/server";
import { parseEwkbPoint, placeKey } from "@/lib/geo";

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
  trips: { name: string; start_date: string | null; status: string } | null;
  experiences: {
    rating: number | null;
    categories: { slug: string; label: string; color: string | null } | null;
  }[];
}

const DESTINATION_SELECT = `
  id, trip_id, name, country_code, latitude, longitude, order_index,
  arrival_date, departure_date,
  trips ( name, start_date, status ),
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

/**
 * Fetch everything the globe needs for a user. Without a userId, the
 * authenticated user is used; with one, that user's data is queried directly
 * (demo/public share), relying on RLS for access control.
 */
export async function getMapData(userId?: string): Promise<MapData> {
  const supabase = await createClient();

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
  // reflects every trip, and the unfulfilled bucket items (countries + places).
  const [destResult, tripCountResult, bucketResult, bucketPlaceResult] =
    await Promise.all([
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
        .select("country_code")
        .eq("user_id", resolvedUserId)
        .eq("type", "country")
        .is("fulfilled_at", null),
      supabase
        .from("bucket_list")
        .select("id, place_name, country_code, geom")
        .eq("user_id", resolvedUserId)
        .eq("type", "place")
        .is("fulfilled_at", null),
    ]);

  if (destResult.error) throw destResult.error;
  if (tripCountResult.error) throw tripCountResult.error;
  if (bucketResult.error) throw bucketResult.error;
  if (bucketPlaceResult.error) throw bucketPlaceResult.error;

  const rows = (destResult.data ?? []) as unknown as DestinationRow[];

  const destinations: MapDestination[] = rows
    .filter((row) => row.latitude !== null && row.longitude !== null)
    .map((row) => ({
      id: row.id,
      tripId: row.trip_id,
      tripName: row.trips?.name ?? "Trip",
      tripStartDate: row.trips?.start_date ?? null,
      planned: row.trips?.status === "planned",
      name: row.name,
      countryCode: row.country_code,
      lat: row.latitude as number,
      lng: row.longitude as number,
      orderIndex: row.order_index,
      arrivalDate: row.arrival_date,
      departureDate: row.departure_date,
      category: primaryCategory(row.experiences),
    }))
    .sort(byTripThenOrder);

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
      });
    }
  }

  const bucketCountryCodes = Array.from(
    new Set(
      ((bucketResult.data ?? []) as { country_code: string | null }[])
        .map((row) => row.country_code)
        .filter((code): code is string => code !== null),
    ),
  );

  // Place items keep a stable identity even without coordinates (the panel
  // needs them for duplicate detection); only coordinate-bearing ones pin.
  // Deduplicate by name + country so double-saved rows render one pin.
  const seenPlaces = new Set<string>();
  const bucketPlaces: MapBucketPlace[] = [];
  for (const row of (bucketPlaceResult.data ?? []) as {
    id: string;
    place_name: string | null;
    country_code: string | null;
    geom: string | null;
  }[]) {
    if (!row.place_name) continue;
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

import { createAdminClient } from "@/utils/supabase/admin";
import type { GeoLocation, PoiResult } from "@/lib/types";

// Geocoding helpers shared by the geocode API routes. The geocode_cache table is
// service-role only (no user RLS policies), so every read and write here uses
// the admin client and must name the schema explicitly: the admin client is not
// scoped to "batchport" by default.

export type GeocodeProvider = "photon" | "photon_poi" | "nominatim";

// Cached entries older than this are treated as a miss and refetched.
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

// Keep the first item per key, dropping later duplicates. Preserves order.
function dedupeByKey<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

interface CacheRow {
  result: unknown;
  cached_at: string;
}

// Return the freshest cached payload for a key, or null when missing or stale.
export async function readCache(
  provider: GeocodeProvider,
  queryNorm: string,
): Promise<unknown | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema("batchport")
    .from("geocode_cache")
    .select("result, cached_at")
    .eq("provider", provider)
    .eq("query_norm", queryNorm)
    .order("cached_at", { ascending: false })
    .limit(1)
    .maybeSingle<CacheRow>();

  if (error || !data) return null;
  const age = Date.now() - new Date(data.cached_at).getTime();
  if (age > CACHE_TTL_MS) return null;
  return data.result;
}

// Replace any existing rows for a key with one fresh row. Delete-then-insert
// keeps a single row per key whether or not a unique constraint exists.
export async function writeCache(
  provider: GeocodeProvider,
  queryNorm: string,
  result: unknown,
  extra?: { lat?: number; lng?: number; country_code?: string | null },
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .schema("batchport")
    .from("geocode_cache")
    .delete()
    .eq("provider", provider)
    .eq("query_norm", queryNorm);

  await admin
    .schema("batchport")
    .from("geocode_cache")
    .insert({
      provider,
      query_norm: queryNorm,
      result,
      latitude: extra?.lat ?? null,
      longitude: extra?.lng ?? null,
      country_code: extra?.country_code ?? null,
      cached_at: new Date().toISOString(),
    });
}

// --- Provider response shapes (only the fields we read) ---

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    country?: string;
    countrycode?: string;
    state?: string;
    county?: string;
    city?: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
    osm_key?: string;
    osm_value?: string;
    type?: string;
  };
}

interface PhotonResponse {
  features?: PhotonFeature[];
}

export function parsePhoton(raw: unknown): GeoLocation[] {
  const response = raw as PhotonResponse;
  const features = response.features ?? [];
  const results: GeoLocation[] = [];
  for (const feature of features) {
    const coords = feature.geometry?.coordinates;
    const props = feature.properties ?? {};
    if (!coords || coords.length < 2) continue;
    const name = props.name ?? props.city;
    if (!name) continue;
    results.push({
      name,
      country: props.country ?? null,
      country_code: props.countrycode ? props.countrycode.toUpperCase() : null,
      admin_region: props.state ?? props.county ?? null,
      lng: coords[0],
      lat: coords[1],
      kind:
        props.type === "country" || props.osm_value === "country"
          ? "country"
          : "place",
    });
  }
  // Photon often returns several rows for the same city (different admin levels).
  // Keep one per (normalized name + country code) so "London" shows once.
  return dedupeByKey(
    results,
    (result) => `${normalizeQuery(result.name)}|${result.country_code ?? ""}`,
  );
}

// --- POI search ---

// Map an OSM key/value pair to one of the app's category slugs. Best effort:
// nightlife is checked before restaurant so a bar reads as nightlife.
function osmToCategorySlug(osmKey: string, osmValue: string): string {
  if (osmKey === "tourism") {
    if (osmValue === "museum" || osmValue === "gallery") return "museum";
    if (osmValue === "attraction" || osmValue === "viewpoint") {
      return "attraction";
    }
    if (
      osmValue === "hotel" ||
      osmValue === "hostel" ||
      osmValue === "guest_house" ||
      osmValue === "motel"
    ) {
      return "lodging";
    }
  }
  if (osmKey === "historic") return "attraction";
  // Many landmarks (towers, monuments, bridges) carry man_made as their primary
  // tag, so treat them as attractions. The Eiffel Tower is man_made=tower.
  if (osmKey === "man_made") return "attraction";
  if (osmKey === "amenity") {
    if (osmValue === "pub" || osmValue === "nightclub" || osmValue === "bar") {
      return "nightlife";
    }
    if (
      osmValue === "restaurant" ||
      osmValue === "cafe" ||
      osmValue === "fast_food" ||
      osmValue === "food_court" ||
      osmValue === "marketplace"
    ) {
      return "restaurant";
    }
  }
  if (osmKey === "leisure") {
    if (osmValue === "beach_resort") return "beach";
    if (
      osmValue === "park" ||
      osmValue === "nature_reserve" ||
      osmValue === "garden"
    ) {
      return "nature";
    }
  }
  if (osmKey === "natural") {
    if (osmValue === "beach") return "beach";
    return "nature";
  }
  return "other";
}

const SLUG_LABEL: Record<string, string> = {
  museum: "Museum",
  attraction: "Attraction",
  restaurant: "Restaurant",
  nightlife: "Nightlife",
  beach: "Beach",
  nature: "Nature",
  lodging: "Lodging",
};

function titleize(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function poiAddress(props: NonNullable<PhotonFeature["properties"]>): string | null {
  const streetPart = props.street
    ? props.housenumber
      ? `${props.housenumber} ${props.street}`
      : props.street
    : null;
  const parts = [streetPart, props.city ?? props.county, props.state].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

export function parsePhotonPoi(raw: unknown): PoiResult[] {
  const response = raw as PhotonResponse;
  const features = response.features ?? [];
  const results: PoiResult[] = [];
  for (const feature of features) {
    const coords = feature.geometry?.coordinates;
    const props = feature.properties ?? {};
    if (!coords || coords.length < 2 || !props.name) continue;
    const osmKey = props.osm_key ?? "";
    const osmValue = props.osm_value ?? "";
    const slug = osmToCategorySlug(osmKey, osmValue);
    const type =
      slug !== "other"
        ? SLUG_LABEL[slug]
        : osmValue
          ? titleize(osmValue)
          : "Place";
    results.push({
      name: props.name,
      type,
      category_slug: slug,
      lat: coords[1],
      lng: coords[0],
      country_code: props.countrycode ? props.countrycode.toUpperCase() : null,
      address: poiAddress(props),
    });
  }
  // One result per place name (normalized).
  return dedupeByKey(results, (result) => normalizeQuery(result.name));
}

interface NominatimResponse {
  name?: string;
  display_name?: string;
  address?: {
    country?: string;
    country_code?: string;
    state?: string;
    city?: string;
    town?: string;
    village?: string;
    county?: string;
  };
}

export function parseNominatim(
  raw: unknown,
  lat: number,
  lng: number,
): GeoLocation {
  const response = raw as NominatimResponse;
  const address = response.address ?? {};
  const name =
    address.city ??
    address.town ??
    address.village ??
    address.county ??
    response.name ??
    response.display_name?.split(",")[0] ??
    "Unknown location";
  return {
    name,
    country: address.country ?? null,
    country_code: address.country_code
      ? address.country_code.toUpperCase()
      : null,
    admin_region: address.state ?? address.county ?? null,
    lat,
    lng,
  };
}

import { createAdminClient } from "@/utils/supabase/admin";
import type { GeoLocation } from "@/lib/types";

// Geocoding helpers shared by the two API routes. The geocode_cache table is
// service-role only (no user RLS policies), so every read and write here uses
// the admin client and must name the schema explicitly: the admin client is not
// scoped to "batchport" by default.

export type GeocodeProvider = "photon" | "nominatim";

// Cached entries older than this are treated as a miss and refetched.
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
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
    });
  }
  return results;
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

import { createAdminClient } from "@/utils/supabase/admin";
import { getWikimediaPhoto } from "@/lib/wikimedia";
import { haversineKm } from "@/lib/geo";
import { normalizeQuery } from "@/lib/geocode";

// Server-side data layer for the Discovery panel. Aggregates the country
// reference row, a Wikipedia summary, a hero photo, and the top cities for a
// country, caching the assembled payloads in batchport.geocode_cache. Server
// only: cache reads and writes use the admin client, which bypasses RLS.

const COUNTRY_PROVIDER = "discover_country";
const CITIES_PROVIDER = "discover_cities";
const CITY_PROVIDER = "discover_city";
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ??
  "BatchPort/1.0 (+https://batchport.batch-apps.com)";

export interface DiscoverCountry {
  code: string;
  name: string;
  continent: string | null;
  region: string | null;
  summary: string | null;
  heroImageUrl: string | null;
  attribution: string | null;
}

export interface DiscoverCity {
  name: string;
  lat: number;
  lng: number;
  population: number | null;
  imageUrl: string | null;
  attribution: string | null;
}

interface CacheRow {
  result: unknown;
  cached_at: string;
}

async function readCache(
  provider: string,
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

async function writeCache(
  provider: string,
  queryNorm: string,
  result: unknown,
): Promise<void> {
  const admin = createAdminClient();
  // Keep a single row per key: clear any prior entry, then insert the fresh one.
  await admin
    .schema("batchport")
    .from("geocode_cache")
    .delete()
    .eq("provider", provider)
    .eq("query_norm", queryNorm);

  const { error } = await admin
    .schema("batchport")
    .from("geocode_cache")
    .insert({
      provider,
      query_norm: queryNorm,
      result,
      cached_at: new Date().toISOString(),
    });
  // Cache failures are non-fatal (the payload was already assembled), but
  // surface them: a silently failing cache means every request pays the full
  // upstream cost. See scripts/sql/2026-07-15-geocode-cache-providers.sql.
  if (error) {
    console.warn(`geocode_cache write failed for ${provider}:`, error.message);
  }
}

// --- Wikipedia REST summary ---

interface WikipediaSummary {
  extract: string | null;
  imageUrl: string | null;
  /** True when the page is a disambiguation page (useless as a summary). */
  disambiguation: boolean;
}

// The REST summary endpoint needs no API key. Redirects (e.g. alternative
// country names) are followed automatically by fetch.
async function fetchWikipediaSummary(
  title: string,
): Promise<WikipediaSummary> {
  const empty: WikipediaSummary = {
    extract: null,
    imageUrl: null,
    disambiguation: false,
  };
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
      title.replace(/ /g, "_"),
    )}`;
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return empty;
    const raw = (await response.json()) as {
      type?: string;
      extract?: string;
      originalimage?: { source?: string };
      thumbnail?: { source?: string };
    };
    return {
      extract: raw.extract?.trim() || null,
      imageUrl:
        raw.originalimage?.source ?? raw.thumbnail?.source ?? null,
      disambiguation: raw.type === "disambiguation",
    };
  } catch {
    return empty;
  }
}

// Country pages tend to lead with the flag or coat of arms; neither makes a
// good photographic hero, so those candidates are skipped in favor of the
// gradient placeholder.
function isEmblemImage(url: string): boolean {
  return /flag|coat[_ ]of[_ ]arms|emblem|seal[_ ]of/i.test(url);
}

// --- Country aggregate ---

export async function getDiscoverCountry(
  code: string,
): Promise<DiscoverCountry | null> {
  const queryNorm = code.toLowerCase();

  const cached = await readCache(COUNTRY_PROVIDER, queryNorm);
  if (cached) return cached as DiscoverCountry;

  const admin = createAdminClient();
  const { data: country, error } = await admin
    .schema("batchport")
    .from("countries")
    .select("code, name, continent, region")
    .eq("code", code)
    .maybeSingle<{
      code: string;
      name: string;
      continent: string | null;
      region: string | null;
    }>();
  if (error || !country) return null;

  // Wikipedia summary and the Wikidata P18 photo resolve independently.
  const [wiki, p18] = await Promise.all([
    fetchWikipediaSummary(country.name),
    getWikimediaPhoto(country.name),
  ]);

  // Prefer the P18 image (consistent with the existing photo pipeline and it
  // carries attribution); fall back to Wikipedia's page image. Emblem-style
  // images (flags, coats of arms) are skipped from both sources.
  let heroImageUrl: string | null = null;
  let attribution: string | null = null;
  if (p18.url && !isEmblemImage(p18.url)) {
    heroImageUrl = p18.url;
    attribution = p18.attribution
      ? p18.license
        ? `${p18.attribution} (${p18.license})`
        : p18.attribution
      : p18.license;
  } else if (wiki.imageUrl && !isEmblemImage(wiki.imageUrl)) {
    heroImageUrl = wiki.imageUrl;
    attribution = "Image via Wikipedia";
  }

  const result: DiscoverCountry = {
    code: country.code,
    name: country.name,
    continent: country.continent,
    region: country.region,
    summary: wiki.extract,
    heroImageUrl,
    attribution,
  };

  await writeCache(COUNTRY_PROVIDER, queryNorm, result);
  return result;
}

// --- Top cities ---

// batchport.cities stores the location as a PostGIS point; PostgREST returns
// it as hex-encoded EWKB. Decode the two doubles rather than round-tripping
// through the database.
function parseEwkbPoint(hex: string): { lat: number; lng: number } | null {
  if (typeof hex !== "string" || hex.length < 50) return null;
  try {
    const buffer = Buffer.from(hex, "hex");
    const littleEndian = buffer.readUInt8(0) === 1;
    const type = littleEndian
      ? buffer.readUInt32LE(1)
      : buffer.readUInt32BE(1);
    // Bit 0x20000000 flags an embedded SRID; the base type must be Point (1).
    const hasSrid = (type & 0x20000000) !== 0;
    if ((type & 0xff) !== 1) return null;
    const offset = hasSrid ? 9 : 5;
    const lng = littleEndian
      ? buffer.readDoubleLE(offset)
      : buffer.readDoubleBE(offset);
    const lat = littleEndian
      ? buffer.readDoubleLE(offset + 8)
      : buffer.readDoubleBE(offset + 8);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

const CITY_LIMIT = 8;
const LOOKUP_BATCH_SIZE = 4;

export async function getDiscoverCities(code: string): Promise<DiscoverCity[]> {
  const queryNorm = code.toLowerCase();

  const cached = await readCache(CITIES_PROVIDER, queryNorm);
  if (cached) return cached as DiscoverCity[];

  const admin = createAdminClient();
  const { data, error } = await admin
    .schema("batchport")
    .from("cities")
    .select("name, geom, population")
    .eq("country_code", code)
    .order("population", { ascending: false })
    .limit(CITY_LIMIT);
  if (error) return [];

  const rows = (data ?? []) as {
    name: string;
    geom: string | null;
    population: number | null;
  }[];

  const cities: DiscoverCity[] = [];
  for (const row of rows) {
    const point = row.geom ? parseEwkbPoint(row.geom) : null;
    if (!point) continue;
    cities.push({
      name: row.name,
      lat: point.lat,
      lng: point.lng,
      population: row.population,
      imageUrl: null,
      attribution: null,
    });
  }

  // Resolve photos in small parallel batches. Each city lookup is individually
  // cached under the existing wikimedia provider, so re-assembly stays cheap.
  for (let i = 0; i < cities.length; i += LOOKUP_BATCH_SIZE) {
    const batch = cities.slice(i, i + LOOKUP_BATCH_SIZE);
    const photos = await Promise.all(
      batch.map((city) => getWikimediaPhoto(city.name)),
    );
    for (let j = 0; j < batch.length; j += 1) {
      const photo = photos[j];
      if (photo.url && !isEmblemImage(photo.url)) {
        batch[j].imageUrl = photo.url;
        batch[j].attribution = photo.attribution
          ? photo.license
            ? `${photo.attribution} (${photo.license})`
            : photo.attribution
          : photo.license;
      }
    }
  }

  // Only cache non-empty lists: the cities table may be seeded later, and a
  // cached empty array would mask the new rows for 90 days.
  if (cities.length > 0) {
    await writeCache(CITIES_PROVIDER, queryNorm, cities);
  }
  return cities;
}

// --- City detail (summary plus highlights) ---

export type PoiCategory =
  | "museum"
  | "attraction"
  | "nature"
  | "beach"
  | "worship";

export interface DiscoverPoi {
  name: string;
  category: PoiCategory;
  lat: number;
  lng: number;
  imageUrl: string | null;
}

export interface DiscoverCityDetail {
  name: string;
  summary: string | null;
  heroImageUrl: string | null;
  attribution: string | null;
  pois: DiscoverPoi[];
}

// POI source decision: Photon canned queries, not Overpass. Overpass returned
// richer attraction data in testing but the public endpoints failed three of
// four calls (504s and dispatcher errors), which is unacceptable for a
// user-facing panel even with caching. Photon is the same provider the app
// already depends on, and with distance and category filtering its canned
// queries surface real landmarks. The three terms: the city name itself
// (eponymous sights such as Prague Castle or the Kyoto Imperial Palace),
// "museum" (reliable worldwide), and "temple" (worship sites, strong in Asia
// and harmless elsewhere once distant matches are dropped).
const HIGHLIGHT_QUERIES = (cityName: string) => [cityName, "museum", "temple"];
const HIGHLIGHT_RADIUS_KM = 30;
const HIGHLIGHT_LIMIT = 10;
const HIGHLIGHT_PHOTO_COUNT = 6;

// Map an OSM key/value pair to a highlight category, or null for tags that do
// not belong in a highlights list (hotels, restaurants, universities, and the
// like, which Photon returns under the same top-level keys).
function highlightCategory(
  osmKey: string,
  osmValue: string,
): PoiCategory | null {
  if (osmKey === "tourism") {
    if (osmValue === "museum" || osmValue === "gallery") return "museum";
    if (
      osmValue === "attraction" ||
      osmValue === "viewpoint" ||
      osmValue === "zoo" ||
      osmValue === "theme_park"
    ) {
      return "attraction";
    }
    return null;
  }
  if (osmKey === "historic") return "attraction";
  if (osmKey === "man_made") return "attraction";
  if (osmKey === "amenity") {
    if (osmValue === "place_of_worship") return "worship";
    if (osmValue === "theatre") return "attraction";
    return null;
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
    return null;
  }
  if (osmKey === "natural") {
    return osmValue === "beach" ? "beach" : "nature";
  }
  return null;
}

interface HighlightFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: { name?: string; osm_key?: string; osm_value?: string };
}

// One canned Photon query biased to the city center. Returns raw candidates;
// filtering and deduplication happen after the queries are merged.
async function photonHighlights(
  query: string,
  lat: number,
  lng: number,
): Promise<DiscoverPoi[]> {
  try {
    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "10");
    url.searchParams.set("lang", "en");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    for (const tag of [
      "tourism",
      "historic",
      "amenity",
      "leisure",
      "man_made",
    ]) {
      url.searchParams.append("osm_tag", tag);
    }
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return [];
    const raw = (await response.json()) as { features?: HighlightFeature[] };

    const pois: DiscoverPoi[] = [];
    for (const feature of raw.features ?? []) {
      const coords = feature.geometry?.coordinates;
      const props = feature.properties ?? {};
      if (!coords || coords.length < 2 || !props.name) continue;
      const category = highlightCategory(
        props.osm_key ?? "",
        props.osm_value ?? "",
      );
      if (!category) continue;
      // Photon's location bias still returns far-away name matches; keep only
      // results that are plausibly in or around the city.
      if (haversineKm(lat, lng, coords[1], coords[0]) > HIGHLIGHT_RADIUS_KM) {
        continue;
      }
      pois.push({
        name: props.name,
        category,
        lat: coords[1],
        lng: coords[0],
        imageUrl: null,
      });
    }
    return pois;
  } catch {
    return [];
  }
}

// Round-robin merge of the canned query results so the highlights mix
// categories instead of leading with ten museums.
function mergeHighlights(
  cityName: string,
  lists: DiscoverPoi[][],
): DiscoverPoi[] {
  const seen = new Set<string>([normalizeQuery(cityName)]);
  const merged: DiscoverPoi[] = [];
  const longest = Math.max(...lists.map((list) => list.length), 0);
  for (let i = 0; i < longest && merged.length < HIGHLIGHT_LIMIT; i += 1) {
    for (const list of lists) {
      if (merged.length >= HIGHLIGHT_LIMIT) break;
      const poi = list[i];
      if (!poi) continue;
      const key = normalizeQuery(poi.name);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(poi);
    }
  }
  return merged;
}

export async function getDiscoverCity(
  name: string,
  lat: number,
  lng: number,
  code: string,
): Promise<DiscoverCityDetail> {
  const queryNorm = `${normalizeQuery(name)}|${code.toLowerCase()}`;

  const cached = await readCache(CITY_PROVIDER, queryNorm);
  if (cached) return cached as DiscoverCityDetail;

  // Country name for the Wikipedia disambiguation fallback title.
  const admin = createAdminClient();
  const { data: country } = await admin
    .schema("batchport")
    .from("countries")
    .select("name")
    .eq("code", code)
    .maybeSingle<{ name: string }>();

  const [initialWiki, p18, lists] = await Promise.all([
    fetchWikipediaSummary(name),
    getWikimediaPhoto(name),
    Promise.all(
      HIGHLIGHT_QUERIES(name).map((query) => photonHighlights(query, lat, lng)),
    ),
  ]);
  let wiki = initialWiki;

  // A bare city name can land on a disambiguation page or miss entirely;
  // "{city}, {country}" is the conventional Wikipedia title for those.
  if ((wiki.disambiguation || !wiki.extract) && country?.name) {
    const retry = await fetchWikipediaSummary(`${name}, ${country.name}`);
    if (retry.extract && !retry.disambiguation) wiki = retry;
  }

  let heroImageUrl: string | null = null;
  let attribution: string | null = null;
  if (p18.url && !isEmblemImage(p18.url)) {
    heroImageUrl = p18.url;
    attribution = p18.attribution
      ? p18.license
        ? `${p18.attribution} (${p18.license})`
        : p18.attribution
      : p18.license;
  } else if (wiki.imageUrl && !isEmblemImage(wiki.imageUrl)) {
    heroImageUrl = wiki.imageUrl;
    attribution = "Image via Wikipedia";
  }

  const pois = mergeHighlights(name, lists);

  // Photos for the leading highlights, in small parallel batches. Each lookup
  // is cached under the wikimedia provider. Misses stay null and render as
  // icon placeholders.
  const photoTargets = pois.slice(0, HIGHLIGHT_PHOTO_COUNT);
  for (let i = 0; i < photoTargets.length; i += LOOKUP_BATCH_SIZE) {
    const batch = photoTargets.slice(i, i + LOOKUP_BATCH_SIZE);
    const photos = await Promise.all(
      batch.map((poi) => getWikimediaPhoto(poi.name)),
    );
    for (let j = 0; j < batch.length; j += 1) {
      const photo = photos[j];
      if (photo.url && !isEmblemImage(photo.url)) {
        batch[j].imageUrl = photo.url;
      }
    }
  }

  const result: DiscoverCityDetail = {
    name,
    summary: wiki.disambiguation ? null : wiki.extract,
    heroImageUrl,
    attribution,
    pois,
  };

  // Skip caching fully empty results so a transient upstream failure does not
  // pin an empty city view for 90 days.
  if (result.summary || result.heroImageUrl || result.pois.length > 0) {
    await writeCache(CITY_PROVIDER, queryNorm, result);
  }
  return result;
}

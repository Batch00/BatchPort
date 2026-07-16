import { createAdminClient } from "@/utils/supabase/admin";
import { getWikimediaPhoto } from "@/lib/wikimedia";

// Server-side data layer for the Discovery panel. Aggregates the country
// reference row, a Wikipedia summary, a hero photo, and the top cities for a
// country, caching the assembled payloads in batchport.geocode_cache. Server
// only: cache reads and writes use the admin client, which bypasses RLS.

const COUNTRY_PROVIDER = "discover_country";
const CITIES_PROVIDER = "discover_cities";
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

  await admin.schema("batchport").from("geocode_cache").insert({
    provider,
    query_norm: queryNorm,
    result,
    cached_at: new Date().toISOString(),
  });
}

// --- Wikipedia REST summary ---

interface WikipediaSummary {
  extract: string | null;
  imageUrl: string | null;
}

// The REST summary endpoint needs no API key. Redirects (e.g. alternative
// country names) are followed automatically by fetch.
async function fetchWikipediaSummary(
  title: string,
): Promise<WikipediaSummary> {
  const empty: WikipediaSummary = { extract: null, imageUrl: null };
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
      extract?: string;
      originalimage?: { source?: string };
      thumbnail?: { source?: string };
    };
    return {
      extract: raw.extract?.trim() || null,
      imageUrl:
        raw.originalimage?.source ?? raw.thumbnail?.source ?? null,
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

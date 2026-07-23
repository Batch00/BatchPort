import { createAdminClient } from "@/utils/supabase/admin";
import { getWikimediaPhoto } from "@/lib/wikimedia";
import { haversineKm, parseEwkbPoint } from "@/lib/geo";
import { normalizeQuery } from "@/lib/geocode";

// Server-side data layer for the Discovery panel. Aggregates the country
// reference row, a Wikipedia summary, a hero photo, and the top cities for a
// country, caching the assembled payloads in batchport.geocode_cache. Server
// only: cache reads and writes use the admin client, which bypasses RLS.

const COUNTRY_PROVIDER = "discover_country";
const CITIES_PROVIDER = "discover_cities";
const CITY_PROVIDER = "discover_city";
const POI_PROVIDER = "discover_poi";
const CLIMATE_PROVIDER = "discover_climate";
const GEO_PROVIDER = "discover_geo";
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ??
  "BatchPort/1.0 (+https://batchport.batch-apps.com)";

/** Practical country facts resolved from Wikidata claims. All best-effort:
 * missing properties are empty/null and simply do not render. */
export interface CountryFacts {
  /** Currencies to show: `code` is the ISO 4217 code where available, else the
   * label ("EUR", "Swiss franc"); `name` is the fuller label ("Euro") for a
   * tooltip when the chip shows only the code, null when the chip already shows
   * the full name. */
  currencies: { code: string; name: string | null }[];
  languages: string[];
  /** "right" or "left" (Wikidata P1622 label), null when unknown. */
  drivingSide: string | null;
  /** Plug standard labels ("Type E", "Europlug"). */
  plugTypes: string[];
  /** Mains voltage in volts (the lowest claimed value, i.e. single-phase). */
  voltage: number | null;
}

export interface DiscoverCountry {
  code: string;
  name: string;
  continent: string | null;
  region: string | null;
  summary: string | null;
  heroImageUrl: string | null;
  attribution: string | null;
  facts: CountryFacts | null;
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
  /** The article's own geotag, when present; used to reject wrong-place hits. */
  coordinates: { lat: number; lng: number } | null;
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
    coordinates: null,
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
      coordinates?: { lat?: number; lon?: number };
    };
    return {
      extract: raw.extract?.trim() || null,
      imageUrl:
        raw.originalimage?.source ?? raw.thumbnail?.source ?? null,
      disambiguation: raw.type === "disambiguation",
      coordinates:
        typeof raw.coordinates?.lat === "number" &&
        typeof raw.coordinates?.lon === "number"
          ? { lat: raw.coordinates.lat, lng: raw.coordinates.lon }
          : null,
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

// --- Country practical facts (Wikidata claims) ---

async function wikidataFetch(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

interface WdClaim {
  rank?: string;
  mainsnak?: { datavalue?: { value?: unknown } };
  qualifiers?: { P582?: unknown[] };
}

/** Usable values of a claim list: deprecated ranks and statements with an end
 * date (P582, e.g. a country's former currency) are dropped; preferred-rank
 * statements win over normal ones when both exist. */
function claimValues(claims: WdClaim[] | undefined): unknown[] {
  if (!claims || claims.length === 0) return [];
  const usable = claims.filter(
    (claim) => claim.rank !== "deprecated" && !claim.qualifiers?.P582,
  );
  const preferred = usable.filter((claim) => claim.rank === "preferred");
  const picked = preferred.length > 0 ? preferred : usable;
  return picked
    .map((claim) => claim.mainsnak?.datavalue?.value)
    .filter((value) => value !== undefined);
}

function claimEntityIds(values: unknown[], limit: number): string[] {
  const ids: string[] = [];
  for (const value of values) {
    const id = (value as { id?: string }).id;
    if (typeof id === "string" && !ids.includes(id)) ids.push(id);
    if (ids.length >= limit) break;
  }
  return ids;
}

const FACT_PROPS = {
  currency: "P38",
  language: "P37",
  drivingSide: "P1622",
  plugType: "P2853",
  voltage: "P2884",
} as const;

/** Resolve the practical facts for a country by name. Two to three Wikidata
 * calls on a country-aggregate cache miss: entity search, claims, then one
 * batched label lookup for the value entities. Any failure returns null. */
async function getCountryFacts(countryName: string): Promise<CountryFacts | null> {
  const search = (await wikidataFetch(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(
      countryName,
    )}&language=en&format=json&limit=1`,
  )) as { search?: { id?: string }[] } | null;
  const entityId = search?.search?.[0]?.id;
  if (!entityId) return null;

  const entities = (await wikidataFetch(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entityId}&props=claims&format=json`,
  )) as {
    entities?: Record<string, { claims?: Record<string, WdClaim[]> }>;
  } | null;
  const claims = entities?.entities?.[entityId]?.claims;
  if (!claims) return null;

  // Multiple currencies can be legitimately current (France lists the euro and
  // the CFP franc of its overseas territories), so keep two at most.
  const currencyIds = claimEntityIds(claimValues(claims[FACT_PROPS.currency]), 2);
  const languageIds = claimEntityIds(claimValues(claims[FACT_PROPS.language]), 3);
  const drivingIds = claimEntityIds(
    claimValues(claims[FACT_PROPS.drivingSide]),
    1,
  );
  const plugIds = claimEntityIds(claimValues(claims[FACT_PROPS.plugType]), 3);

  // Mains voltage: countries with three-phase claims list 230 and 400; the
  // lowest value is the household single-phase one travellers care about.
  let voltage: number | null = null;
  for (const value of claimValues(claims[FACT_PROPS.voltage])) {
    const amount = Number((value as { amount?: string }).amount);
    if (Number.isFinite(amount) && amount > 0) {
      voltage = voltage === null ? amount : Math.min(voltage, amount);
    }
  }

  const valueIds = [...currencyIds, ...languageIds, ...drivingIds, ...plugIds];
  const labelById = new Map<string, string>();
  const isoById = new Map<string, string>();
  if (valueIds.length > 0) {
    const labels = (await wikidataFetch(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${valueIds.join(
        "|",
      )}&props=labels|claims&languages=en&format=json`,
    )) as {
      entities?: Record<
        string,
        {
          labels?: { en?: { value?: string } };
          claims?: Record<string, WdClaim[]>;
        }
      >;
    } | null;
    for (const id of valueIds) {
      const entity = labels?.entities?.[id];
      const label = entity?.labels?.en?.value;
      if (label) labelById.set(id, label);
      // ISO 4217 code off currency entities ("EUR" reads better than "euro").
      const iso = claimValues(entity?.claims?.P498)[0];
      if (typeof iso === "string") isoById.set(id, iso);
    }
  }

  const facts: CountryFacts = {
    currencies: currencyIds
      .map((id) => {
        const iso = isoById.get(id);
        const label = labelById.get(id) ?? null;
        const code = iso ?? label;
        if (!code) return null;
        // Showing the ISO code leaves the label as the fuller tooltip name;
        // showing the label already reveals everything there is.
        return { code, name: iso ? label : null };
      })
      .filter(
        (value): value is { code: string; name: string | null } =>
          value !== null,
      ),
    languages: languageIds
      .map((id) => labelById.get(id))
      .filter((value): value is string => Boolean(value)),
    drivingSide: drivingIds.length > 0 ? labelById.get(drivingIds[0]) ?? null : null,
    plugTypes: plugIds
      .map((id) => labelById.get(id))
      .filter((value): value is string => Boolean(value)),
    voltage,
  };

  const empty =
    facts.currencies.length === 0 &&
    facts.languages.length === 0 &&
    !facts.drivingSide &&
    facts.plugTypes.length === 0 &&
    facts.voltage === null;
  return empty ? null : facts;
}

// --- Country aggregate ---

export async function getDiscoverCountry(
  code: string,
): Promise<DiscoverCountry | null> {
  // v3: the currencies fact changed from bare code strings to {code, name}
  // objects; the version suffix makes older cached payloads miss so they
  // refresh in the new shape. (v2 first added the Wikidata facts block.)
  const queryNorm = `${code.toLowerCase()}|v3`;

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

  // Wikipedia summary, the Wikidata P18 photo, and the practical facts all
  // resolve independently.
  const [wiki, p18, facts] = await Promise.all([
    fetchWikipediaSummary(country.name),
    getWikimediaPhoto(country.name),
    getCountryFacts(country.name),
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
    facts,
  };

  await writeCache(COUNTRY_PROVIDER, queryNorm, result);
  return result;
}

// --- Top cities ---

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

// lat/lng and code are optional: bucket list place items can lack either. No
// coordinates means no highlights (they are proximity searches); no code means
// no country-title fallback for the Wikipedia lookup. Both degrade to a
// summary-plus-hero view.
export async function getDiscoverCity(
  name: string,
  lat: number | null,
  lng: number | null,
  code: string | null,
): Promise<DiscoverCityDetail> {
  const hasCoords = lat !== null && lng !== null;
  const queryNorm = `${normalizeQuery(name)}|${code?.toLowerCase() ?? ""}`;

  const cached = await readCache(CITY_PROVIDER, queryNorm);
  if (cached) return cached as DiscoverCityDetail;

  // Country name for the Wikipedia disambiguation fallback title.
  const admin = createAdminClient();
  const { data: country } = code
    ? await admin
        .schema("batchport")
        .from("countries")
        .select("name")
        .eq("code", code)
        .maybeSingle<{ name: string }>()
    : { data: null };

  const [initialWiki, p18, lists] = await Promise.all([
    fetchWikipediaSummary(name),
    getWikimediaPhoto(name),
    hasCoords
      ? Promise.all(
          HIGHLIGHT_QUERIES(name).map((query) =>
            photonHighlights(query, lat as number, lng as number),
          ),
        )
      : Promise.resolve([] as DiscoverPoi[][]),
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
  // pin an empty city view for 90 days. Coordinate-less lookups are not cached
  // either: they have no highlights, and caching them would serve a degraded
  // payload to a later request that does carry coordinates.
  if (
    hasCoords &&
    (result.summary || result.heroImageUrl || result.pois.length > 0)
  ) {
    await writeCache(CITY_PROVIDER, queryNorm, result);
  }
  return result;
}

// --- POI detail ---

export interface DiscoverNearby {
  name: string;
  description: string | null;
  lat: number;
  lng: number;
}

export interface DiscoverPoiDetail {
  /** Display name: the resolved Wikipedia title, or the input name on a miss. */
  name: string;
  /** Wikipedia's one-line description ("Wrought-iron tower in Paris"). */
  description: string | null;
  summary: string | null;
  heroImageUrl: string | null;
  attribution: string | null;
  /** Other Wikipedia-documented places within the geosearch radius. */
  nearby: DiscoverNearby[];
}

interface GeosearchPage {
  title: string;
  description: string | null;
  lat: number;
  lng: number;
  thumbnailUrl: string | null;
}

// Wikipedia articles anchored to the coordinates, nearest first. This is the
// disambiguation-proof lookup: a POI's name may be ambiguous ("Imperial
// Palace") but its location is not, so the article physically at the spot is
// the right one. ggsradius 250m keeps the results to the site itself and its
// immediate surroundings.
async function fetchGeosearch(
  lat: number,
  lng: number,
): Promise<GeosearchPage[]> {
  try {
    const url = new URL("https://en.wikipedia.org/w/api.php");
    url.searchParams.set("action", "query");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    url.searchParams.set("generator", "geosearch");
    url.searchParams.set("ggscoord", `${lat}|${lng}`);
    url.searchParams.set("ggsradius", "250");
    url.searchParams.set("ggslimit", "8");
    url.searchParams.set("prop", "description|coordinates|pageimages");
    url.searchParams.set("piprop", "thumbnail");
    url.searchParams.set("pithumbsize", "320");
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return [];
    const raw = (await response.json()) as {
      query?: {
        pages?: {
          title?: string;
          index?: number;
          description?: string;
          coordinates?: { lat?: number; lon?: number }[];
          thumbnail?: { source?: string };
        }[];
      };
    };
    const pages: (GeosearchPage & { index: number })[] = [];
    for (const page of raw.query?.pages ?? []) {
      const coord = page.coordinates?.[0];
      if (
        !page.title ||
        typeof coord?.lat !== "number" ||
        typeof coord?.lon !== "number"
      ) {
        continue;
      }
      pages.push({
        title: page.title,
        description: page.description ?? null,
        lat: coord.lat,
        lng: coord.lon,
        thumbnailUrl: page.thumbnail?.source ?? null,
        index: page.index ?? Number.MAX_SAFE_INTEGER,
      });
    }
    // The generator reports distance order via index; the pages array itself
    // is not guaranteed to be sorted.
    pages.sort((a, b) => a.index - b.index);
    return pages;
  } catch {
    return [];
  }
}

// Loose name identity for matching a POI name against Wikipedia titles:
// "Louvre" should match "Louvre Museum" and vice versa.
function titlesMatch(a: string, b: string): boolean {
  const na = normalizeQuery(a);
  const nb = normalizeQuery(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

export async function getDiscoverPoi(
  name: string,
  lat: number,
  lng: number,
): Promise<DiscoverPoiDetail> {
  // Rounded coordinates in the key so tiny geocoder jitter still hits the
  // cache while distinct same-named places stay distinct.
  const queryNorm = `${normalizeQuery(name)}|${lat.toFixed(3)},${lng.toFixed(3)}`;

  const cached = await readCache(POI_PROVIDER, queryNorm);
  if (cached) return cached as DiscoverPoiDetail;

  // The geosearch always runs: it is both the fallback article resolver and
  // the source of the nearby list.
  const [direct, geoPages] = await Promise.all([
    fetchWikipediaSummary(name),
    fetchGeosearch(lat, lng),
  ]);

  // A direct hit can still be the wrong place: the bare name may resolve to a
  // same-named article elsewhere in the world. When the article carries a
  // geotag far from the POI, treat it as a miss and let the coordinate-
  // anchored geosearch pick the right one.
  const wrongPlace =
    direct.coordinates !== null &&
    haversineKm(lat, lng, direct.coordinates.lat, direct.coordinates.lng) > 50;

  let wiki = wrongPlace ? { ...direct, extract: null } : direct;
  let resolvedTitle = name;
  if (wiki.disambiguation || !wiki.extract) {
    // The direct title missed or landed on a disambiguation page. Use the
    // article actually at these coordinates, but only when its title
    // resembles the POI name: a POI with no article of its own (a
    // restaurant next to a famous square) must degrade to "no info", not
    // adopt its neighbor's article. Live probe: "Imperial Palace" at Kyoto
    // coordinates resolves to "Kyoto Imperial Palace"; "Chez Janou" near
    // Place des Vosges resolves to nothing.
    const match = geoPages.find((page) => titlesMatch(page.title, name));
    if (match) {
      const bySite = await fetchWikipediaSummary(match.title);
      if (bySite.extract && !bySite.disambiguation) {
        wiki = bySite;
        resolvedTitle = match.title;
      }
    }
  }
  const resolved = Boolean(wiki.extract) && !wiki.disambiguation;

  // Hero: the resolved article's page image, else the P18 flow the rest of
  // the photo pipeline uses (cached under the wikimedia provider).
  let heroImageUrl: string | null = null;
  let attribution: string | null = null;
  if (resolved && wiki.imageUrl && !isEmblemImage(wiki.imageUrl)) {
    heroImageUrl = wiki.imageUrl;
    attribution = "Image via Wikipedia";
  } else {
    const p18 = await getWikimediaPhoto(name);
    if (p18.url && !isEmblemImage(p18.url)) {
      heroImageUrl = p18.url;
      attribution = p18.attribution
        ? p18.license
          ? `${p18.attribution} (${p18.license})`
          : p18.attribution
        : p18.license;
    }
  }

  // Wikipedia's short description line, from the geosearch page metadata when
  // the resolved article appears there.
  const resolvedPage = geoPages.find((page) =>
    titlesMatch(page.title, resolvedTitle),
  );

  // Nearby: other documented places within the radius. Thumbnails are
  // required (keeps the list to photographed places) and articles about
  // events rather than sites are dropped by description.
  const nonPlace =
    /battle|revolt|rebellion|siege|incident|massacre|bombing|murder|assassination|riot|attack|conflict/i;
  const nearby: DiscoverNearby[] = geoPages
    .filter(
      (page) =>
        !titlesMatch(page.title, resolvedTitle) &&
        !titlesMatch(page.title, name) &&
        page.thumbnailUrl !== null &&
        !(page.description && nonPlace.test(page.description)),
    )
    .slice(0, 3)
    .map((page) => ({
      name: page.title,
      description: page.description,
      lat: page.lat,
      lng: page.lng,
    }));

  const result: DiscoverPoiDetail = {
    name: resolved ? resolvedTitle : name,
    description: resolvedPage?.description ?? null,
    summary: resolved ? wiki.extract : null,
    heroImageUrl,
    attribution,
    nearby,
  };

  // A fully empty payload is indistinguishable from a transient upstream
  // failure, so it is not cached; legitimate misses with any resolved field
  // (a hero, nearby items) are.
  if (result.summary || result.heroImageUrl || result.nearby.length > 0) {
    await writeCache(POI_PROVIDER, queryNorm, result);
  }
  return result;
}

// --- Viewport attractions (Wikipedia geosearch) ---

/** One Wikipedia-documented place near a viewport center, for the globe's
 * "Show attractions" explore layer. */
export interface DiscoverGeoAttraction {
  name: string;
  description: string | null;
  lat: number;
  lng: number;
  thumbnailUrl: string | null;
}

const GEO_LIMIT = 15;

// Zoom bands keep the cache coarse: one radius and one key-rounding per band,
// so panning within the same neighborhood re-hits the same cache row instead
// of minting a new request per pixel of movement.
function geoBand(zoom: number): { band: string; radiusM: number; round: number } {
  if (zoom >= 14) return { band: "high", radiusM: 2000, round: 2 };
  if (zoom >= 12) return { band: "mid", radiusM: 5000, round: 2 };
  // Wikipedia caps ggsradius at 10000 m.
  return { band: "low", radiusM: 10000, round: 1 };
}

// Articles about events rather than places (reused from the POI nearby list).
const NON_PLACE_RE =
  /battle|revolt|rebellion|siege|incident|massacre|bombing|murder|assassination|riot|attack|conflict/i;

/** Wikipedia-documented attractions around a viewport center. One geosearch
 * request per cache miss; results cached under discover_geo for 90 days keyed
 * by the rounded center and zoom band. */
export async function getDiscoverGeoAttractions(
  lat: number,
  lng: number,
  zoom: number,
): Promise<DiscoverGeoAttraction[]> {
  const { band, radiusM, round } = geoBand(zoom);
  const queryNorm = `${lat.toFixed(round)},${lng.toFixed(round)}|${band}`;

  const cached = await readCache(GEO_PROVIDER, queryNorm);
  if (cached) return cached as DiscoverGeoAttraction[];

  let pages: {
    title?: string;
    index?: number;
    description?: string;
    coordinates?: { lat?: number; lon?: number }[];
    thumbnail?: { source?: string };
  }[] = [];
  try {
    const url = new URL("https://en.wikipedia.org/w/api.php");
    url.searchParams.set("action", "query");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    url.searchParams.set("generator", "geosearch");
    url.searchParams.set("ggscoord", `${lat}|${lng}`);
    url.searchParams.set("ggsradius", String(radiusM));
    url.searchParams.set("ggslimit", "20");
    url.searchParams.set("prop", "description|coordinates|pageimages");
    url.searchParams.set("piprop", "thumbnail");
    url.searchParams.set("pithumbsize", "160");
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return [];
    pages =
      ((await response.json()) as { query?: { pages?: typeof pages } }).query
        ?.pages ?? [];
  } catch {
    return [];
  }

  const withIndex: (DiscoverGeoAttraction & { index: number })[] = [];
  for (const page of pages) {
    const coord = page.coordinates?.[0];
    if (
      !page.title ||
      typeof coord?.lat !== "number" ||
      typeof coord?.lon !== "number"
    ) {
      continue;
    }
    if (page.description && NON_PLACE_RE.test(page.description)) continue;
    withIndex.push({
      name: page.title,
      description: page.description ?? null,
      lat: coord.lat,
      lng: coord.lon,
      thumbnailUrl: page.thumbnail?.source ?? null,
      index: page.index ?? Number.MAX_SAFE_INTEGER,
    });
  }
  withIndex.sort((a, b) => a.index - b.index);
  const result: DiscoverGeoAttraction[] = withIndex
    .slice(0, GEO_LIMIT)
    .map(({ name, description, lat: pLat, lng: pLng, thumbnailUrl }) => ({
      name,
      description,
      lat: pLat,
      lng: pLng,
      thumbnailUrl,
    }));

  // Empty results are indistinguishable from transient upstream failures and
  // are not cached; genuinely empty areas cost one cheap request per settle.
  if (result.length > 0) {
    await writeCache(GEO_PROVIDER, queryNorm, result);
  }
  return result;
}

// --- Monthly climate (Open-Meteo ERA5 archive) ---

/** Typical conditions for one month at a location, averaged over a decade of
 * ERA5 reanalysis. Temperatures in °C; wetDays is the average number of days
 * per month with at least 1 mm of precipitation. */
export interface DiscoverClimate {
  month: number;
  high: number;
  low: number;
  wetDays: number;
}

// Endpoint choice: the archive API (ERA5 reanalysis, real observed weather)
// rather than the climate API (CMIP6 model projections aimed at future
// scenarios). One request for a fixed recent decade yields every month's
// climatology, which is averaged server-side. The window is pinned so cache
// keys stay deterministic.
const CLIMATE_START = "2015-01-01";
const CLIMATE_END = "2024-12-31";
const CLIMATE_YEARS = 10;
// A day with at least 1 mm of precipitation counts as wet (the WMO convention).
const WET_DAY_MM = 1;

// One decimal degree of rounding (~11 km): climate does not vary within a city,
// and nearby lookups share cache rows.
function climateKey(lat: number, lng: number, month: number): string {
  return `${lat.toFixed(1)},${lng.toFixed(1)}|${month}`;
}

export async function getDiscoverClimate(
  lat: number,
  lng: number,
  month: number,
): Promise<DiscoverClimate | null> {
  const cached = await readCache(CLIMATE_PROVIDER, climateKey(lat, lng, month));
  if (cached) return cached as DiscoverClimate;

  // Fetch with the key-rounded coordinates so every lookup that shares a cache
  // key is backed by identical upstream data.
  let daily: {
    time?: string[];
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
    precipitation_sum?: (number | null)[];
  };
  try {
    const url = new URL("https://archive-api.open-meteo.com/v1/archive");
    url.searchParams.set("latitude", lat.toFixed(1));
    url.searchParams.set("longitude", lng.toFixed(1));
    url.searchParams.set("start_date", CLIMATE_START);
    url.searchParams.set("end_date", CLIMATE_END);
    url.searchParams.set(
      "daily",
      "temperature_2m_max,temperature_2m_min,precipitation_sum",
    );
    url.searchParams.set("timezone", "UTC");
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      // The decade of daily values is a large payload; give it more room than
      // the metadata calls get.
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return null;
    daily = ((await response.json()) as { daily?: typeof daily }).daily ?? {};
  } catch {
    return null;
  }

  const time = daily.time ?? [];
  const highs = daily.temperature_2m_max ?? [];
  const lows = daily.temperature_2m_min ?? [];
  const precip = daily.precipitation_sum ?? [];

  // Accumulate per calendar month across the decade.
  const sums = Array.from({ length: 12 }, () => ({
    high: 0,
    low: 0,
    count: 0,
    wet: 0,
  }));
  for (let i = 0; i < time.length; i += 1) {
    const monthIndex = Number(time[i]?.slice(5, 7)) - 1;
    const high = highs[i];
    const low = lows[i];
    if (monthIndex < 0 || monthIndex > 11 || high == null || low == null) {
      continue;
    }
    const bucket = sums[monthIndex];
    bucket.high += high;
    bucket.low += low;
    bucket.count += 1;
    if ((precip[i] ?? 0) >= WET_DAY_MM) bucket.wet += 1;
  }

  const months: DiscoverClimate[] = [];
  for (let m = 0; m < 12; m += 1) {
    const bucket = sums[m];
    if (bucket.count === 0) continue;
    months.push({
      month: m + 1,
      high: Math.round(bucket.high / bucket.count),
      low: Math.round(bucket.low / bucket.count),
      wetDays: Math.round(bucket.wet / CLIMATE_YEARS),
    });
  }
  if (months.length === 0) return null;

  // The one upstream fetch yields all twelve months; cache each under its own
  // month key so later lookups for other months of the same place stay local.
  await Promise.all(
    months.map((entry) =>
      writeCache(CLIMATE_PROVIDER, climateKey(lat, lng, entry.month), entry),
    ),
  );
  return months.find((entry) => entry.month === month) ?? null;
}

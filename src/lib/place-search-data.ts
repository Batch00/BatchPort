import { requireUser } from "@/lib/current-user";
import { normalizeQuery, readCache, writeCache } from "@/lib/geocode";
import { CATALOG_ITEM_COLUMNS, normalizeCatalogItem } from "@/lib/places";
import type { PhotonPlace } from "@/lib/place-search";
import type { PlaceCatalogItem } from "@/lib/types";

// The two server reads behind the places search. Pure ranking lives in
// place-search.ts.

// Same trap as search.ts: PostgREST unquotes a filter value before it becomes a
// LIKE pattern and separately translates * to %, so backslash escaping does not
// work. Every wildcard character is mapped to _ (match exactly one character),
// which still matches its literal self and cannot match more than its own
// length.
const WILDCARD_CHARS = /[%_*\\]/g;

const CATALOG_LIMIT = 25;
const PHOTON_LIMIT = 8;

/**
 * Tracked venues whose name contains the query.
 *
 * ilike rather than trigram: the catalog is 672 rows, so a sequential scan with
 * a case-insensitive contains is already sub-millisecond, and pg_trgm plus a
 * GIN index would be a migration and an extension buying nothing at this size.
 * If the catalog grows by an order of magnitude this is the place to revisit.
 *
 * The limit is generous because the ranking downstream, not the database,
 * decides what leads: a query matching twenty venues weakly still has to be
 * able to surface the one it matches strongly.
 */
export async function searchCatalog(query: string): Promise<PlaceCatalogItem[]> {
  const { supabase } = await requireUser();
  const escaped = query.replace(WILDCARD_CHARS, "_");
  const { data, error } = await supabase
    .from("place_catalog_items")
    .select(CATALOG_ITEM_COLUMNS)
    .ilike("name", `%${escaped}%`)
    .limit(CATALOG_LIMIT);
  if (error) throw error;
  return (data ?? []).map((row) =>
    normalizeCatalogItem(row as unknown as Parameters<typeof normalizeCatalogItem>[0]),
  );
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    city?: string;
    state?: string;
    county?: string;
    countrycode?: string;
    osm_key?: string;
    osm_value?: string;
    type?: string;
  };
}

/**
 * Photon hits shaped for this feature.
 *
 * Neither existing parser fits. parsePhoton folds the settlement INTO the name
 * (`props.name ?? props.city`), so a POI hit loses the city it is in;
 * parsePhotonPoi keeps an address string but drops the state. The sheet needs
 * all three of locality, region, and country separately, because they are three
 * columns on places and two of them feed the generated locality_key.
 *
 * For a settlement hit the locality is the place itself, so `props.city` falls
 * back to the name: logging "Knoxville" should group under Knoxville, not under
 * nothing.
 */
export function parsePhotonPlace(raw: unknown): PhotonPlace[] {
  const features = (raw as { features?: PhotonFeature[] }).features ?? [];
  const out: PhotonPlace[] = [];
  const seen = new Set<string>();
  for (const feature of features) {
    const coords = feature.geometry?.coordinates;
    const props = feature.properties ?? {};
    if (!coords || coords.length < 2 || !props.name) continue;
    const key = `${normalizeQuery(props.name)}|${coords[0].toFixed(3)},${coords[1].toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const isSettlement =
      props.osm_key === "place" || props.type === "city" || props.type === "district";
    out.push({
      name: props.name,
      locality_name: props.city ?? (isSettlement ? props.name : null),
      admin_region: props.state ?? props.county ?? null,
      country_code: props.countrycode ? props.countrycode.toUpperCase() : null,
      lat: coords[1],
      lng: coords[0],
      osm_key: props.osm_key ?? null,
      osm_value: props.osm_value ?? null,
    });
  }
  return out;
}

/**
 * Photon, UNFILTERED by osm_tag, through the existing geocode_cache path.
 *
 * /api/geocode/poi constrains the search to tourism, amenity, leisure,
 * historic, building and man_made, which is right for "an experience at this
 * stop" and wrong here: it cannot return a city, and "knoxville" is one of the
 * two worked examples this route has to answer. The general endpoint returns
 * settlements and POIs together, which is the actual question the sheet asks.
 *
 * Cached under its own provider key so it cannot collide with either existing
 * route's cached payloads for the same string.
 */
export async function searchPhotonPlaces(
  query: string,
  bias?: { lat: number; lng: number },
): Promise<PhotonPlace[]> {
  const queryNorm = bias
    ? `${normalizeQuery(query)}@${bias.lat.toFixed(2)},${bias.lng.toFixed(2)}`
    : normalizeQuery(query);

  const cached = await readCache("photon_place", queryNorm);
  if (cached) return parsePhotonPlace(cached);

  let raw: unknown;
  try {
    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(PHOTON_LIMIT));
    url.searchParams.set("lang", "en");
    if (bias) {
      url.searchParams.set("lat", String(bias.lat));
      url.searchParams.set("lon", String(bias.lng));
    }
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) return [];
    raw = await response.json();
  } catch {
    // The catalog half still answers. A geocoder outage degrades the list, it
    // does not fail the search.
    return [];
  }

  await writeCache("photon_place", queryNorm, raw, bias);
  return parsePhotonPlace(raw);
}

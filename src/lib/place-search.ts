import { haversineKm } from "@/lib/geo";
import type { PlaceCatalogItem, PlaceType } from "@/lib/types";

// Ranking and merging for the places search. Pure and client-safe: the server
// reads live in place-search-data.ts, mirroring the nearby and transport splits.
//
// One query fans out to two sources that answer different questions. The
// catalog knows about 672 tracked venues and nothing else in the world; Photon
// knows about the world and nothing about which of it you are tracking. So the
// merge rule is not "interleave by relevance", it is:
//
//   a STRONG catalog name match leads, otherwise Photon owns the list.
//
// "fiserv" has a strong catalog match and must surface Fiserv Forum above
// anything Photon returns for it. "knoxville" has no catalog match at all, so
// Photon owns the list and the catalog contributes nothing. A WEAK catalog
// match (the query appears somewhere inside the name, but not at the start of
// the name or of one of its words) sits below Photon rather than above it:
// "park" should not push forty catalog venues over the actual park somebody is
// searching for.

export type PlaceSearchSource = "catalog" | "photon";

export interface PlaceCatalogBadge {
  slug: string;
  label: string;
}

/** A Photon hit shaped for this feature. See parsePhotonPlace. */
export interface PhotonPlace {
  name: string;
  /** The settlement the hit sits in. For a city hit, the city itself. */
  locality_name: string | null;
  admin_region: string | null;
  country_code: string | null;
  lat: number;
  lng: number;
  osm_key: string | null;
  osm_value: string | null;
}

export interface PlaceSearchResult {
  /** Stable react key. Catalog rows use their QID, Photon rows their coords. */
  key: string;
  source: PlaceSearchSource;
  name: string;
  lat: number;
  lng: number;
  locality_name: string | null;
  admin_region: string | null;
  country_code: string | null;
  /**
   * For a catalog row this is derived from its catalogs and the sheet locks
   * it. For a Photon row it is the editable default.
   */
  place_type: PlaceType;
  /** Non-null exactly when source is "catalog". */
  catalog_item_id: string | null;
  tenants: string[];
  /** The badge. Empty for Photon rows. */
  catalogs: PlaceCatalogBadge[];
}

export const SEARCH_MIN_CHARS = 2;

/** At or above this, a catalog match outranks everything Photon returned. */
export const STRONG_MATCH = 80;

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * How well a catalog name answers the query, 0 for no match.
 *
 *   100  the whole name is the query
 *    90  the name starts with it            ("fiserv" -> Fiserv Forum)
 *    80  a word in the name starts with it  ("forum"  -> Fiserv Forum)
 *    40  it appears somewhere else inside   ("iser"   -> Fiserv Forum)
 *
 * The 80 boundary is where "the user is naming this venue" stops and "this
 * venue happens to contain those letters" starts, which is exactly the line
 * between leading the list and sitting under Photon.
 */
export function matchStrength(name: string, query: string): number {
  const n = norm(name);
  const q = norm(query);
  if (!q || !n) return 0;
  if (n === q) return 100;
  if (n.startsWith(q)) return 90;
  if (n.split(" ").some((word) => word.startsWith(q))) return STRONG_MATCH;
  if (n.includes(q)) return 40;
  return 0;
}

// Which catalogs a venue belongs to decides what kind of thing it is. Only
// national_parks is not a stadium or an arena, and the enum has no "arena", so
// everything else lands on "stadium".
const PARK_CATALOGS = new Set(["national_parks"]);

export function catalogPlaceType(catalogs: PlaceCatalogBadge[]): PlaceType {
  if (catalogs.length === 0) return "other";
  return catalogs.every((c) => PARK_CATALOGS.has(c.slug)) ? "park" : "stadium";
}

export function catalogItemToResult(item: PlaceCatalogItem): PlaceSearchResult {
  return {
    key: `catalog:${item.wikidata_qid}`,
    source: "catalog",
    name: item.name,
    lat: item.lat ?? 0,
    lng: item.lng ?? 0,
    // city, state, and country all come from the catalog row. country_code
    // matters more than it looks: it is the last segment of the generated
    // locality_key, so a catalog pick with no country would not group with the
    // same place picked from Photon (which always returns one).
    locality_name: item.city,
    admin_region: item.state,
    country_code: item.country_code,
    place_type: catalogPlaceType(item.catalogs),
    catalog_item_id: item.id,
    tenants: item.tenants,
    catalogs: item.catalogs,
  };
}

export function photonToResult(hit: PhotonPlace): PlaceSearchResult {
  return {
    key: `photon:${hit.lat.toFixed(5)},${hit.lng.toFixed(5)}:${norm(hit.name)}`,
    source: "photon",
    name: hit.name,
    lat: hit.lat,
    lng: hit.lng,
    locality_name: hit.locality_name,
    admin_region: hit.admin_region,
    country_code: hit.country_code,
    // The editable default. Deliberately not inferred from the OSM tag: the
    // sheet lets it be changed in one tap, and a confidently wrong guess
    // ("building" -> landmark for somebody's flat) is worse than a default
    // everybody expects to check.
    place_type: "city",
    catalog_item_id: null,
    tenants: [],
    catalogs: [],
  };
}

/** A Photon hit and a catalog venue close enough to be the same building. */
const SAME_PLACE_KM = 0.5;

function isDuplicate(photon: PlaceSearchResult, catalog: PlaceSearchResult): boolean {
  const a = norm(photon.name);
  const b = norm(catalog.name);
  if (a === b) return true;
  if (!a.includes(b) && !b.includes(a)) return false;
  if (!catalog.lat && !catalog.lng) return false;
  return haversineKm(photon.lat, photon.lng, catalog.lat, catalog.lng) <= SAME_PLACE_KM;
}

/**
 * Merge the two sources into the list the sheet renders.
 *
 * Photon results that duplicate a catalog venue are dropped, never the other
 * way round: the catalog row is the one carrying the badge, the tenants, and
 * the catalog_item_id that makes the visit count toward a catalog. Two rows for
 * one building where only one of them is tracked is the worst outcome here,
 * because picking the wrong one is invisible until the venue fails to show up
 * as tracked later.
 */
export function rankPlaceResults(
  query: string,
  catalogItems: PlaceCatalogItem[],
  photonHits: PhotonPlace[],
  limit = 12,
): PlaceSearchResult[] {
  const scored = catalogItems
    .map((item) => ({ result: catalogItemToResult(item), score: matchStrength(item.name, query) }))
    .filter((entry) => entry.score > 0 && (entry.result.lat !== 0 || entry.result.lng !== 0));

  const byRank = (
    a: { result: PlaceSearchResult; score: number },
    b: { result: PlaceSearchResult; score: number },
  ) =>
    b.score - a.score ||
    a.result.name.length - b.result.name.length ||
    a.result.name.localeCompare(b.result.name);

  const strong = scored.filter((e) => e.score >= STRONG_MATCH).sort(byRank).map((e) => e.result);
  const weak = scored.filter((e) => e.score < STRONG_MATCH).sort(byRank).map((e) => e.result);
  const catalog = [...strong, ...weak];

  const photon = photonHits
    .map(photonToResult)
    .filter((hit) => !catalog.some((item) => isDuplicate(hit, item)));

  return [...strong, ...photon, ...weak].slice(0, limit);
}

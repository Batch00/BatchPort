// The engine shared by the places seeds (seed-places.ts for the owner's
// account, seed-demo-places.ts for the demo account). Moved here unchanged
// from seed-places.ts when the second seed needed it, so the two cannot drift.
//
// COORDINATES ARE SOURCED, never invented. A catalog venue contributes its own
// geom, city, state and country. Everything else is resolved through Photon at
// seed time, the same geocoder the entry sheet uses.
//
// IDEMPOTENT. Each place goes through findDuplicate from lib/place-dedup.ts,
// the same rule createPlaceAction applies, so a re-run folds into the existing
// rows; visits are keyed on (place, date), so a re-run adds none twice.

import { parseEwkbPoint, pointEwkt } from "../src/lib/geo";
import { findDuplicate, type DuplicateCandidate } from "../src/lib/place-dedup";
import type { PlaceType } from "../src/lib/types";
import type { PlacesClient } from "./places-db";

export interface VisitSeed {
  visit_date: string;
  end_date?: string;
  occasion: string | null;
  /** Free text over the occasion ("College reunion"). Never a real person's
   * name on the demo account, which is a public profile. */
  occasion_label?: string;
  event_org?: string;
  event_detail?: string;
  transport_mode?: string;
  notes?: string;
}

export interface PlaceSeed {
  /** Exact name in place_catalog_items, for a tracked venue. */
  catalogName?: string;
  /** Photon query, for everything else. */
  query?: string;
  /** Overrides the resolved name. */
  name?: string;
  /** Only for a non-catalog place; a catalog venue derives its own. */
  placeType?: PlaceType;
  visits: VisitSeed[];
}

// Shaped to exercise the list rather than to be a travel history:
//
//   - Chicago holds two tracked venues AND the city itself, so the grouped
//     list has a three-place header to draw.
//   - Boston holds a tracked venue and the city, the two-place case.
//   - Madison holds a stadium, a campus, and the city.
//   - Wrigley Field carries three visits, so the repeat indicator and the
//     detail view's visit list have something real in them.
//   - Two national parks have no locality at all, so they are bare rows, which
//     is the case the "no special case for a park with no city" rule exists for.

// --- Photon, the same geocoder the entry sheet uses -------------------------

interface Resolved {
  name: string;
  lat: number;
  lng: number;
  locality_name: string | null;
  admin_region: string | null;
  country_code: string | null;
}

async function geocode(query: string): Promise<Resolved | null> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "1");
  url.searchParams.set("lang", "en");
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    features?: { geometry?: { coordinates?: [number, number] }; properties?: Record<string, string> }[];
  };
  const f = json.features?.[0];
  const c = f?.geometry?.coordinates;
  const p = f?.properties ?? {};
  if (!c || c.length < 2 || !p.name) return null;
  const isSettlement = p.osm_key === "place" || p.type === "city";
  return {
    name: p.name,
    lat: c[1],
    lng: c[0],
    locality_name: p.city ?? (isSettlement ? p.name : null),
    admin_region: p.state ?? p.county ?? null,
    country_code: p.countrycode ? p.countrycode.toUpperCase() : null,
  };
}

// --- Resolution -------------------------------------------------------------

export interface Planned {
  name: string;
  place_type: PlaceType;
  lat: number;
  lng: number;
  locality_name: string | null;
  admin_region: string | null;
  country_code: string | null;
  catalog_item_id: string | null;
  visits: VisitSeed[];
}

const PARK_CATALOGS = new Set(["national_parks"]);

async function resolveCatalog(client: PlacesClient, name: string) {
  const { data, error } = await client
    .from("place_catalog_items")
    .select("id,name,geom,city,state,country_code,place_catalog_item_memberships(place_catalogs(slug))")
    .eq("name", name)
    .maybeSingle();
  if (error) throw new Error(`catalog lookup "${name}": ${error.message}`);
  if (!data) return null;
  const row = data as unknown as {
    id: string; name: string; geom: string | null; city: string | null;
    state: string | null; country_code: string | null;
    place_catalog_item_memberships: { place_catalogs: { slug: string } | { slug: string }[] | null }[];
  };
  const point = row.geom ? parseEwkbPoint(row.geom) : null;
  if (!point) throw new Error(`catalog item "${name}" has no usable geom`);
  const slugs = (row.place_catalog_item_memberships ?? []).flatMap((m) => {
    const c = m.place_catalogs;
    return !c ? [] : Array.isArray(c) ? c.map((x) => x.slug) : [c.slug];
  });
  return {
    id: row.id,
    name: row.name,
    lat: point.lat,
    lng: point.lng,
    // A multi-state park carries "North Carolina|Tennessee"; that is the
    // catalog's sourced answer and the seed does not second-guess it.
    city: row.city,
    state: row.state,
    country_code: row.country_code,
    place_type: (slugs.length > 0 && slugs.every((s) => PARK_CATALOGS.has(s)) ? "park" : "stadium") as PlaceType,
  };
}

export async function planSeeds(
  client: PlacesClient,
  seeds: PlaceSeed[],
): Promise<Planned[]> {
  const out: Planned[] = [];
  for (const seed of seeds) {
    if (seed.catalogName) {
      const item = await resolveCatalog(client, seed.catalogName);
      if (!item) throw new Error(`no catalog item named "${seed.catalogName}"`);
      out.push({
        name: seed.name ?? item.name,
        place_type: seed.placeType ?? item.place_type,
        lat: item.lat,
        lng: item.lng,
        locality_name: item.city,
        admin_region: item.state,
        country_code: item.country_code,
        catalog_item_id: item.id,
        visits: seed.visits,
      });
      continue;
    }
    if (!seed.query) throw new Error("a seed needs catalogName or query");
    const hit = await geocode(seed.query);
    if (!hit) throw new Error(`Photon returned nothing for "${seed.query}"`);
    out.push({
      name: seed.name ?? hit.name,
      place_type: seed.placeType ?? "city",
      lat: hit.lat,
      lng: hit.lng,
      locality_name: hit.locality_name,
      admin_region: hit.admin_region,
      country_code: hit.country_code,
      catalog_item_id: null,
      visits: seed.visits,
    });
    // Photon is a free public endpoint; do not hammer it.
    await new Promise((r) => setTimeout(r, 250));
  }
  return out;
}

// --- Write ------------------------------------------------------------------

export interface SeedResult {
  created: number;
  deduped: number;
  visitsAdded: number;
}

/** The occasion slug to id map the visits are written with. */
export async function occasionIds(client: PlacesClient): Promise<Map<string, string>> {
  const { data, error } = await client.from("occasions").select("id,slug");
  if (error) throw new Error(`occasions: ${error.message}`);
  return new Map((data ?? []).map((o) => [o.slug as string, o.id as string]));
}

/** Print the resolved plan, for --dry-run. */
export function printPlan(planned: Planned[]): void {
  for (const p of planned) {
    const where = [p.locality_name, p.admin_region, p.country_code].filter(Boolean).join(", ");
    console.log(
      `  ${p.name.padEnd(38)} ${p.place_type.padEnd(9)} ${p.catalog_item_id ? "catalog" : "photon "} ` +
        `${p.visits.length} visit${p.visits.length === 1 ? " " : "s"}  ${where || "(no locality)"}`,
    );
  }
}

export async function writeSeeds(
  client: PlacesClient,
  userId: string,
  planned: Planned[],
  occasionId: Map<string, string>,
): Promise<SeedResult> {
  let created = 0;
  let deduped = 0;
  let visitsAdded = 0;

  for (const p of planned) {
    // The SAME decision the server action makes. Re-read each time so places
    // created earlier in this run are candidates for later ones.
    const { data: existingRows, error: exErr } = await client
      .from("places")
      .select("id,name,locality_name,catalog_item_id")
      .eq("user_id", userId)
      // Same ordering as the action, for the same reason.
      .order("created_at", { ascending: true });
    if (exErr) throw new Error(`candidates: ${exErr.message}`);
    const existingId = findDuplicate((existingRows ?? []) as DuplicateCandidate[], {
      name: p.name,
      locality_name: p.locality_name,
      catalog_item_id: p.catalog_item_id,
    });

    let placeId: string;
    if (existingId) {
      placeId = existingId;
      deduped++;
    } else {
      const { data, error } = await client
        .from("places")
        .insert({
          user_id: userId,
          name: p.name,
          place_type: p.place_type,
          geom: pointEwkt(p.lng, p.lat),
          country_code: p.country_code,
          admin_region: p.admin_region,
          locality_name: p.locality_name,
          catalog_item_id: p.catalog_item_id,
          // locality_key is GENERATED ALWAYS AS STORED and is absent on purpose.
        })
        .select("id")
        .single();
      if (error) throw new Error(`insert "${p.name}": ${error.message}`);
      placeId = data.id as string;
      created++;
    }

    // Visits are keyed on (place, date) for idempotency: re-running must not
    // stack another copy of the same day.
    const { data: haveVisits } = await client
      .from("place_visits")
      .select("visit_date")
      .eq("user_id", userId)
      .eq("place_id", placeId);
    const seen = new Set((haveVisits ?? []).map((v) => v.visit_date as string));

    for (const v of p.visits) {
      if (seen.has(v.visit_date)) continue;
      const { error } = await client.from("place_visits").insert({
        place_id: placeId,
        user_id: userId,
        visit_date: v.visit_date,
        end_date: v.end_date ?? null,
        occasion_id: v.occasion ? (occasionId.get(v.occasion) ?? null) : null,
        occasion_label: v.occasion_label ?? null,
        event_org: v.event_org ?? null,
        event_detail: v.event_detail ?? null,
        transport_mode: v.transport_mode ?? null,
        trip_id: null,
        notes: v.notes ?? null,
      });
      if (error) throw new Error(`visit ${v.visit_date} at "${p.name}": ${error.message}`);
      visitsAdded++;
    }
  }

  return { created, deduped, visitsAdded };
}

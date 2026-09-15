// Seed a realistic set of places, so the grouped list and the pin density can
// be judged before anything is built on top of them.
//
// Run with: npm run seed-places          (add --dry-run to see the plan only)
//
// Reference-style script: talks to Supabase with the service-role key, needs no
// dev server. Writes to ONE account, never the demo one.
//
// WHY IT DOES NOT CALL createPlaceAction, which is what the brief asked for.
// It cannot: that is a "use server" action whose first statement resolves the
// session from request cookies, and the atomic RPC underneath it reads
// auth.uid(), which is NULL for the service role. Calling the RPC from here
// fails with 28000 "requires an authenticated caller" (verified, not assumed).
//
// What the brief actually wanted is that the seed cannot reintroduce the
// duplicate-place bug, and that is honoured properly: the dedup RULE lives in
// lib/place-dedup.ts as a pure decision over candidate rows, and this script
// applies the very same function the action does. One rule, two callers, no
// second implementation to drift. The one thing it gives up is the action's
// single-statement atomicity, which is the right trade for a seed: a failed run
// is re-run, and re-running is a no-op by the same dedup rule.
//
// COORDINATES ARE SOURCED, never invented. A catalog venue contributes its own
// geom, city, state and country. Everything else is resolved through Photon at
// seed time, the same geocoder the entry sheet uses, so nothing here comes from
// a model's memory of where a city is.

import { parseEwkbPoint, pointEwkt } from "../src/lib/geo";
import { findDuplicate, type DuplicateCandidate } from "../src/lib/place-dedup";
import type { PlaceType } from "../src/lib/types";
import { adminClient, type PlacesClient } from "./places-db";

// Carson's account. The demo user is never written to; see CLAUDE.md.
// Typed as string rather than left as literals so the guard in main() is a real
// runtime check: with literal types TypeScript proves the comparison can never
// be true and rejects it, which would mean deleting the guard that matters if
// this id is ever edited.
const USER_ID: string = "1ca08f60-c0eb-4fae-8297-1a2c73fb9cfc";
const DEMO_USER_ID: string = "703fbe07-db8a-41bd-bdee-928c2fa88107";

interface VisitSeed {
  visit_date: string;
  end_date?: string;
  occasion: string | null;
  event_org?: string;
  event_detail?: string;
  transport_mode?: string;
  notes?: string;
}

interface PlaceSeed {
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
const SEED: PlaceSeed[] = [
  // --- Chicago ------------------------------------------------------------
  {
    catalogName: "Wrigley Field",
    visits: [
      { visit_date: "2023-07-14", occasion: "game", event_org: "Chicago Cubs", event_detail: "Cubs vs Cardinals", transport_mode: "train" },
      { visit_date: "2024-06-08", occasion: "game", event_org: "Chicago Cubs", event_detail: "Cubs vs Brewers", transport_mode: "train" },
      { visit_date: "2025-08-22", occasion: "game", event_org: "Chicago Cubs", event_detail: "Cubs vs Pirates", transport_mode: "car" },
    ],
  },
  { catalogName: "Soldier Field", visits: [{ visit_date: "2024-11-17", occasion: "game", event_org: "Chicago Bears", event_detail: "Bears vs Vikings", transport_mode: "train" }] },
  { query: "Chicago, Illinois", placeType: "city", visits: [{ visit_date: "2023-07-13", end_date: "2023-07-16", occasion: "weekend", transport_mode: "flight", notes: "First proper look at the city." }] },

  // --- Green Bay ----------------------------------------------------------
  // Lambeau Field is already logged by hand, so the city alone completes the
  // group. This is the pairing that was verified end to end when country_code
  // was added to the catalog: a catalog venue and a geocoded city keying
  // identically as green bay|wisconsin|US.
  { query: "Green Bay, Wisconsin", placeType: "city", visits: [{ visit_date: "2026-09-05", end_date: "2026-09-07", occasion: "weekend", transport_mode: "car", notes: "Up for the game." }] },

  // --- Boston -------------------------------------------------------------
  { catalogName: "Fenway Park", visits: [{ visit_date: "2025-05-30", occasion: "game", event_org: "Boston Red Sox", event_detail: "Red Sox vs Orioles", transport_mode: "walk" }] },
  { query: "Boston, Massachusetts", placeType: "city", visits: [{ visit_date: "2025-05-29", end_date: "2025-06-01", occasion: "vacation", transport_mode: "flight" }] },

  // --- Madison ------------------------------------------------------------
  { catalogName: "Camp Randall Stadium", visits: [{ visit_date: "2024-10-05", occasion: "game", event_org: "Wisconsin Badgers", event_detail: "Badgers vs Purdue", transport_mode: "car" }] },
  { query: "University of Wisconsin-Madison", placeType: "campus", visits: [{ visit_date: "2024-10-05", occasion: "game", transport_mode: "walk", notes: "Walked the campus before kickoff." }] },
  { query: "Madison, Wisconsin", placeType: "city", visits: [{ visit_date: "2024-10-04", end_date: "2024-10-06", occasion: "weekend", transport_mode: "car" }] },

  // --- Parks, which have no locality and so are bare rows ------------------
  { catalogName: "Rocky Mountain National Park", visits: [{ visit_date: "2023-09-02", end_date: "2023-09-05", occasion: "vacation", transport_mode: "car", notes: "Bear Lake at sunrise." }] },
  { catalogName: "Great Smoky Mountains National Park", visits: [{ visit_date: "2022-10-15", end_date: "2022-10-18", occasion: "road-trip", transport_mode: "car" }] },

  // --- Cities on their own ------------------------------------------------
  { query: "Denver, Colorado", placeType: "city", visits: [{ visit_date: "2023-09-01", occasion: "road-trip", transport_mode: "flight" }] },
  { query: "Nashville, Tennessee", placeType: "city", visits: [{ visit_date: "2022-10-13", end_date: "2022-10-15", occasion: "concert", transport_mode: "car" }] },
  { query: "Minneapolis, Minnesota", placeType: "city", visits: [{ visit_date: "2025-07-04", end_date: "2025-07-06", occasion: "family", transport_mode: "car" }] },
  { query: "Austin, Texas", placeType: "city", visits: [{ visit_date: "2024-03-08", end_date: "2024-03-12", occasion: "work", transport_mode: "flight" }] },
  { query: "Asheville, North Carolina", placeType: "city", visits: [{ visit_date: "2022-10-18", end_date: "2022-10-20", occasion: "road-trip", transport_mode: "car" }] },
  { query: "Willis Tower, Chicago", name: "Willis Tower", placeType: "landmark", visits: [{ visit_date: "2023-07-15", occasion: "weekend", transport_mode: "walk" }] },
];

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

interface Planned {
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

async function plan(client: PlacesClient): Promise<Planned[]> {
  const out: Planned[] = [];
  for (const seed of SEED) {
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

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (USER_ID === DEMO_USER_ID) throw new Error("refusing to seed the demo account");

  const client = adminClient();

  const { data: occasionRows, error: occErr } = await client.from("occasions").select("id,slug");
  if (occErr) throw new Error(`occasions: ${occErr.message}`);
  const occasionId = new Map((occasionRows ?? []).map((o) => [o.slug as string, o.id as string]));

  console.log(`resolving ${SEED.length} places`);
  const planned = await plan(client);

  if (dryRun) {
    console.log("\n--dry-run: nothing written\n");
    for (const p of planned) {
      const where = [p.locality_name, p.admin_region, p.country_code].filter(Boolean).join(", ");
      console.log(
        `  ${p.name.padEnd(38)} ${p.place_type.padEnd(9)} ${p.catalog_item_id ? "catalog" : "photon "} ` +
          `${p.visits.length} visit${p.visits.length === 1 ? " " : "s"}  ${where || "(no locality)"}`,
      );
    }
    return;
  }

  let created = 0;
  let deduped = 0;
  let visitsAdded = 0;

  for (const p of planned) {
    // The SAME decision the server action makes. Re-read each time so places
    // created earlier in this run are candidates for later ones.
    const { data: existingRows, error: exErr } = await client
      .from("places")
      .select("id,name,locality_name,catalog_item_id")
      .eq("user_id", USER_ID)
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
          user_id: USER_ID,
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
      .eq("user_id", USER_ID)
      .eq("place_id", placeId);
    const seen = new Set((haveVisits ?? []).map((v) => v.visit_date as string));

    for (const v of p.visits) {
      if (seen.has(v.visit_date)) continue;
      const { error } = await client.from("place_visits").insert({
        place_id: placeId,
        user_id: USER_ID,
        visit_date: v.visit_date,
        end_date: v.end_date ?? null,
        occasion_id: v.occasion ? (occasionId.get(v.occasion) ?? null) : null,
        occasion_label: null,
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

  console.log(`\nplaces created:        ${created}`);
  console.log(`folded into existing:  ${deduped}`);
  console.log(`visits added:          ${visitsAdded}`);

  const { count: places } = await client
    .from("places")
    .select("id", { count: "exact", head: true })
    .eq("user_id", USER_ID);
  const { count: visits } = await client
    .from("place_visits")
    .select("id", { count: "exact", head: true })
    .eq("user_id", USER_ID);
  console.log(`\naccount now holds ${places ?? 0} places and ${visits ?? 0} visits`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

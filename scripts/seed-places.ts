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

import { adminClient } from "./places-db";
import {
  occasionIds,
  planSeeds,
  printPlan,
  writeSeeds,
  type PlaceSeed,
} from "./places-seed-core";

// Carson's account. The demo user is never written to; see CLAUDE.md.
// Typed as string rather than left as literals so the guard in main() is a real
// runtime check: with literal types TypeScript proves the comparison can never
// be true and rejects it, which would mean deleting the guard that matters if
// this id is ever edited.
const USER_ID: string = "1ca08f60-c0eb-4fae-8297-1a2c73fb9cfc";
const DEMO_USER_ID: string = "703fbe07-db8a-41bd-bdee-928c2fa88107";

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

// --- Write ------------------------------------------------------------------

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (USER_ID === DEMO_USER_ID) throw new Error("refusing to seed the demo account");

  const client = adminClient();
  const occasionId = await occasionIds(client);

  console.log(`resolving ${SEED.length} places`);
  const planned = await planSeeds(client, SEED);

  if (dryRun) {
    console.log("\n--dry-run: nothing written\n");
    printPlan(planned);
    return;
  }

  const { created, deduped, visitsAdded } = await writeSeeds(
    client,
    USER_ID,
    planned,
    occasionId,
  );

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

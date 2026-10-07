// Seed the DEMO account's places, so /demo, /share/demo and a signed-in demo
// session have something true to show on the tiles, the strip, the globe
// pins, the places-only hatch, and the stats page's Places section.
//
// Run with: npm run seed-demo-places          (add --dry-run to see the plan)
//
// Writes to the demo account ONLY. The id is checked twice: against the
// constant, and against user_settings.is_demo in the database, so an edited id
// cannot quietly turn this into a write to a real account.
//
// Uses the same engine as seed-places.ts (places-seed-core.ts): coordinates
// come from the catalog row or from Photon at seed time, never from this file,
// and every place goes through findDuplicate from lib/place-dedup.ts, so a
// re-run is a no-op.
//
// The persona's eleven trips are all outside the US, so these are the US side
// of the same traveller: dated into the gaps between those trips and all in
// the past, so every one counts to date. Place names are places, never events.
// Occasion labels are generic ("Homecoming weekend"), never a person's name:
// this is a public profile. No notes, for the same reason.

import { adminClient } from "./places-db";
import {
  occasionIds,
  planSeeds,
  printPlan,
  writeSeeds,
  type PlaceSeed,
} from "./places-seed-core";

const DEMO_USER_ID: string = "703fbe07-db8a-41bd-bdee-928c2fa88107";

// Eight states (IL, MA, NY, CA, AZ, UT, MI, TX), five tracked venues across
// three leagues, three national parks, a campus, and the cities around them,
// so the rings, the states map, and the grouped list all have something to
// draw. Wrigley carries two visits so a repeat shows up somewhere.
const SEED: PlaceSeed[] = [
  // --- Boston, June 2022 ----------------------------------------------------
  { query: "Boston, Massachusetts", placeType: "city", visits: [{ visit_date: "2022-06-16", end_date: "2022-06-20", occasion: "vacation", transport_mode: "flight" }] },
  { catalogName: "Fenway Park", visits: [{ visit_date: "2022-06-18", occasion: "game", event_org: "Boston Red Sox", transport_mode: "train" }] },

  // --- Chicago, July 2023 and June 2024 -------------------------------------
  { query: "Chicago, Illinois", placeType: "city", visits: [{ visit_date: "2023-07-14", end_date: "2023-07-16", occasion: "weekend", transport_mode: "flight" }] },
  {
    catalogName: "Wrigley Field",
    visits: [
      { visit_date: "2023-07-15", occasion: "game", event_org: "Chicago Cubs", transport_mode: "train" },
      { visit_date: "2024-06-08", occasion: "game", event_org: "Chicago Cubs", transport_mode: "train" },
    ],
  },

  // --- California road trip, August 2023 ------------------------------------
  { query: "San Francisco, California", placeType: "city", visits: [{ visit_date: "2023-08-15", end_date: "2023-08-17", occasion: "road-trip", transport_mode: "flight" }] },
  { catalogName: "Oracle Park", visits: [{ visit_date: "2023-08-16", occasion: "game", event_org: "San Francisco Giants", transport_mode: "walk" }] },
  { catalogName: "Yosemite National Park", visits: [{ visit_date: "2023-08-18", end_date: "2023-08-21", occasion: "road-trip", transport_mode: "car" }] },

  // --- Ann Arbor, October 2024 ----------------------------------------------
  { query: "Ann Arbor, Michigan", placeType: "city", visits: [{ visit_date: "2024-10-11", end_date: "2024-10-13", occasion: "family", occasion_label: "Homecoming weekend", transport_mode: "car" }] },
  { query: "University of Michigan, Ann Arbor", placeType: "campus", visits: [{ visit_date: "2024-10-12", occasion: "family", occasion_label: "Homecoming weekend", transport_mode: "walk" }] },
  { catalogName: "Michigan Stadium", visits: [{ visit_date: "2024-10-12", occasion: "game", event_org: "Michigan Wolverines", transport_mode: "walk" }] },

  // --- New York, December 2024 ----------------------------------------------
  { query: "New York, New York", placeType: "city", visits: [{ visit_date: "2024-12-06", end_date: "2024-12-09", occasion: "weekend", transport_mode: "flight" }] },
  { catalogName: "Madison Square Garden", visits: [{ visit_date: "2024-12-07", occasion: "concert", transport_mode: "train" }] },

  // --- Austin, March 2025 ---------------------------------------------------
  { query: "Austin, Texas", placeType: "city", visits: [{ visit_date: "2025-03-10", end_date: "2025-03-14", occasion: "work", transport_mode: "flight" }] },

  // --- Southwest parks, May 2025 --------------------------------------------
  { catalogName: "Grand Canyon National Park", visits: [{ visit_date: "2025-05-24", end_date: "2025-05-26", occasion: "vacation", transport_mode: "car" }] },
  { catalogName: "Zion National Park", visits: [{ visit_date: "2025-05-27", end_date: "2025-05-29", occasion: "vacation", transport_mode: "car" }] },
];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const client = adminClient();

  // The second key on the lock: the database must agree this is the demo.
  const { data: settings, error: settingsError } = await client
    .from("user_settings")
    .select("is_demo")
    .eq("user_id", DEMO_USER_ID)
    .maybeSingle();
  if (settingsError) throw new Error(`user_settings: ${settingsError.message}`);
  if (settings?.is_demo !== true) {
    throw new Error(`refusing: ${DEMO_USER_ID} is not flagged is_demo in user_settings`);
  }

  // The seed itself must not date a visit after today: every demo place is
  // meant to count, and a future visit would vanish from every public surface.
  const today = new Date().toISOString().slice(0, 10);
  const future = SEED.flatMap((s) => s.visits).filter((v) => v.visit_date > today);
  if (future.length > 0) {
    throw new Error(`refusing: ${future.length} seeded visit(s) dated after ${today}`);
  }

  const occasionId = await occasionIds(client);
  console.log(`resolving ${SEED.length} places for the demo account`);
  const planned = await planSeeds(client, SEED);

  if (dryRun) {
    console.log("\n--dry-run: nothing written\n");
    printPlan(planned);
    return;
  }

  const { created, deduped, visitsAdded } = await writeSeeds(
    client,
    DEMO_USER_ID,
    planned,
    occasionId,
  );
  console.log(`\nplaces created:        ${created}`);
  console.log(`folded into existing:  ${deduped}`);
  console.log(`visits added:          ${visitsAdded}`);

  const [{ count: places }, { count: visits }] = await Promise.all([
    client.from("places").select("id", { count: "exact", head: true }).eq("user_id", DEMO_USER_ID),
    client.from("place_visits").select("id", { count: "exact", head: true }).eq("user_id", DEMO_USER_ID),
  ]);
  console.log(`\ndemo account now holds ${places ?? 0} places and ${visits ?? 0} visits`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

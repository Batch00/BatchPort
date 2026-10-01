// Asserts the Places stats section's model (src/lib/places-stats.ts).
//
// Run with: npm run check-places-stats
//
// Pure: no database, no dev server. The fixtures are the owner's real rows as
// of 2026-09-30 (twelve places, four started catalogs, seven occasions), plus
// the edge cases the section must survive: ties, nothing started, no
// occasion, string-typed numerics.

import assert from "node:assert/strict";

import {
  occasionBars,
  occasionInsight,
  splitCatalogs,
  typeTiles,
  yearlyPlaces,
  yearlyPlacesInsight,
  type CatalogProgressRow,
  type OccasionRow,
} from "../src/lib/places-stats";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

const cat = (
  slug: string,
  sort: number,
  visited: number,
  total: number,
): CatalogProgressRow => ({
  catalog_id: slug,
  catalog_slug: slug,
  label: slug,
  denominator_note: null,
  sort_order: sort,
  total,
  visited,
});

const REAL_CATALOGS = [
  cat("nba", 4, 0, 30),
  cat("nfl", 3, 1, 30),
  cat("ncaa_fbs_football", 6, 2, 136),
  cat("ncaa_basketball_arenas", 7, 0, 374),
  cat("national_parks", 1, 1, 63),
  cat("nhl", 5, 0, 32),
  cat("mlb", 2, 1, 30),
];

const REAL_ITEMS = [
  { catalog_id: "national_parks", name: "Yosemite National Park", first_visit_date: "2024-09-06", place_id: "a" },
  { catalog_id: "ncaa_fbs_football", name: "Bryant-Denny Stadium", first_visit_date: "2025-09-13", place_id: "b" },
  { catalog_id: "nfl", name: "Lambeau Field", first_visit_date: "2025-01-05", place_id: "c" },
  { catalog_id: "ncaa_fbs_football", name: "Neyland Stadium", first_visit_date: "2024-10-19", place_id: "d" },
  { catalog_id: "mlb", name: "American Family Field", first_visit_date: "2026-08-29", place_id: "e" },
];

const occ = (
  id: string | null,
  label: string | null,
  sort: number | null,
  visits: number,
): OccasionRow => ({
  occasion_id: id,
  slug: id,
  label,
  color: id ? "#000000" : null,
  sort_order: sort,
  visits,
  places: visits,
  states: 1,
});

const REAL_OCCASIONS = [
  occ("wedding", "Wedding", 6, 1),
  occ("weekend", "Weekend", 4, 3),
  occ("tournament", "Tournament", 9, 1),
  occ("other", "Other", 99, 1),
  occ("bachelor-party", "Bachelor party", 10, 1),
  occ("concert", "Concert", 2, 1),
  occ("game", "Game", 1, 5),
];

console.log("check-places-stats");

check("catalogs: the four started get rings, in catalog order", () => {
  const { started, notStarted } = splitCatalogs(REAL_CATALOGS, REAL_ITEMS);
  assert.deepEqual(started.map((c) => c.slug), ["national_parks", "mlb", "nfl", "ncaa_fbs_football"]);
  assert.deepEqual(notStarted.map((c) => c.id), ["nba", "nhl", "ncaa_basketball_arenas"]);
});

check("catalogs: a sliver is drawn as the true fraction, not rounded up", () => {
  const { started } = splitCatalogs(REAL_CATALOGS, REAL_ITEMS);
  const parks = started.find((c) => c.slug === "national_parks")!;
  assert.equal(parks.fraction, 1 / 63);
});

check("catalogs: every visited item is named, earliest first", () => {
  const { started } = splitCatalogs(REAL_CATALOGS, REAL_ITEMS);
  const fbs = started.find((c) => c.slug === "ncaa_fbs_football")!;
  assert.deepEqual(fbs.items.map((i) => i.name), ["Neyland Stadium", "Bryant-Denny Stadium"]);
});

check("catalogs: nothing started puts all seven in the compact list", () => {
  const { started, notStarted } = splitCatalogs(
    REAL_CATALOGS.map((c) => ({ ...c, visited: 0 })),
    [],
  );
  assert.equal(started.length, 0);
  assert.equal(notStarted.length, 7);
});

check("catalogs: string-typed numerics from PostgREST still count", () => {
  const row = { ...cat("mlb", 2, 0, 0), visited: "1", total: "30" } as unknown as CatalogProgressRow;
  const { started } = splitCatalogs([row], []);
  assert.equal(started[0].fraction, 1 / 30);
});

check("tiles: five types always, zero landmarks included, other when nonzero", () => {
  const counts = {
    total_places: 12, localities: 10, cities: 4, campuses: 1,
    stadiums: 4, parks: 2, landmarks: 0, others: 1,
  };
  const tiles = typeTiles(counts);
  assert.deepEqual(tiles.map((t) => t.key), ["city", "campus", "stadium", "park", "landmark", "other"]);
  assert.equal(tiles.reduce((s, t) => s + t.count, 0), counts.total_places);
  assert.equal(typeTiles({ ...counts, others: 0 }).length, 5);
});

check("occasions: most visits first, ties in picker order", () => {
  const bars = occasionBars(REAL_OCCASIONS);
  assert.deepEqual(bars.map((b) => b.label), [
    "Game", "Weekend", "Concert", "Wedding", "Tournament", "Bachelor party", "Other",
  ]);
});

check("occasions: no-occasion is its own bar, last in its tie", () => {
  const bars = occasionBars([occ(null, null, null, 1), occ("other", "Other", 99, 1)]);
  assert.deepEqual(bars.map((b) => b.label), ["Other", "No occasion"]);
});

check("occasions: caption names a strict leader against the visit total", () => {
  assert.equal(occasionInsight(occasionBars(REAL_OCCASIONS)), "Game leads with 5 of 13 visits");
});

check("occasions: no caption on a tie or a single bar", () => {
  assert.equal(occasionInsight(occasionBars([occ("a", "A", 1, 2), occ("b", "B", 2, 2)])), undefined);
  assert.equal(occasionInsight(occasionBars([occ("a", "A", 1, 2)])), undefined);
});

check("years: real rows, chronological, strict winner captioned", () => {
  const rows = yearlyPlaces([
    { year: 2026, visits: 5, places: 5, new_places: 4, new_states: 2 },
    { year: 2024, visits: 3, places: 3, new_places: 3, new_states: 2 },
    { year: 2025, visits: 5, places: 5, new_places: 5, new_states: 4 },
  ]);
  assert.deepEqual(rows.map((r) => r.year), [2024, 2025, 2026]);
  assert.equal(yearlyPlacesInsight(rows), "2025 added the most: 5 new places");
});

check("years: no caption on a tie or a single year", () => {
  const tie = yearlyPlaces([
    { year: 2024, visits: 2, places: 2, new_places: 2, new_states: 0 },
    { year: 2025, visits: 2, places: 2, new_places: 2, new_states: 0 },
  ]);
  assert.equal(yearlyPlacesInsight(tie), undefined);
  assert.equal(yearlyPlacesInsight(tie.slice(0, 1)), undefined);
});

console.log(`check-places-stats: ${passed} passed`);

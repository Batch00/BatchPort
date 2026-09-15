// Assert the /places grouping rule.
//
// Run with: npm run check-place-groups
//
// Pure: no database, no dev server, no network. The fixture leads with the three
// places actually logged during phase 1, because those are what the rule was
// written against and what the first review looked at.

import {
  buildPlaceList,
  countPlaces,
  DEFAULT_PLACE_FILTERS,
  localityLabel,
  type PlaceListEntry,
} from "../src/lib/place-groups";
import type { PlaceListRow } from "../src/lib/types";

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ""}`);
  }
}

function place(p: Partial<PlaceListRow> & { id: string; name: string }): PlaceListRow {
  return {
    user_id: "u",
    place_type: "stadium",
    lat: 0,
    lng: 0,
    country_code: "US",
    admin_region: "Wisconsin",
    locality_name: null,
    locality_key: null,
    catalog_item_id: null,
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    visit_count: 1,
    first_visit_date: null,
    latest_visit_date: null,
    first_occasion_slug: null,
    first_occasion_label: null,
    first_occasion_icon: null,
    first_occasion_color: null,
    ...p,
  } as PlaceListRow;
}

const GB = "green bay|wisconsin|US";
const MKE = "milwaukee|wisconsin|US";

// The three real rows.
const lambeau = place({
  id: "lambeau", name: "Lambeau Field", locality_name: "Green Bay", locality_key: GB,
  catalog_item_id: "c1", first_visit_date: "2026-09-06", latest_visit_date: "2026-09-06",
  first_occasion_slug: "game", first_occasion_label: "Game",
});
const greenBay = place({
  id: "greenbay", name: "Green Bay", place_type: "city", locality_name: "Green Bay",
  locality_key: GB, first_visit_date: "2026-09-06", latest_visit_date: "2026-09-06",
});
const amFam = place({
  id: "amfam", name: "American Family Field", locality_name: "Milwaukee", locality_key: MKE,
  catalog_item_id: "c2", first_visit_date: "2026-08-29", latest_visit_date: "2026-08-29",
  first_occasion_slug: "game", first_occasion_label: "Game",
});

const shape = (entries: PlaceListEntry[]) =>
  entries
    .map((e) => (e.kind === "group" ? `[${e.label}: ${e.places.map((p) => p.name).join(", ")}]` : e.place.name))
    .join(" | ");

console.log("\nthe three real rows");
{
  const out = buildPlaceList([lambeau, greenBay, amFam]);
  check(
    "Green Bay groups, American Family Field is bare",
    // Same first_visit_date, so the within-group tiebreak is alphabetical.
    shape(out) === "[Green Bay, Wisconsin: Green Bay, Lambeau Field] | American Family Field",
    shape(out),
  );
  check("one flat sequence, two entries", out.length === 2);
  check("three places across it", countPlaces(out) === 3);
  check("group first, by date desc", out[0].kind === "group");
}

console.log("\nthe rule");
{
  // A locality with one place is a bare row, not a group of one.
  const out = buildPlaceList([amFam, lambeau]);
  check("a lone locality does not get a header", out.every((e) => e.kind === "place"), shape(out));
}
{
  // Null locality never groups with another null locality.
  const a = place({ id: "a", name: "A", first_visit_date: "2026-05-01" });
  const b = place({ id: "b", name: "B", first_visit_date: "2026-04-01" });
  const out = buildPlaceList([a, b]);
  check("two null-locality places are two bare rows", out.length === 2 && out.every((e) => e.kind === "place"), shape(out));
}
{
  // A group sorts on its EARLIEST first visit, so a new venue in an old city
  // does not jump the city to the top.
  const old1 = place({ id: "o1", name: "Old One", locality_name: "Oldtown", locality_key: "oldtown||US", first_visit_date: "2019-01-01" });
  const old2 = place({ id: "o2", name: "Old Two", locality_name: "Oldtown", locality_key: "oldtown||US", first_visit_date: "2026-12-01" });
  const recent = place({ id: "r", name: "Recent", first_visit_date: "2026-06-01" });
  const out = buildPlaceList([old1, old2, recent]);
  check("group sorts on earliest, not latest", out[0].kind === "place" && out[0].place.name === "Recent", shape(out));
}
{
  // Zero-visit places sort last rather than first.
  const none = place({ id: "n", name: "No Visits", visit_count: 0, first_visit_date: null });
  const out = buildPlaceList([none, amFam]);
  check("a zero-visit place sorts last", out[out.length - 1].kind === "place" && (out[out.length - 1] as { place: PlaceListRow }).place.id === "n", shape(out));
}

console.log("\nfilters, applied before grouping");
{
  const out = buildPlaceList([lambeau, greenBay, amFam], { ...DEFAULT_PLACE_FILTERS, placeType: "city" });
  check("filtering a group to one leaves a bare row", shape(out) === "Green Bay", shape(out));
}
{
  const out = buildPlaceList([lambeau, greenBay, amFam], { ...DEFAULT_PLACE_FILTERS, occasion: "game" });
  check("occasion filter matches the FIRST visit", shape(out) === "Lambeau Field | American Family Field", shape(out));
}
{
  const out = buildPlaceList([lambeau, greenBay, amFam], { ...DEFAULT_PLACE_FILTERS, placeType: "park" });
  check("a filter matching nothing yields nothing", out.length === 0);
}

console.log("\nsort by name");
{
  const out = buildPlaceList([lambeau, greenBay, amFam], DEFAULT_PLACE_FILTERS, "name");
  check(
    "groups sort by locality label, bare rows by name",
    shape(out) === "American Family Field | [Green Bay, Wisconsin: Green Bay, Lambeau Field]",
    shape(out),
  );
}

console.log("\nlabels");
{
  check("locality label joins city and region", localityLabel(lambeau) === "Green Bay, Wisconsin");
  const noRegion = place({ id: "x", name: "X", locality_name: "Solo", admin_region: null, locality_key: "solo||US" });
  check("a missing region does not leave a trailing comma", localityLabel(noRegion) === "Solo");
}

console.log(`\n${failures === 0 ? "check-place-groups: all passed" : `check-place-groups: ${failures} FAILED`}`);
if (failures) process.exit(1);

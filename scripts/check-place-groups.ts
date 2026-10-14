// Assert the /places grouping rule.
//
// Run with: npm run check-place-groups
//
// Pure: no database, no dev server, no network. The fixture leads with the three
// places actually logged during phase 1, because those are what the rule was
// written against and what the first review looked at.

import { findDuplicate, type DuplicateCandidate } from "../src/lib/place-dedup";
import {
  buildPlaceList,
  countPlaces,
  DEFAULT_PLACE_FILTERS,
  DEFAULT_PLACE_SORT,
  isUpcomingOnly,
  localityLabel,
  rowDate,
  shortLocalityLabel,
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
    latest_visit_to_date: null,
    latest_visit_to_date_occasion_id: null,
    visit_count_to_date: 0,
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
  const out = buildPlaceList([lambeau, greenBay, amFam], DEFAULT_PLACE_FILTERS, "first-visit");
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
  const out = buildPlaceList([amFam, lambeau], DEFAULT_PLACE_FILTERS, "first-visit");
  check("a lone locality does not get a header", out.every((e) => e.kind === "place"), shape(out));
}
{
  // Null locality never groups with another null locality.
  const a = place({ id: "a", name: "A", first_visit_date: "2026-05-01" });
  const b = place({ id: "b", name: "B", first_visit_date: "2026-04-01" });
  const out = buildPlaceList([a, b], DEFAULT_PLACE_FILTERS, "first-visit");
  check("two null-locality places are two bare rows", out.length === 2 && out.every((e) => e.kind === "place"), shape(out));
}
{
  // A group sorts on its EARLIEST first visit, so a new venue in an old city
  // does not jump the city to the top.
  const old1 = place({ id: "o1", name: "Old One", locality_name: "Oldtown", locality_key: "oldtown||US", first_visit_date: "2019-01-01" });
  const old2 = place({ id: "o2", name: "Old Two", locality_name: "Oldtown", locality_key: "oldtown||US", first_visit_date: "2026-12-01" });
  const recent = place({ id: "r", name: "Recent", first_visit_date: "2026-06-01" });
  const out = buildPlaceList([old1, old2, recent], DEFAULT_PLACE_FILTERS, "first-visit");
  check("group sorts on earliest, not latest", out[0].kind === "place" && out[0].place.name === "Recent", shape(out));
}
{
  // Zero-visit places sort last rather than first.
  const none = place({ id: "n", name: "No Visits", visit_count: 0, first_visit_date: null });
  const out = buildPlaceList([none, amFam], DEFAULT_PLACE_FILTERS, "first-visit");
  check("a zero-visit place sorts last", out[out.length - 1].kind === "place" && (out[out.length - 1] as { place: PlaceListRow }).place.id === "n", shape(out));
}

console.log("\nfilters, applied before grouping");
{
  const out = buildPlaceList([lambeau, greenBay, amFam], { ...DEFAULT_PLACE_FILTERS, placeType: "city" }, "first-visit");
  check("filtering a group to one leaves a bare row", shape(out) === "Green Bay", shape(out));
}
{
  const out = buildPlaceList([lambeau, greenBay, amFam], { ...DEFAULT_PLACE_FILTERS, occasion: "game" }, "first-visit");
  check("occasion filter matches the FIRST visit", shape(out) === "Lambeau Field | American Family Field", shape(out));
}
{
  const out = buildPlaceList([lambeau, greenBay, amFam], { ...DEFAULT_PLACE_FILTERS, placeType: "park" }, "first-visit");
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

console.log("\nmost recent, the default sort");
{
  check("Most recent is the default", DEFAULT_PLACE_SORT === "recent");

  // American Family Field with three visits: two in the past and one booked
  // for after today. Its recent date is the latest visit TO DATE, never the
  // future one, and its first-visit date is still the first.
  const amFam3 = place({
    id: "amfam3", name: "American Family Field", locality_name: "Milwaukee", locality_key: MKE,
    catalog_item_id: "c2", visit_count: 3,
    first_visit_date: "2025-05-10", latest_visit_date: "2026-11-02",
    latest_visit_to_date: "2026-08-29",
    first_occasion_slug: "game", first_occasion_label: "Game",
  });
  check("three visits: Most recent shows the latest visit to date",
    rowDate(amFam3, "recent").date === "2026-08-29" && !rowDate(amFam3, "recent").upcoming,
    JSON.stringify(rowDate(amFam3, "recent")));
  check("three visits: First visit still shows the first visit",
    rowDate(amFam3, "first-visit").date === "2025-05-10",
    JSON.stringify(rowDate(amFam3, "first-visit")));
  check("past AND future visits is not upcoming", !isUpcomingOnly(amFam3));

  // A place whose only visit is after today.
  const booked = place({
    id: "booked", name: "Soldier Field", locality_name: "Chicago", locality_key: "chicago|illinois|US",
    visit_count: 1, first_visit_date: "2026-12-06", latest_visit_date: "2026-12-06",
    latest_visit_to_date: null,
  });
  check("a future-only place is upcoming", isUpcomingOnly(booked));
  check("it shows its date as Upcoming under Most recent",
    rowDate(booked, "recent").upcoming && rowDate(booked, "recent").date === "2026-12-06");
  check("and under First visit", rowDate(booked, "first-visit").upcoming);

  const lambeauR = { ...lambeau, latest_visit_to_date: "2026-09-06" };
  const greenBayR = { ...greenBay, latest_visit_to_date: "2026-09-06" };
  const none = place({ id: "none", name: "No Visits", visit_count: 0 });
  const out = buildPlaceList([amFam3, none, lambeauR, booked, greenBayR]);
  check(
    "upcoming on top, then latest to date, then no visits",
    shape(out) === "Soldier Field | [Green Bay, Wisconsin: Green Bay, Lambeau Field] | American Family Field | No Visits",
    shape(out),
  );

  // Two upcoming places: the sooner one first.
  const sooner = { ...booked, id: "sooner", name: "Sooner", locality_key: null, first_visit_date: "2026-10-20" };
  const upOut = buildPlaceList([booked, sooner]);
  check("two upcoming places: soonest first", shape(upOut) === "Sooner | Soldier Field", shape(upOut));
}
{
  // A group sorts on its MOST RECENTLY visited member under Most recent, and
  // still on its EARLIEST under First visit. Oldtown was first visited in 2019
  // and revisited last month; Recent was first and last visited in June.
  const old1 = place({ id: "o1", name: "Old One", locality_name: "Oldtown", locality_key: "oldtown||US",
    first_visit_date: "2019-01-01", latest_visit_to_date: "2026-09-20" });
  const old2 = place({ id: "o2", name: "Old Two", locality_name: "Oldtown", locality_key: "oldtown||US",
    first_visit_date: "2020-01-01", latest_visit_to_date: "2020-01-01" });
  const recent = place({ id: "r", name: "Recent", first_visit_date: "2026-06-01", latest_visit_to_date: "2026-06-01" });
  const byRecent = buildPlaceList([old1, old2, recent], DEFAULT_PLACE_FILTERS, "recent");
  check("Most recent: a revisited group rises above a newer bare row",
    byRecent[0].kind === "group", shape(byRecent));
  check("Most recent: members ordered by their own latest visit",
    byRecent[0].kind === "group" && byRecent[0].places.map((p) => p.id).join(",") === "o1,o2", shape(byRecent));
  const byFirst = buildPlaceList([old1, old2, recent], DEFAULT_PLACE_FILTERS, "first-visit");
  check("First visit: the same group stays below, on its earliest member",
    byFirst[0].kind === "place", shape(byFirst));
}
{
  // An upcoming member does not lift its group: it has not been visited.
  const visited = place({ id: "v", name: "Visited", locality_name: "Town", locality_key: "town||US",
    visit_count: 1, first_visit_date: "2024-01-01", latest_visit_to_date: "2024-01-01" });
  const future = place({ id: "f", name: "Future", locality_name: "Town", locality_key: "town||US",
    visit_count: 1, first_visit_date: "2026-12-01", latest_visit_to_date: null });
  const middle = place({ id: "m", name: "Middle", first_visit_date: "2025-06-01", latest_visit_to_date: "2025-06-01" });
  const out = buildPlaceList([visited, future, middle], DEFAULT_PLACE_FILTERS, "recent");
  check("an upcoming member does not lift its group", out[0].kind === "place" && out[0].place.id === "m", shape(out));
  check("inside the group, the upcoming member still leads",
    out[1].kind === "group" && out[1].places[0].id === "f", shape(out));
}

console.log("\nlabels");
{
  check("locality label joins city and region", localityLabel(lambeau) === "Green Bay, Wisconsin");
  const noRegion = place({ id: "x", name: "X", locality_name: "Solo", admin_region: null, locality_key: "solo||US" });
  check("a missing region does not leave a trailing comma", localityLabel(noRegion) === "Solo");
}

// The SHORT label is what a BARE ROW puts on its metadata line, beside a date
// and an occasion. It exists because a bare row sitting under a group was
// reading as a member of that group, with only an indent to say otherwise.
console.log("\nshort locality label, for bare rows");
{
  check(
    "abbreviates the state, from the sourced Census postal codes",
    shortLocalityLabel(amFam) === "Milwaukee, WI",
    shortLocalityLabel(amFam),
  );
  check(
    "a city does not repeat its own name, but keeps the region",
    shortLocalityLabel(greenBay) === "WI",
    shortLocalityLabel(greenBay),
  );
  const park = place({
    id: "p",
    name: "Rocky Mountain National Park",
    place_type: "park",
    locality_name: null,
    admin_region: "Colorado",
    locality_key: null,
  });
  check(
    "no locality adds nothing at all, which is right for a park",
    shortLocalityLabel(park) === "",
    JSON.stringify(shortLocalityLabel(park)),
  );
  const canadian = place({
    id: "c",
    name: "Rogers Centre",
    locality_name: "Toronto",
    admin_region: "Ontario",
    locality_key: "toronto|ontario|CA",
  });
  check(
    "a province with no postal code falls back to its full name",
    shortLocalityLabel(canadian) === "Toronto, Ontario",
    shortLocalityLabel(canadian),
  );
  const noShortRegion = place({
    id: "n",
    name: "Somewhere",
    locality_name: "Tiny Town",
    admin_region: null,
    locality_key: "tiny town||US",
  });
  check(
    "a missing region does not leave a trailing comma",
    shortLocalityLabel(noShortRegion) === "Tiny Town",
    shortLocalityLabel(noShortRegion),
  );
}

// --- the dedup rule ---------------------------------------------------------
//
// ONE VENUE IS ONE PIN, and the null cases are the ones that bite. Two places
// that each have NO catalog item are not thereby the same building. That is the
// SQL `partition by catalog_item_id` mistake transplanted into TypeScript
// (PARTITION BY groups NULLs together, unlike `=`), and it would make every
// geocoded place a duplicate of every other one, with only the name check
// standing in the way.

console.log("\ndedup: null catalog items");
{
  const candidates: DuplicateCandidate[] = [
    { id: "a", name: "Green Bay", locality_name: "Green Bay", catalog_item_id: null },
    { id: "b", name: "Madison", locality_name: "Madison", catalog_item_id: null },
    { id: "c", name: "Lambeau Field", locality_name: "Green Bay", catalog_item_id: "cat-1" },
  ];
  check(
    "two null catalog items with different names do not match",
    findDuplicate(candidates, {
      name: "Appleton",
      locality_name: "Appleton",
      catalog_item_id: null,
    }) === null,
  );
  check(
    "a null catalog item matches on name plus locality, case-insensitively",
    findDuplicate(candidates, {
      name: "green bay",
      locality_name: "GREEN BAY",
      catalog_item_id: null,
    }) === "a",
  );
  check(
    "the same name in a different locality does not match",
    findDuplicate(candidates, {
      name: "Madison",
      locality_name: "Madison, Indiana",
      catalog_item_id: null,
    }) === null,
  );
  check(
    "no locality never matches, even with an identical name",
    findDuplicate([{ id: "z", name: "Home", locality_name: null, catalog_item_id: null }], {
      name: "Home",
      locality_name: null,
      catalog_item_id: null,
    }) === null,
  );
  check(
    "a null-catalog input never absorbs into a catalog row",
    findDuplicate(candidates, {
      name: "Lambeau Field",
      locality_name: "Green Bay",
      catalog_item_id: null,
    }) === null,
  );
}

console.log("\ndedup: catalog items");
{
  const candidates: DuplicateCandidate[] = [
    { id: "a", name: "American Family Field", locality_name: "Milwaukee", catalog_item_id: "cat-1" },
    { id: "b", name: "Green Bay", locality_name: "Green Bay", catalog_item_id: null },
  ];
  check(
    "the same catalog item matches whatever the name says",
    findDuplicate(candidates, {
      name: "Miller Park",
      locality_name: "Milwaukee",
      catalog_item_id: "cat-1",
    }) === "a",
  );
  check(
    "a different catalog item does not match",
    findDuplicate(candidates, {
      name: "American Family Field",
      locality_name: "Milwaukee",
      catalog_item_id: "cat-2",
    }) === null,
  );
  check(
    "a catalog input never falls back to the name rule",
    findDuplicate(candidates, {
      name: "Green Bay",
      locality_name: "Green Bay",
      catalog_item_id: "cat-9",
    }) === null,
  );
  check(
    "candidate order decides which duplicate wins, so callers order oldest first",
    findDuplicate(
      [
        { id: "older", name: "X", locality_name: "Y", catalog_item_id: "cat-1" },
        { id: "newer", name: "X", locality_name: "Y", catalog_item_id: "cat-1" },
      ],
      { name: "X", locality_name: "Y", catalog_item_id: "cat-1" },
    ) === "older",
  );
}

console.log(`\n${failures === 0 ? "check-place-groups: all passed" : `check-place-groups: ${failures} FAILED`}`);
if (failures) process.exit(1);

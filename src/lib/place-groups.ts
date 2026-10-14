import type { PlaceListRow, PlaceType } from "@/lib/types";
import { US_STATE_POSTAL } from "@/lib/us-state-postal";

// How the /places list is shaped. Pure and client-safe, so the filter controls
// and the server render agree by construction rather than by both being careful.
//
// THE RULE, and everything here follows from it: the list is ONE flat sequence.
// A locality with two or more places gets a header and its places underneath; a
// locality with one place, and a place with no locality at all, is a bare row in
// that same sequence. There is no separate "ungrouped" section and no special
// case for a stadium or a park that has no city, because those are the normal
// case rather than the exception: Lambeau Field and Green Bay group under Green
// Bay, American Family Field sits on its own line, and both are the same
// component doing the same thing.
//
// Grouping is on locality_key, the generated
// lower(locality_name)|admin_region|country_code. That is why country_code is
// NOT NULL on the catalog: a venue keyed "green bay|wisconsin|" would not group
// with the city keyed "green bay|wisconsin|US", and the two groups would look
// identical on screen.

/**
 * "recent" is the default (decided 2026-10-13): the place most recently
 * visited TO DATE first. "first-visit" is the original order, "name" is A to Z.
 */
export type PlaceSort = "recent" | "first-visit" | "name";

export const DEFAULT_PLACE_SORT: PlaceSort = "recent";

export const PLACE_SORT_LABELS: Record<PlaceSort, string> = {
  recent: "Most recent",
  "first-visit": "First visit",
  name: "Name",
};

/**
 * A place whose every visit is still in the future: it has visits, and none
 * of them is on or before today. It is not "recent" (it has not happened), so
 * it is labelled Upcoming and, under Most recent, sorts to the top, soonest
 * first. A place with past AND future visits is not upcoming: its most recent
 * visit to date is real and is what it sorts on.
 */
export function isUpcomingOnly(place: PlaceListRow): boolean {
  return place.visit_count > 0 && !place.latest_visit_to_date && place.first_visit_date !== null;
}

/**
 * The date a row shows and what it means, under a sort. Most recent shows the
 * latest visit to date; First visit and Name show the first visit. An
 * upcoming-only place shows its (first, future) date as Upcoming under every
 * sort, because calling it a visit would be untrue. Null date: no visits.
 */
export function rowDate(
  place: PlaceListRow,
  sort: PlaceSort,
): { date: string | null; upcoming: boolean } {
  if (isUpcomingOnly(place)) return { date: place.first_visit_date, upcoming: true };
  if (sort === "recent") return { date: place.latest_visit_to_date, upcoming: false };
  return { date: place.first_visit_date, upcoming: false };
}

// The Most recent ordering key. Tier 0 is upcoming-only (soonest first), tier
// 1 is visited to date (latest first), tier 2 is no visits at all (last).
export interface RecentKey {
  tier: 0 | 1 | 2;
  date: string | null;
}

function recentKey(place: PlaceListRow): RecentKey {
  if (isUpcomingOnly(place)) return { tier: 0, date: place.first_visit_date };
  if (place.latest_visit_to_date) return { tier: 1, date: place.latest_visit_to_date };
  return { tier: 2, date: null };
}

/**
 * A GROUP sorts on its most recently visited member, to date: Green Bay rises
 * when you went back to Lambeau. Upcoming members do not lift it, because they
 * have not been visited; only a group whose members are ALL upcoming-only is
 * itself upcoming, at its soonest date. (Under First visit a group still sorts
 * on its earliest member, as before.)
 */
function groupRecentKey(places: PlaceListRow[]): RecentKey {
  const visited = places
    .map((p) => p.latest_visit_to_date)
    .filter((d): d is string => d !== null);
  if (visited.length > 0) return { tier: 1, date: visited.reduce((a, b) => (a > b ? a : b)) };
  const upcoming = places
    .filter(isUpcomingOnly)
    .map((p) => p.first_visit_date as string);
  if (upcoming.length > 0) return { tier: 0, date: upcoming.reduce((a, b) => (a < b ? a : b)) };
  return { tier: 2, date: null };
}

function compareRecent(a: RecentKey, b: RecentKey): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (a.date === b.date) return 0;
  if (a.date === null) return 1;
  if (b.date === null) return -1;
  // Upcoming soonest first; visited latest first.
  return a.tier === 0 ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);
}

export interface PlaceFilters {
  placeType: PlaceType | "all";
  /** An occasion slug, matched against the place's FIRST visit. */
  occasion: string | "all";
}

export const DEFAULT_PLACE_FILTERS: PlaceFilters = {
  placeType: "all",
  occasion: "all",
};

/** A locality header with its places under it. Only ever 2 or more places. */
export interface PlaceGroupEntry {
  kind: "group";
  key: string;
  /** "Green Bay, Wisconsin" */
  label: string;
  places: PlaceListRow[];
  /** First visit order: the group's earliest first visit. */
  sortDate: string | null;
  /** Most recent order: see groupRecentKey. */
  recent: RecentKey;
  sortName: string;
}

/** One place on its own line: a lone locality, or no locality at all. */
export interface PlaceRowEntry {
  kind: "place";
  key: string;
  place: PlaceListRow;
  sortDate: string | null;
  recent: RecentKey;
  sortName: string;
}

export type PlaceListEntry = PlaceGroupEntry | PlaceRowEntry;

/** "Green Bay, Wisconsin", or as much of it as the row has. Used by the group
 * HEADER, where there is a whole line to spend. */
export function localityLabel(place: PlaceListRow): string {
  return [place.locality_name, place.admin_region].filter(Boolean).join(", ");
}

/**
 * "Milwaukee, WI", for a BARE ROW's metadata line, which also carries a date
 * and an occasion and cannot afford "Milwaukee, Wisconsin".
 *
 * Only a bare row needs this: a place inside a group already has the header
 * saying where it is, and repeating it on every row would be noise. Bare rows
 * have no header, which is exactly why they were reading as members of the
 * group above them.
 *
 * Returns "" when there is no locality, which is the normal case for a park or
 * a stadium with no city, and correctly adds nothing to the line.
 *
 * A CITY DOES NOT REPEAT ITS OWN NAME. For a city place the locality and the
 * name are the same string, so the full form gave "Minneapolis" titled above
 * "Minneapolis, MN" beneath. The region still earns its place (it says WHICH
 * Minneapolis), so only the echoed half is dropped.
 */
export function shortLocalityLabel(place: PlaceListRow): string {
  if (!place.locality_name) return "";
  const region = place.admin_region
    ? (US_STATE_POSTAL[place.admin_region] ?? place.admin_region)
    : null;
  const sameAsName =
    place.locality_name.trim().toLowerCase() === place.name.trim().toLowerCase();
  if (sameAsName) return region ?? "";
  return [place.locality_name, region].filter(Boolean).join(", ");
}

function matchesFilters(place: PlaceListRow, filters: PlaceFilters): boolean {
  if (filters.placeType !== "all" && place.place_type !== filters.placeType) return false;
  if (filters.occasion !== "all" && place.first_occasion_slug !== filters.occasion) return false;
  return true;
}

// Descending by date with nulls LAST. A place with no visits has no date to
// sort on and belongs at the bottom rather than the top, which is where a naive
// descending sort puts a null.
function byDateDesc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b.localeCompare(a);
}

/**
 * Fold the rows into the sequence the list renders.
 *
 * Filtering happens BEFORE grouping, which is what makes the filters behave
 * sensibly with no extra code: filtering a two-place locality down to one leaves
 * a group of one, and a group of one is a bare row by the rule above. Nothing
 * has to notice that a header disappeared.
 *
 * A GROUP'S DATE IS ITS EARLIEST first visit, not its latest. The column means
 * "when I first went here" for a place, and a locality is a place at a coarser
 * grain: you first went to Green Bay on the earlier of the two dates. Taking the
 * latest would make a locality jump the queue whenever a new venue in it was
 * logged, which reads as "somewhere you just discovered" about a city you have
 * been going to for years.
 */
export function buildPlaceList(
  rows: PlaceListRow[],
  filters: PlaceFilters = DEFAULT_PLACE_FILTERS,
  sort: PlaceSort = DEFAULT_PLACE_SORT,
): PlaceListEntry[] {
  const kept = rows.filter((place) => matchesFilters(place, filters));

  // Null locality_key never groups: two places that each have no locality are
  // not in the same locality, they are each in no locality.
  const byLocality = new Map<string, PlaceListRow[]>();
  const loners: PlaceListRow[] = [];
  for (const place of kept) {
    if (!place.locality_key) {
      loners.push(place);
      continue;
    }
    const list = byLocality.get(place.locality_key) ?? [];
    list.push(place);
    byLocality.set(place.locality_key, list);
  }

  const entries: PlaceListEntry[] = [];

  for (const [key, places] of byLocality) {
    if (places.length === 1) {
      loners.push(places[0]);
      continue;
    }
    // Members follow the list's own order: most recent first under Most
    // recent, first visit descending otherwise (name is a list order, not a
    // within-group one, and keeps the first-visit order inside a header).
    const ordered = [...places].sort((a, b) =>
      sort === "recent"
        ? compareRecent(recentKey(a), recentKey(b)) || a.name.localeCompare(b.name)
        : byDateDesc(a.first_visit_date, b.first_visit_date) || a.name.localeCompare(b.name),
    );
    const dates = places.map((p) => p.first_visit_date).filter((d): d is string => d !== null);
    entries.push({
      kind: "group",
      key: `group:${key}`,
      label: localityLabel(ordered[0]) || "Somewhere",
      places: ordered,
      sortDate: dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null,
      recent: groupRecentKey(places),
      sortName: localityLabel(ordered[0]) || ordered[0].name,
    });
  }

  for (const place of loners) {
    entries.push({
      kind: "place",
      key: `place:${place.id}`,
      place,
      sortDate: place.first_visit_date,
      recent: recentKey(place),
      sortName: place.name,
    });
  }

  entries.sort((a, b) =>
    sort === "name"
      ? a.sortName.localeCompare(b.sortName)
      : sort === "recent"
        ? compareRecent(a.recent, b.recent) || a.sortName.localeCompare(b.sortName)
        : byDateDesc(a.sortDate, b.sortDate) || a.sortName.localeCompare(b.sortName),
  );
  return entries;
}

/** How many places the sequence holds, groups counted by their members. */
export function countPlaces(entries: PlaceListEntry[]): number {
  return entries.reduce((n, e) => n + (e.kind === "group" ? e.places.length : 1), 0);
}

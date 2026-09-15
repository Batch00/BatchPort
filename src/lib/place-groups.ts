import type { PlaceListRow, PlaceType } from "@/lib/types";

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

export type PlaceSort = "first-visit" | "name";

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
  sortDate: string | null;
  sortName: string;
}

/** One place on its own line: a lone locality, or no locality at all. */
export interface PlaceRowEntry {
  kind: "place";
  key: string;
  place: PlaceListRow;
  sortDate: string | null;
  sortName: string;
}

export type PlaceListEntry = PlaceGroupEntry | PlaceRowEntry;

/** "Green Bay, Wisconsin", or as much of it as the row has. */
export function localityLabel(place: PlaceListRow): string {
  return [place.locality_name, place.admin_region].filter(Boolean).join(", ");
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
  sort: PlaceSort = "first-visit",
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
    const ordered = [...places].sort(
      (a, b) => byDateDesc(a.first_visit_date, b.first_visit_date) || a.name.localeCompare(b.name),
    );
    const dates = places.map((p) => p.first_visit_date).filter((d): d is string => d !== null);
    entries.push({
      kind: "group",
      key: `group:${key}`,
      label: localityLabel(ordered[0]) || "Somewhere",
      places: ordered,
      sortDate: dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null,
      sortName: localityLabel(ordered[0]) || ordered[0].name,
    });
  }

  for (const place of loners) {
    entries.push({
      kind: "place",
      key: `place:${place.id}`,
      place,
      sortDate: place.first_visit_date,
      sortName: place.name,
    });
  }

  entries.sort((a, b) =>
    sort === "name"
      ? a.sortName.localeCompare(b.sortName)
      : byDateDesc(a.sortDate, b.sortDate) || a.sortName.localeCompare(b.sortName),
  );
  return entries;
}

/** How many places the sequence holds, groups counted by their members. */
export function countPlaces(entries: PlaceListEntry[]): number {
  return entries.reduce((n, e) => n + (e.kind === "group" ? e.places.length : 1), 0);
}

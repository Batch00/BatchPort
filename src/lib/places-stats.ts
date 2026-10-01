// The Places stats section's model (pure, client-safe).
//
// Everything that counts is decided in SQL (scripts/sql/
// 2026-09-30-places-stats-views.sql). This file only shapes the rows for the
// screen: which catalogs get a ring, which tiles render, what order the bars
// go in, and the one-line captions. scripts/check-places-stats.ts asserts it.
//
// Designed against the data that exists, not a full dataset: twelve places,
// four catalogs at one or two items each, seven occasions most of which hold a
// single visit. Every rule below has to read well at that size first.

/** PostgREST may serialise numeric and bigint columns as strings. */
export function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

// ---- Rows, as the data layer returns them ---------------------------------

export interface PlacesSummaryRow {
  places_visited: number;
  states_visited: number;
  states_total: number;
  dc_visited: boolean;
  localities: number;
  first_place_date: string | null;
}

export interface PlaceCountsRow {
  total_places: number;
  localities: number;
  cities: number;
  campuses: number;
  stadiums: number;
  parks: number;
  landmarks: number;
  others: number;
}

export interface CatalogProgressRow {
  catalog_id: string;
  catalog_slug: string;
  label: string;
  denominator_note: string | null;
  sort_order: number;
  total: number;
  visited: number;
}

/** A visited catalog item; only visited rows are read. */
export interface CatalogItemRow {
  catalog_id: string;
  name: string;
  first_visit_date: string | null;
  place_id: string | null;
}

export interface OccasionRow {
  occasion_id: string | null;
  slug: string | null;
  label: string | null;
  color: string | null;
  sort_order: number | null;
  visits: number;
  places: number;
  states: number;
}

export interface YearlyPlacesRow {
  year: number;
  visits: number;
  places: number;
  new_places: number;
  new_states: number;
}

export interface PlacesStats {
  summary: PlacesSummaryRow | null;
  counts: PlaceCountsRow | null;
  catalogs: CatalogProgressRow[];
  catalogItems: CatalogItemRow[];
  occasions: OccasionRow[];
  yearly: YearlyPlacesRow[];
}

// ---- Catalogs --------------------------------------------------------------

export interface StartedCatalog {
  id: string;
  slug: string;
  label: string;
  note: string | null;
  visited: number;
  total: number;
  /** 0 to 1. The ring draws this exactly; nothing rounds a sliver up. */
  fraction: number;
  /** Every visited item, earliest first. Never truncated: the place-list
   * rule (lib/place-lines.ts) applies to a catalog's names too. */
  items: CatalogItemRow[];
}

export interface CatalogSplit {
  started: StartedCatalog[];
  notStarted: { id: string; label: string; total: number; note: string | null }[];
}

/**
 * Rings for catalogs with at least one visit, a compact list for the rest
 * (decided: the wall of seven zero rings does not happen). Both keep the
 * catalog's own sort_order, so a catalog does not jump position on the day
 * it gets its first visit beyond moving from one group to the other.
 */
export function splitCatalogs(
  catalogs: CatalogProgressRow[],
  items: CatalogItemRow[],
): CatalogSplit {
  const ordered = [...catalogs].sort((a, b) => num(a.sort_order) - num(b.sort_order));
  const started: StartedCatalog[] = [];
  const notStarted: CatalogSplit["notStarted"] = [];
  for (const c of ordered) {
    const visited = num(c.visited);
    const total = num(c.total);
    if (visited > 0) {
      started.push({
        id: c.catalog_id,
        slug: c.catalog_slug,
        label: c.label,
        note: c.denominator_note,
        visited,
        total,
        fraction: total > 0 ? Math.min(1, visited / total) : 0,
        items: items
          .filter((i) => i.catalog_id === c.catalog_id)
          .sort(
            (a, b) =>
              (a.first_visit_date ?? "9999").localeCompare(b.first_visit_date ?? "9999") ||
              a.name.localeCompare(b.name),
          ),
      });
    } else {
      notStarted.push({ id: c.catalog_id, label: c.label, total, note: c.denominator_note });
    }
  }
  return { started, notStarted };
}

// ---- Type counters ---------------------------------------------------------

export interface TypeTile {
  key: string;
  label: string;
  count: number;
}

/**
 * The five requested types always render, a zero included, so the row has a
 * fixed shape and "no landmarks yet" is visible rather than implied by a gap.
 * "Other" is the catch-all and is not something anybody collects, so it
 * appears only when it holds something; without it the tiles would no longer
 * add up to the place count printed above them.
 */
export function typeTiles(counts: PlaceCountsRow): TypeTile[] {
  const tiles: TypeTile[] = [
    { key: "city", label: "Cities", count: num(counts.cities) },
    { key: "campus", label: "Campuses", count: num(counts.campuses) },
    // 'stadium' means any sports venue, arenas included (CLAUDE.md).
    { key: "stadium", label: "Stadiums", count: num(counts.stadiums) },
    { key: "park", label: "Parks", count: num(counts.parks) },
    { key: "landmark", label: "Landmarks", count: num(counts.landmarks) },
  ];
  const others = num(counts.others);
  if (others > 0) tiles.push({ key: "other", label: "Other", count: others });
  return tiles;
}

// ---- Occasions -------------------------------------------------------------

export interface OccasionBar {
  key: string;
  label: string;
  color: string;
  visits: number;
  places: number;
  states: number;
}

/** The colour for visits with no occasion: the neutral grey "other" uses. */
const NO_OCCASION_COLOR = "#475569";

/**
 * Most visits first; ties keep the picker's own order, so five occasions at
 * one visit each read in a stable, familiar sequence rather than shuffling
 * between renders. Visits with no occasion are their own bar (decided in
 * SQL) and sit last among their tie, since they are the least informative.
 */
export function occasionBars(rows: OccasionRow[]): OccasionBar[] {
  const order = (r: OccasionRow) =>
    r.occasion_id ? num(r.sort_order) : Number.MAX_SAFE_INTEGER;
  return [...rows]
    .sort((a, b) => num(b.visits) - num(a.visits) || order(a) - order(b))
    .map((r) => ({
      key: r.occasion_id ?? "none",
      label: r.label ?? "No occasion",
      color: r.color ?? NO_OCCASION_COLOR,
      visits: num(r.visits),
      places: num(r.places),
      states: num(r.states),
    }));
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/**
 * "Game leads with 5 of 13 visits", only when one occasion strictly leads.
 * On a tie the caption would name one of two equals as the leader, which is
 * not true, so there is no caption.
 */
export function occasionInsight(bars: OccasionBar[]): string | undefined {
  if (bars.length < 2) return undefined;
  const [top, second] = bars;
  if (top.visits <= second.visits) return undefined;
  const total = bars.reduce((sum, b) => sum + b.visits, 0);
  return `${top.label} leads with ${top.visits} of ${total} ${plural(total, "visit")}`;
}

// ---- Years -----------------------------------------------------------------

export function yearlyPlaces(rows: YearlyPlacesRow[]): YearlyPlacesRow[] {
  return rows
    .map((r) => ({
      year: num(r.year),
      visits: num(r.visits),
      places: num(r.places),
      new_places: num(r.new_places),
      new_states: num(r.new_states),
    }))
    .filter((r) => r.year > 0)
    .sort((a, b) => a.year - b.year);
}

/** "2025 added the most: 5 new places", only for a strict winner. */
export function yearlyPlacesInsight(rows: YearlyPlacesRow[]): string | undefined {
  if (rows.length < 2) return undefined;
  const ranked = [...rows].sort((a, b) => b.new_places - a.new_places);
  const [top, second] = ranked;
  if (top.new_places === 0 || top.new_places === second.new_places) return undefined;
  return `${top.year} added the most: ${top.new_places} new ${plural(top.new_places, "place")}`;
}

// ---- The section as a whole -----------------------------------------------

/**
 * Whether the user has logged any place at all. Without one, the section is
 * the states map (trip stops still fill states) plus a single pointer to
 * /places, never a stack of empty cards.
 */
export function hasPlaces(stats: PlacesStats): boolean {
  return num(stats.counts?.total_places) > 0;
}

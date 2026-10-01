// Server reads for the Places section of the stats page.
//
// Every read carries .eq("user_id", user.id). The views are security_invoker,
// so RLS applies, but RLS here is `own OR is_shared(user_id)`, which would
// hand back the demo account's coverage beside the caller's. The explicit
// filter is the access boundary; see "RLS IS NOT AN OWNER FILTER" in
// CLAUDE.md.
//
// Failures degrade to absent rather than throwing. The stats page is shipped
// and the Places section is not; a missing view or a bad deploy of the
// migration must cost the section, never the page.

import { requireUser } from "@/lib/current-user";
import type {
  CatalogItemRow,
  CatalogProgressRow,
  OccasionRow,
  PlaceCountsRow,
  PlacesStats,
  PlacesSummaryRow,
  YearlyPlacesRow,
} from "@/lib/places-stats";
import type { StateCoverageRow } from "@/lib/state-map";

/**
 * v_state_coverage for the current user: 51 rows (50 states and DC) once they
 * have any presence point, none before that. Null on failure.
 */
export async function getStateCoverage(): Promise<StateCoverageRow[] | null> {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("v_state_coverage")
    .select("state_code, state_name, visited, first_visit_date")
    .eq("user_id", user.id);
  if (error) {
    console.error("getStateCoverage failed", error);
    return null;
  }
  return (data ?? []) as StateCoverageRow[];
}

/**
 * Everything else the Places section draws, in one round of parallel reads.
 * Each read degrades on its own: a failed occasion read costs the occasion
 * chart, not the rings beside it.
 */
export async function getPlacesStats(): Promise<PlacesStats> {
  const { supabase, user } = await requireUser();

  const [summary, counts, catalogs, catalogItems, occasions, yearly] = await Promise.all([
    supabase
      .from("v_places_summary")
      .select("places_visited, states_visited, states_total, dc_visited, localities, first_place_date")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("v_place_counts")
      .select("total_places, localities, cities, campuses, stadiums, parks, landmarks, others")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("v_catalog_progress")
      .select("catalog_id, catalog_slug, label, denominator_note, sort_order, total, visited")
      .eq("user_id", user.id),
    // Visited items only: the rings name what was ticked off, and the 695
    // unvisited rows per user have no surface yet.
    supabase
      .from("v_catalog_items_status")
      .select("catalog_id, name, first_visit_date, place_id")
      .eq("user_id", user.id)
      .eq("visited", true),
    supabase
      .from("v_occasion_breakdown")
      .select("occasion_id, slug, label, color, sort_order, visits, places, states")
      .eq("user_id", user.id),
    supabase
      .from("v_yearly_places")
      .select("year, visits, places, new_places, new_states")
      .eq("user_id", user.id),
  ]);

  const settle = <T>(name: string, result: { data: T | null; error: unknown }, fallback: T): T => {
    if (result.error) {
      console.error(`getPlacesStats: ${name} failed`, result.error);
      return fallback;
    }
    return result.data ?? fallback;
  };

  return {
    summary: settle<PlacesSummaryRow | null>("summary", summary, null),
    counts: settle<PlaceCountsRow | null>("counts", counts, null),
    catalogs: settle<CatalogProgressRow[]>("catalogs", catalogs, []),
    catalogItems: settle<CatalogItemRow[]>("catalog items", catalogItems, []),
    occasions: settle<OccasionRow[]>("occasions", occasions, []),
    yearly: settle<YearlyPlacesRow[]>("yearly", yearly, []),
  };
}

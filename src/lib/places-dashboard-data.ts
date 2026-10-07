// Server reads for the dashboard's places additions: the two overview tiles
// and the recent places strip.
//
// Each read is written once, as read*(supabase, userId), with two callers:
// getDashboardPlaces() for the signed-in owner, and share-data.ts for the
// public profile (the tiles on /share/[slug] and /demo, the strip on /demo
// only), which passes the cookie-backed server client and the profile's
// owner. Same query, same owner filter, on every surface.
//
// Every read carries .eq("user_id", userId). The views are security_invoker,
// so RLS applies, but RLS here is `own OR is_shared(user_id)`, which would
// hand back the demo account's rows beside the caller's. The explicit filter
// is the access boundary; see "RLS IS NOT AN OWNER FILTER" in CLAUDE.md.
//
// Failures degrade to absent rather than throwing: the dashboard is the app's
// front door, and a missing view must cost these additions, never the page.

import { requireUser } from "@/lib/current-user";
import type { createClient } from "@/utils/supabase/server";
import { num } from "@/lib/places-stats";
import type { PlaceType } from "@/lib/types";

/** The two overview tiles, from v_places_summary. */
export interface DashboardPlacesSummary {
  /** Of the 50 (DC excluded), presence-wide: a trip stop counts. */
  statesVisited: number;
  statesTotal: number;
  dcVisited: boolean;
  places: number;
  localities: number;
}

/** One entry in the recent places strip. */
export interface RecentPlace {
  id: string;
  name: string;
  placeType: PlaceType;
  /** The place's most recent visit on or before today. */
  visitDate: string;
  /** That visit's own label when the user typed one ("Dave and Priya's
   * wedding"), else its occasion's label, else null. */
  occasion: string | null;
}

export interface DashboardPlaces {
  /** Null only when the read failed. A user with no presence at all gets
   * zeroes, so the tiles still render (states can come from trips alone). */
  summary: DashboardPlacesSummary | null;
  recent: RecentPlace[];
}

export const RECENT_PLACES_LIMIT = 6;

// Enough visits to find six distinct places even when a few of them were
// visited many times. Twelve places today; this is a ceiling, not a page.
const RECENT_VISIT_SCAN = 200;

/** The session or anon server client. Never the admin client, which would
 * bypass is_shared() on the public path. */
export type PlacesDashboardClient = Awaited<ReturnType<typeof createClient>>;

export async function getDashboardPlaces(): Promise<DashboardPlaces> {
  const { supabase, user } = await requireUser();
  const [summary, recent] = await Promise.all([
    readPlacesSummary(supabase, user.id),
    readRecentPlaces(supabase, user.id),
  ]);
  return { summary, recent };
}

export async function readPlacesSummary(
  supabase: PlacesDashboardClient,
  userId: string,
): Promise<DashboardPlacesSummary | null> {
  const { data, error } = await supabase
    .from("v_places_summary")
    .select("places_visited, states_visited, states_total, dc_visited, localities")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("getDashboardPlaces: summary failed", error);
    return null;
  }
  // No row means no presence anywhere yet: zero of 50, zero places. The
  // denominator is the view's own count when there is a row, and the 50 it
  // always is when there is not.
  const row = (data ?? null) as Record<string, unknown> | null;
  return {
    statesVisited: num(row?.states_visited),
    statesTotal: row ? num(row.states_total) : 50,
    dcVisited: row?.dc_visited === true,
    places: num(row?.places_visited),
    localities: num(row?.localities),
  };
}

// "Recent" is the most recent visit TO DATE, so the strip reads the phase 2
// chain rather than v_places, which is deliberately unfiltered and would put
// a game with tickets for next month at the top of "recent".
//
//   v_place_visits_to_date  which visits count, newest first; the first row
//                           per place is that place's most recent visit
//   v_place_presence        name and type of those places
//   occasions               the occasion's label (reference table)
//   place_visits            occasion_label only, for exactly the visit ids
//                           the to-date view admitted; the view does not
//                           carry the free text override
export async function readRecentPlaces(
  supabase: PlacesDashboardClient,
  userId: string,
): Promise<RecentPlace[]> {
  const visits = await supabase
    .from("v_place_visits_to_date")
    .select("id, place_id, visit_date, occasion_id")
    .eq("user_id", userId)
    .order("visit_date", { ascending: false })
    .order("id", { ascending: true })
    .limit(RECENT_VISIT_SCAN);
  if (visits.error) {
    console.error("getDashboardPlaces: recent visits failed", visits.error);
    return [];
  }

  const latest: {
    id: string;
    place_id: string;
    visit_date: string;
    occasion_id: string | null;
  }[] = [];
  const seen = new Set<string>();
  for (const row of (visits.data ?? []) as typeof latest) {
    if (seen.has(row.place_id)) continue;
    seen.add(row.place_id);
    latest.push(row);
    if (latest.length === RECENT_PLACES_LIMIT) break;
  }
  if (latest.length === 0) return [];

  const placeIds = latest.map((row) => row.place_id);
  const occasionIds = Array.from(
    new Set(latest.map((row) => row.occasion_id).filter((id): id is string => Boolean(id))),
  );

  const [places, labels, occasions] = await Promise.all([
    supabase
      .from("v_place_presence")
      .select("place_id, name, place_type")
      .eq("user_id", userId)
      .in("place_id", placeIds),
    supabase
      .from("place_visits")
      .select("id, occasion_label")
      .eq("user_id", userId)
      .in(
        "id",
        latest.map((row) => row.id),
      ),
    occasionIds.length > 0
      ? supabase.from("occasions").select("id, label").in("id", occasionIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (places.error) {
    console.error("getDashboardPlaces: recent places failed", places.error);
    return [];
  }
  // A failed label or occasion read costs the caption, not the strip.
  if (labels.error) console.error("getDashboardPlaces: visit labels failed", labels.error);
  if (occasions.error) console.error("getDashboardPlaces: occasions failed", occasions.error);

  const placeById = new Map(
    ((places.data ?? []) as { place_id: string; name: string; place_type: PlaceType }[]).map(
      (row) => [row.place_id, row],
    ),
  );
  const labelByVisit = new Map(
    ((labels.data ?? []) as { id: string; occasion_label: string | null }[]).map((row) => [
      row.id,
      row.occasion_label?.trim() || null,
    ]),
  );
  const occasionById = new Map(
    ((occasions.data ?? []) as { id: string; label: string }[]).map((row) => [row.id, row.label]),
  );

  const recent: RecentPlace[] = [];
  for (const visit of latest) {
    const place = placeById.get(visit.place_id);
    if (!place) continue;
    recent.push({
      id: place.place_id,
      name: place.name,
      placeType: place.place_type,
      visitDate: visit.visit_date,
      occasion:
        labelByVisit.get(visit.id) ??
        (visit.occasion_id ? (occasionById.get(visit.occasion_id) ?? null) : null),
    });
  }
  return recent;
}

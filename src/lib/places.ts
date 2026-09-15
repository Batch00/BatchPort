import { requireUser } from "@/lib/current-user";
import { parseEwkbPoint, pointEwkt } from "@/lib/geo";
import { toTransportMode, type TransportMode } from "@/lib/transport";
import type {
  Occasion,
  Place,
  PlaceCatalogItem,
  PlaceListRow,
  PlaceType,
  PlaceVisit,
  PlaceWithVisits,
} from "@/lib/types";

// Server-side data access for places and their visits.
//
// Three rules this file exists to hold, all of them things that fail quietly
// rather than loudly if they slip:
//
//  * locality_key IS GENERATED ALWAYS AS STORED. It never appears in an insert
//    or update payload, exactly as destinations.latitude/longitude never do.
//    Sending it is a 428C9 from Postgres, which surfaces as an opaque write
//    failure in a sheet the user has just filled in.
//
//  * geom IS WRITTEN AS EWKT AND READ AS EWKB. places has no generated
//    lat/lng columns beside its geography point (destinations does), so reads
//    select geom and decode it with parseEwkbPoint. That is the same shape
//    bucket-list.ts, discover.ts, and nearby-data.ts already use.
//
//  * transport_mode IS TEXT WITH A CHECK CONSTRAINT, matching
//    transport_legs.mode. Not an enum. Values are narrowed through
//    toTransportMode on the way out so a row written before a mode was removed
//    reads as null rather than as an unknown string.
//
// Every read here goes through requireUser()'s session-scoped client AND
// filters on user_id. No function takes a userId, so no request can name
// another account; the filter is what stops a request seeing one anyway.
//
// RLS IS NOT THE OWNER FILTER. The SELECT policies on places and place_visits
// are `auth.uid() = user_id` OR `is_shared(user_id)`, and is_shared() grants
// the demo account and every publicly shared profile, so an unfiltered read
// returns their rows too. v_places is security_invoker and inherits exactly
// that. See CLAUDE.md under "Search, Export, and Home Location".

export interface PlaceInput {
  name: string;
  place_type: PlaceType;
  lat: number;
  lng: number;
  country_code: string | null;
  admin_region: string | null;
  locality_name: string | null;
  /** Set when the place came from the tracked venue catalog, null otherwise. */
  catalog_item_id: string | null;
  notes: string | null;
}

export interface PlaceVisitInput {
  visit_date: string;
  end_date: string | null;
  occasion_id: string | null;
  occasion_label: string | null;
  /** Game visits only. */
  event_org: string | null;
  event_detail: string | null;
  transport_mode: TransportMode | null;
  trip_id: string | null;
  notes: string | null;
}

// locality_key is present here because reads want it and writes never do.
const PLACE_COLUMNS =
  "id,user_id,name,place_type,geom,country_code,admin_region,locality_name,locality_key,catalog_item_id,notes,created_at,updated_at";

const VISIT_COLUMNS =
  "id,place_id,user_id,visit_date,end_date,occasion_id,occasion_label,event_org,event_detail,transport_mode,trip_id,notes,created_at,updated_at";

const PLACE_LIST_COLUMNS = `${PLACE_COLUMNS},visit_count,first_visit_date,latest_visit_date,first_occasion_slug,first_occasion_label,first_occasion_icon,first_occasion_color`;

type GeomRow = { geom?: string | null };

function withPoint<T extends GeomRow>(row: T): Omit<T, "geom"> & { lat: number | null; lng: number | null } {
  const { geom, ...rest } = row;
  const point = geom ? parseEwkbPoint(geom) : null;
  return { ...rest, lat: point?.lat ?? null, lng: point?.lng ?? null };
}

function normalizeVisit(row: Record<string, unknown>): PlaceVisit {
  return {
    ...(row as unknown as PlaceVisit),
    transport_mode: toTransportMode(row.transport_mode),
  };
}

// --- Reference data ---------------------------------------------------------

/** The 11 seeded occasions, in picker order. Reference data, world readable. */
export async function getOccasions(): Promise<Occasion[]> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("occasions")
    .select("id,slug,label,icon,color,sort_order")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Occasion[];
}

interface CatalogItemRow extends GeomRow {
  id: string;
  wikidata_qid: string;
  name: string;
  city: string | null;
  state: string | null;
  country_code: string | null;
  tenants: string[] | null;
  place_catalog_item_memberships?:
    | { place_catalogs: { slug: string; label: string } | { slug: string; label: string }[] | null }[]
    | null;
}

export const CATALOG_ITEM_COLUMNS =
  "id,wikidata_qid,name,geom,city,state,country_code,tenants,place_catalog_item_memberships(place_catalogs(slug,label))";

/**
 * Flatten a catalog row into the shape the search route and the entry sheet
 * both consume. PostgREST types an embedded relation as an array even when it
 * is to-one, so both shapes are normalized rather than asserted into one.
 */
export function normalizeCatalogItem(row: CatalogItemRow): PlaceCatalogItem {
  const point = row.geom ? parseEwkbPoint(row.geom) : null;
  const catalogs = (row.place_catalog_item_memberships ?? []).flatMap((m) => {
    const c = m.place_catalogs;
    if (!c) return [];
    return Array.isArray(c) ? c : [c];
  });
  return {
    id: row.id,
    wikidata_qid: row.wikidata_qid,
    name: row.name,
    lat: point?.lat ?? null,
    lng: point?.lng ?? null,
    city: row.city,
    state: row.state,
    country_code: row.country_code,
    tenants: row.tenants ?? [],
    catalogs: catalogs.map((c) => ({ slug: c.slug, label: c.label })),
  };
}

/** One catalog venue by id, for re-hydrating a pick the sheet already made. */
export async function getCatalogItem(id: string): Promise<PlaceCatalogItem | null> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("place_catalog_items")
    .select(CATALOG_ITEM_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return normalizeCatalogItem(data as unknown as CatalogItemRow);
}

// --- Reads ------------------------------------------------------------------

/**
 * Every place with its visit rollup, newest first visit first. Reads
 * batchport.v_places; run scripts/sql/2026-09-04-places-v-places.sql first.
 *
 * Sorted here rather than left to the caller because the grouped list's whole
 * ordering rule (groups and bare rows in one flat sequence by first visit,
 * descending) depends on it, and a second sort somewhere else would be a
 * second answer. Nulls last: a place with no visits has no date to sort on and
 * belongs at the bottom rather than at the top, which is where Postgres puts
 * nulls on a descending sort by default.
 */
export async function getPlacesList(): Promise<PlaceListRow[]> {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("v_places")
    .select(PLACE_LIST_COLUMNS)
    .eq("user_id", user.id)
    .order("first_visit_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) =>
    withPoint(row as unknown as GeomRow & Record<string, unknown>),
  ) as unknown as PlaceListRow[];
}

/** One place with every visit, oldest visit first. */
export async function getPlace(id: string): Promise<PlaceWithVisits | null> {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("places")
    .select(`${PLACE_COLUMNS}, place_visits(${VISIT_COLUMNS})`)
    .eq("user_id", user.id)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { place_visits: visits, ...place } = data as unknown as GeomRow &
    Record<string, unknown> & { place_visits?: Record<string, unknown>[] };
  return {
    ...(withPoint(place) as unknown as Place),
    visits: (visits ?? [])
      .map(normalizeVisit)
      .sort((a, b) => a.visit_date.localeCompare(b.visit_date)),
  };
}

/** How many visits a place has. The UI asks before deleting the last one. */
export async function countPlaceVisits(placeId: string): Promise<number> {
  const { supabase, user } = await requireUser();
  const { count, error } = await supabase
    .from("place_visits")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("place_id", placeId);
  if (error) throw error;
  return count ?? 0;
}

// --- Writes -----------------------------------------------------------------

// Note the absence of locality_key in both payloads below. It is derived by
// Postgres from locality_name, admin_region, and country_code.
function placePayload(input: PlaceInput) {
  return {
    name: input.name.trim(),
    place_type: input.place_type,
    geom: pointEwkt(input.lng, input.lat),
    country_code: input.country_code,
    admin_region: input.admin_region,
    locality_name: input.locality_name,
    catalog_item_id: input.catalog_item_id,
    notes: input.notes,
  };
}

function visitPayload(input: PlaceVisitInput) {
  return {
    visit_date: input.visit_date,
    end_date: input.end_date,
    occasion_id: input.occasion_id,
    occasion_label: input.occasion_label,
    event_org: input.event_org,
    event_detail: input.event_detail,
    transport_mode: input.transport_mode,
    trip_id: input.trip_id,
    notes: input.notes,
  };
}

/**
 * The place this input would duplicate, if the user already has one.
 *
 * ONE VENUE IS ONE PIN. Logging a catalog venue that is already logged must add
 * a visit to it, not clone it: two rows for one building double-count a
 * catalog's denominator, put two pins on one spot, and split a visit history
 * that only makes sense whole. Nothing in the UI can be trusted to prevent
 * that, because the create path is reachable from the list's "Log a place"
 * button regardless of what the user already has.
 *
 * Matching is by catalog_item_id when there is one, because that is a real
 * identity. Otherwise it falls back to the same name in the same locality,
 * which is the best available answer for a Photon pick: "Green Bay" logged
 * twice in Green Bay, Wisconsin is one place. A place with no locality at all
 * never matches, because "no locality" is not a locality two things can share.
 */
export async function findDuplicatePlace(input: PlaceInput): Promise<string | null> {
  const { supabase, user } = await requireUser();

  if (input.catalog_item_id) {
    const { data, error } = await supabase
      .from("places")
      .select("id")
      .eq("user_id", user.id)
      .eq("catalog_item_id", input.catalog_item_id)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data?.id as string | undefined) ?? null;
  }

  if (!input.locality_name?.trim()) return null;

  // locality_key is generated, so it cannot be filtered on before the row
  // exists. Match its inputs instead, case-insensitively on the name.
  const { data, error } = await supabase
    .from("places")
    .select("id")
    .eq("user_id", user.id)
    .is("catalog_item_id", null)
    .ilike("name", input.name.trim())
    .eq("locality_name", input.locality_name)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data?.id as string | undefined) ?? null;
}

/**
 * Create a place and its first visit together, in one transaction.
 *
 * The UI never exposes the two-table split, so neither does this: there is no
 * way to create a place with no visit, because "somewhere I have been" with no
 * time attached is not a thing the sheet can express.
 *
 * It goes through batchport.create_place_with_visit rather than issuing two
 * inserts because PostgREST has no transaction across two requests. Doing the
 * inserts here and deleting the place again on failure only NARROWS the window:
 * if the compensating delete also fails, the result is a permanent visitless
 * place nothing will clean up. One RPC is one statement is one transaction.
 *
 * The function takes no user_id and reads auth.uid() itself, so there is no
 * signature in which a caller can name another account. It is SECURITY
 * INVOKER, so the same RLS insert policies still apply to both rows.
 *
 * Returns ids only: that is all the action needs, and reading the rows back
 * would put a second round trip behind an already-committed write.
 */
export async function createPlaceWithVisit(
  place: PlaceInput,
  visit: PlaceVisitInput,
): Promise<{ placeId: string; visitId: string }> {
  const { supabase } = await requireUser();

  const { data, error } = await supabase.rpc("create_place_with_visit", {
    p_name: place.name.trim(),
    p_place_type: place.place_type,
    p_geom: pointEwkt(place.lng, place.lat),
    p_country_code: place.country_code,
    p_admin_region: place.admin_region,
    p_locality_name: place.locality_name,
    p_catalog_item_id: place.catalog_item_id,
    p_notes: place.notes,
    p_visit_date: visit.visit_date,
    p_end_date: visit.end_date,
    p_occasion_id: visit.occasion_id,
    p_occasion_label: visit.occasion_label,
    p_event_org: visit.event_org,
    p_event_detail: visit.event_detail,
    p_transport_mode: visit.transport_mode,
    p_trip_id: visit.trip_id,
    p_visit_notes: visit.notes,
  });
  if (error) throw error;

  // A `returns table` function comes back as an array of rows, one here.
  const row = (Array.isArray(data) ? data[0] : data) as
    | { place_id: string; visit_id: string }
    | undefined;
  if (!row?.place_id || !row?.visit_id) {
    throw new Error("create_place_with_visit returned no row");
  }
  return { placeId: row.place_id, visitId: row.visit_id };
}

export async function updatePlace(id: string, input: PlaceInput): Promise<Place> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("places")
    .update(placePayload(input))
    .eq("id", id)
    .select(PLACE_COLUMNS)
    .single();
  if (error) throw error;
  return withPoint(data as unknown as GeomRow & Record<string, unknown>) as unknown as Place;
}

export async function deletePlace(id: string): Promise<void> {
  const { supabase } = await requireUser();
  // place_visits.place_id is ON DELETE CASCADE, so the visits go with it.
  const { error } = await supabase.from("places").delete().eq("id", id);
  if (error) throw error;
}

/** Add another visit to a place that already exists. */
export async function createPlaceVisit(
  placeId: string,
  input: PlaceVisitInput,
): Promise<PlaceVisit> {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("place_visits")
    .insert({ ...visitPayload(input), place_id: placeId, user_id: user.id })
    .select(VISIT_COLUMNS)
    .single();
  if (error) throw error;
  return normalizeVisit(data as Record<string, unknown>);
}

export async function updatePlaceVisit(
  id: string,
  input: PlaceVisitInput,
): Promise<PlaceVisit> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("place_visits")
    .update(visitPayload(input))
    .eq("id", id)
    .select(VISIT_COLUMNS)
    .single();
  if (error) throw error;
  return normalizeVisit(data as Record<string, unknown>);
}

export async function deletePlaceVisit(id: string): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("place_visits").delete().eq("id", id);
  if (error) throw error;
}

/** The place a visit belongs to, for the last-visit prompt. */
export async function getVisitPlaceId(visitId: string): Promise<string | null> {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("place_visits")
    .select("place_id")
    .eq("user_id", user.id)
    .eq("id", visitId)
    .maybeSingle();
  if (error) throw error;
  return (data?.place_id as string | undefined) ?? null;
}

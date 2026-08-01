import { createClient } from "@/utils/supabase/server";
import { requireUser } from "@/lib/current-user";
import { haversineKm } from "@/lib/geo";
import {
  buildTransportBreakdown,
  toTransportMode,
  type TransportBreakdown,
  type TransportLeg,
  type TransportMode,
} from "@/lib/transport";

// Server reads for transport legs.
//
// getTransportLegs takes no userId, for the same reason the journal, search,
// and export reads do not: it reads through requireUser()'s session-scoped
// client, so RLS is the access boundary and no request can name another
// account. The shared read is the deliberate exception and mirrors
// getSharedJournalByTrip: an explicit userId through the anon client, gated by
// is_shared().
//
// Every function here degrades to "nothing recorded" rather than throwing.
// Until scripts/sql/2026-08-03-transport-legs.sql has run the table does not
// exist, and a trip with no legs is the same shape as a trip nobody has
// annotated.

const COLUMNS =
  "id, destination_id, mode, carrier, duration_minutes, distance_km, notes";

/** The Supabase client the leg reads run through. Declared locally rather than
 * imported from map-data so the two modules do not depend on each other. */
type LegClient = Awaited<ReturnType<typeof createClient>>;

interface LegRow {
  id: string;
  destination_id: string;
  mode: string;
  carrier: string | null;
  // PostgREST can serialize a numeric column as a string to keep precision.
  duration_minutes: number | string | null;
  distance_km: number | string | null;
  notes: string | null;
}

function num(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Rows in, legs out. Anything with an unrecognized mode is dropped: a mode the
 * app cannot draw or label is worse than no leg at all. */
function toLegs(rows: LegRow[]): TransportLeg[] {
  const legs: TransportLeg[] = [];
  for (const row of rows) {
    const mode = toTransportMode(row.mode);
    if (!mode) continue;
    legs.push({
      id: row.id,
      destination_id: row.destination_id,
      mode,
      carrier: row.carrier,
      duration_minutes: num(row.duration_minutes),
      distance_km: num(row.distance_km),
      notes: row.notes,
    });
  }
  return legs;
}

/** Every leg on one trip, keyed by the stop it arrives at. */
export async function getTransportLegs(
  tripId: string,
): Promise<Map<string, TransportLeg>> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("transport_legs")
    .select(COLUMNS)
    .eq("trip_id", tripId);
  if (error) return new Map();
  return new Map(
    toLegs((data ?? []) as LegRow[]).map((leg) => [leg.destination_id, leg]),
  );
}

/** Whether the transport table is reachable, so the trip page can leave the
 * "How did you get here?" affordances out entirely rather than offering a
 * control that cannot save. */
export async function transportAvailable(): Promise<boolean> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("transport_legs")
    .select("id")
    .limit(1);
  return !error;
}

/** Legs across every trip of a shared profile, grouped by trip id and keyed
 * within it by arriving stop. Anon client plus an explicit user filter, gated
 * by is_shared() RLS. */
export async function getSharedTransportByTrip(
  userId: string,
): Promise<Map<string, Map<string, TransportLeg>>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transport_legs")
    .select(`trip_id, ${COLUMNS}`)
    .eq("user_id", userId);
  const byTrip = new Map<string, Map<string, TransportLeg>>();
  if (error || !data) return byTrip;
  const rows = data as unknown as (LegRow & { trip_id: string })[];
  for (const row of rows) {
    const [leg] = toLegs([row]);
    if (!leg) continue;
    const list = byTrip.get(row.trip_id) ?? new Map<string, TransportLeg>();
    list.set(leg.destination_id, leg);
    byTrip.set(row.trip_id, list);
  }
  return byTrip;
}

/**
 * Every recorded mode for a user, keyed by the stop the leg arrives at. This is
 * what lets the globe style an arc by how it was travelled: an arc's mode is
 * the mode of the stop it lands on, which is exactly what the row means.
 *
 * Takes the caller's client so the globe read can run on whichever one it
 * already has (the cookie-backed server client, or the sessionless anon client
 * inside the landing hero's cache scope).
 */
export async function legModesByDestination(
  supabase: LegClient,
  userId: string,
): Promise<Map<string, TransportMode>> {
  const { data, error } = await supabase
    .from("transport_legs")
    .select("destination_id, mode")
    .eq("user_id", userId);
  const modes = new Map<string, TransportMode>();
  if (error || !data) return modes;
  for (const row of data as { destination_id: string; mode: string }[]) {
    const mode = toTransportMode(row.mode);
    if (mode) modes.set(row.destination_id, mode);
  }
  return modes;
}

interface BreakdownDestinationRow {
  id: string;
  trip_id: string;
  order_index: number;
  latitude: number | null;
  longitude: number | null;
  trips: { status: string } | null;
}

/**
 * Distance travelled per mode, for the stats page.
 *
 * Measured the same way the globe draws it and the same way
 * f_distance_traveled counts it: great-circle between consecutive stops. That
 * is close to right for a flight and an understatement for a road, so the
 * breakdown says so rather than applying a detour factor the app made up. A
 * leg that carries its own distance_km override uses that instead, because
 * then the number came from the person who travelled it.
 *
 * Planned trips are excluded, matching every other stat in the app.
 */
export async function getTransportBreakdown(
  userId: string,
): Promise<TransportBreakdown | null> {
  const supabase = await createClient();
  const [destResult, legResult] = await Promise.all([
    supabase
      .from("destinations")
      .select("id, trip_id, order_index, latitude, longitude, trips!inner(status)")
      .eq("user_id", userId)
      .neq("trips.status", "planned")
      .order("order_index", { ascending: true }),
    supabase
      .from("transport_legs")
      .select("destination_id, mode, distance_km")
      .eq("user_id", userId),
  ]);
  // No table yet, or no travel yet: the section simply does not render.
  if (destResult.error || legResult.error) return null;

  const legs = new Map<string, { mode: TransportMode; km: number | null }>();
  for (const row of (legResult.data ?? []) as {
    destination_id: string;
    mode: string;
    distance_km: number | string | null;
  }[]) {
    const mode = toTransportMode(row.mode);
    if (!mode) continue;
    legs.set(row.destination_id, { mode, km: num(row.distance_km) });
  }
  if (legs.size === 0) return null;

  const byTrip = new Map<string, BreakdownDestinationRow[]>();
  for (const row of (destResult.data ?? []) as unknown as BreakdownDestinationRow[]) {
    const list = byTrip.get(row.trip_id) ?? [];
    list.push(row);
    byTrip.set(row.trip_id, list);
  }

  const hops: { mode: TransportMode | null; km: number }[] = [];
  for (const list of byTrip.values()) {
    const ordered = [...list].sort((a, b) => a.order_index - b.order_index);
    for (let i = 1; i < ordered.length; i += 1) {
      const from = ordered[i - 1];
      const to = ordered[i];
      const leg = legs.get(to.id) ?? null;
      // The user's own figure wins over the straight line when they gave one.
      if (leg?.km) {
        hops.push({ mode: leg.mode, km: leg.km });
        continue;
      }
      if (
        from.latitude === null ||
        from.longitude === null ||
        to.latitude === null ||
        to.longitude === null
      ) {
        continue;
      }
      hops.push({
        mode: leg?.mode ?? null,
        km: haversineKm(from.latitude, from.longitude, to.latitude, to.longitude),
      });
    }
  }

  const breakdown = buildTransportBreakdown(hops);
  return breakdown.byMode.length > 0 ? breakdown : null;
}

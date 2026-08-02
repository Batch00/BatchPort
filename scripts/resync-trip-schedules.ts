// Bring every existing trip's stored dates and stop order in line with its
// destinations, once.
//
// The app keeps trips.start_date/end_date and destinations.order_index synced
// on every destination write (lib/trip-schedule.ts), and every read derives the
// same answer anyway (lib/trip-dates.ts), so the UI is correct with or without
// this script. What it fixes is the SQL stats views, which read the stored
// columns directly and cannot call a TypeScript function: until a trip is
// touched by a write, v_user_travel_summary.days_traveling and
// v_yearly_breakdown keep quoting whatever was typed on the trip before the
// derived range existed.
//
// So: run it once after deploying the derived-dates change. It is idempotent
// and skips trips that already agree, so re-running it is free.
//
// Uses the admin (service-role) client and runs across every user, which is
// what a one-off data migration is. It does NOT need the dev server. Requires
// .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
//
// Run with:
//   npm run resync-trip-schedules -- --dry-run   report only
//   npm run resync-trip-schedules                apply

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import {
  chronologicalDestinations,
  derivedTripWindow,
} from "../src/lib/trip-dates";

interface DestinationRow {
  id: string;
  trip_id: string;
  arrival_date: string | null;
  departure_date: string | null;
  order_index: number;
}

interface TripRow {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
}

// Parse .env.local by hand so the script stays free of extra dependencies.
function loadEnvLocal(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  } catch {
    // No .env.local: fall back to whatever is already in process.env.
  }
  return env;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const env = loadEnvLocal();
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
  }

  // Admin client. Not scoped to a schema by default, so name it explicitly on
  // every query chain.
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const [tripsResult, destsResult] = await Promise.all([
    supabase.schema("batchport").from("trips").select("id, name, start_date, end_date"),
    supabase
      .schema("batchport")
      .from("destinations")
      .select("id, trip_id, arrival_date, departure_date, order_index")
      .order("order_index", { ascending: true }),
  ]);
  if (tripsResult.error) throw tripsResult.error;
  if (destsResult.error) throw destsResult.error;

  const trips = (tripsResult.data ?? []) as TripRow[];
  const byTrip = new Map<string, DestinationRow[]>();
  for (const row of (destsResult.data ?? []) as DestinationRow[]) {
    const list = byTrip.get(row.trip_id) ?? [];
    list.push(row);
    byTrip.set(row.trip_id, list);
  }

  console.log(
    `${dryRun ? "Checking" : "Resyncing"} ${trips.length} trips against their stops...`,
  );

  let reordered = 0;
  let redated = 0;
  for (const trip of trips) {
    const stops = byTrip.get(trip.id) ?? [];
    if (stops.length === 0) continue;

    const ordered = chronologicalDestinations(stops);
    const moved = ordered
      .map((stop, index) => ({ id: stop.id, index, was: stop.order_index }))
      .filter((entry) => entry.was !== entry.index);
    if (moved.length > 0) {
      reordered += 1;
      console.log(
        `  ${trip.name}: reordering ${moved.length} of ${stops.length} stops`,
      );
      if (!dryRun) {
        for (const entry of moved) {
          const { error } = await supabase
            .schema("batchport")
            .from("destinations")
            .update({ order_index: entry.index })
            .eq("id", entry.id);
          if (error) throw error;
        }
      }
    }

    // Undated stops leave the trip's own columns alone: they are the fallback
    // for exactly that case, not a value to clear.
    const window = derivedTripWindow(stops);
    if (!window) continue;
    if (trip.start_date === window.start && trip.end_date === window.end) {
      continue;
    }
    redated += 1;
    console.log(
      `  ${trip.name}: ${trip.start_date ?? "none"}..${trip.end_date ?? "none"} -> ${window.start}..${window.end}`,
    );
    if (!dryRun) {
      const { error } = await supabase
        .schema("batchport")
        .from("trips")
        .update({ start_date: window.start, end_date: window.end })
        .eq("id", trip.id);
      if (error) throw error;
    }
  }

  console.log(
    dryRun
      ? `Would reorder ${reordered} trips and redate ${redated}. Re-run without --dry-run to apply.`
      : `Reordered ${reordered} trips, redated ${redated}.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

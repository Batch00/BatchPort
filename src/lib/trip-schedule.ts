import { requireUser } from "@/lib/current-user";
import {
  chronologicalDestinations,
  derivedTripWindow,
} from "@/lib/trip-dates";

// The write side of trip-dates.ts: after anything changes a trip's stops, put
// the stored columns back in agreement with what those stops say.
//
// Two columns are maintained here and nowhere else:
//
//   trips.start_date / end_date  because the SQL stats views read them
//     directly (v_user_travel_summary.days_traveling, v_yearly_breakdown), and
//     a view cannot call a TypeScript function. Deriving on read alone would
//     leave the charts quoting a different trip length than the trip page.
//
//   destinations.order_index     because everything downstream of the route
//     order reads it and nothing else: the globe's arc sequence, the replay
//     timeline, the story, and "the leg into stop N". Renumbering here means
//     none of them need to learn about dates.
//
// The reads apply the same pure functions anyway (see resolveTripDates and
// chronologicalOrder), so a sync that fails leaves the UI correct and only the
// SQL views stale until the next write. That is why this is best-effort and
// never fails the mutation that triggered it.

interface ScheduleRow {
  id: string;
  arrival_date: string | null;
  departure_date: string | null;
  order_index: number;
}

/**
 * Re-derive a trip's date range and stop order from its destinations.
 *
 * Called after every destination create, update, and delete, and after a trip
 * edit (so a manually typed range on a dated trip is corrected rather than
 * left to disagree). Safe to call on a trip with no stops: there is nothing to
 * derive, and the manually entered dates are left exactly as they are.
 */
export async function syncTripSchedule(tripId: string): Promise<void> {
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("destinations")
      .select("id, arrival_date, departure_date, order_index")
      .eq("trip_id", tripId)
      .order("order_index", { ascending: true });
    if (error) throw error;

    const stops = (data ?? []) as ScheduleRow[];
    if (stops.length === 0) return;

    // Renumber only the rows that actually moved. A trip whose stops were
    // already in date order costs zero writes.
    const ordered = chronologicalDestinations(stops);
    const moved = ordered
      .map((stop, index) => ({ id: stop.id, index, was: stop.order_index }))
      .filter((entry) => entry.was !== entry.index);
    if (moved.length > 0) {
      await Promise.all(
        moved.map((entry) =>
          supabase
            .from("destinations")
            .update({ order_index: entry.index })
            .eq("id", entry.id)
            .eq("trip_id", tripId),
        ),
      );
    }

    // Undated stops leave the trip's own columns alone: they are the fallback
    // for exactly this case, not a value to clear.
    const window = derivedTripWindow(stops);
    if (!window) return;
    const { data: tripRow } = await supabase
      .from("trips")
      .select("start_date, end_date")
      .eq("id", tripId)
      .maybeSingle<{ start_date: string | null; end_date: string | null }>();
    if (
      tripRow &&
      tripRow.start_date === window.start &&
      tripRow.end_date === window.end
    ) {
      return;
    }
    await supabase
      .from("trips")
      .update({ start_date: window.start, end_date: window.end })
      .eq("id", tripId);
  } catch (error) {
    // Reads derive the same answer, so a failure here degrades to stale SQL
    // views rather than to a wrong date on screen.
    console.warn("Trip schedule sync skipped:", error);
  }
}

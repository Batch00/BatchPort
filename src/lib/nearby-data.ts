import { requireUser } from "@/lib/current-user";
import { parseEwkbPoint } from "@/lib/geo";
import type { PlannedExperiencePoint } from "@/lib/nearby";

// The saved plan, as points Nearby mode can match a device fix against. Like
// search and export, this reads the caller's own rows through requireUser()'s
// session-scoped client and takes no userId, so RLS is the access boundary and
// no request can name another account.

interface PlannedRow {
  id: string;
  name: string;
  destination_id: string;
  status?: string | null;
  geom: string | null;
  destinations: { name: string; trip_id: string } | null;
}

/**
 * Every planned experience that has coordinates, so standing next to one can
 * offer the checkoff. Selects * on experiences for the same reason the rest of
 * the app does: before the status migration the column does not exist, and a
 * named select would error rather than degrade.
 *
 * Pre-migration every row normalizes to "done", so this correctly returns
 * nothing: there is no plan to be near yet.
 */
export async function getPlannedExperiencePoints(): Promise<
  PlannedExperiencePoint[]
> {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("experiences")
    .select("*, destinations ( name, trip_id )")
    .eq("user_id", user.id)
    .not("geom", "is", null);
  if (error) throw error;

  const points: PlannedExperiencePoint[] = [];
  for (const row of (data ?? []) as unknown as PlannedRow[]) {
    if (row.status !== "planned") continue;
    const point = row.geom ? parseEwkbPoint(row.geom) : null;
    if (!point || !row.destinations) continue;
    points.push({
      id: row.id,
      name: row.name,
      destinationId: row.destination_id,
      destinationName: row.destinations.name,
      tripId: row.destinations.trip_id,
      lat: point.lat,
      lng: point.lng,
    });
  }
  return points;
}

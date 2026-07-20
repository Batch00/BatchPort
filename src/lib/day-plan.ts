import { durationDays } from "@/lib/format";
import { haversineKm, parseEwkbPoint } from "@/lib/geo";

// Pure helpers for the day-planning UI, shared by the planning workspace and
// the read-only share/demo trip cards. Day 1 is the destination's arrival
// date; a null planned_day means unassigned, which stays valid forever.

// Day sections stop being a planning aid and start being clutter on very long
// stays; past this the plan falls back to the flat list.
export const MAX_PLAN_DAYS = 21;

/** Number of day sections for a destination, or null when the dates are
 * missing, malformed, or the stay is too long for day UI. */
export function planDayCount(
  arrival: string | null,
  departure: string | null,
): number | null {
  const days = durationDays(arrival, departure);
  if (!days || days > MAX_PLAN_DAYS) return null;
  return days;
}

/** The ISO date of a plan day: day 1 = the arrival date. */
export function planDayIso(arrival: string, day: number): string {
  const date = new Date(`${arrival}T00:00:00`);
  date.setDate(date.getDate() + (day - 1));
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${dayOfMonth}`;
}

/** Short display date for a day header ("Apr 14"). */
export function planDayLabel(arrival: string, day: number): string {
  return new Date(`${planDayIso(arrival, day)}T00:00:00`).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric" },
  );
}

/** Which plan day is today, for the ongoing-trip highlight. Null when today
 * falls outside the stay. */
export function todayPlanDay(
  arrival: string | null,
  departure: string | null,
): number | null {
  const dayCount = planDayCount(arrival, departure);
  if (!dayCount || !arrival) return null;
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(now.getDate()).padStart(2, "0");
  const today = `${now.getFullYear()}-${month}-${dayOfMonth}`;
  for (let day = 1; day <= dayCount; day += 1) {
    if (planDayIso(arrival, day) === today) return day;
  }
  return null;
}

/** Group items by effective plan day: index 0 holds the unassigned ones,
 * index d (1-based) holds day d. Days outside 1..dayCount count as
 * unassigned (dates may have shrunk after assignment). */
export function groupByPlanDay<T>(
  items: T[],
  dayOf: (item: T) => number | null,
  dayCount: number,
): T[][] {
  const groups: T[][] = Array.from({ length: dayCount + 1 }, () => []);
  for (const item of items) {
    const day = dayOf(item);
    if (day !== null && day >= 1 && day <= dayCount) groups[day].push(item);
    else groups[0].push(item);
  }
  return groups;
}

// --- Proximity ---------------------------------------------------------------

// Straight-line distances only, so hints stay approximate by design: within
// ~2 km things are walkable in any direction, beyond ~10 km a day's plan is
// spread thin. The band between says nothing useful, so nothing renders.
const CLUSTER_KM = 2;
const SPREAD_KM = 10;

/** Decode the coordinates carried on experience rows (EWKB hex geom). */
export function experiencePoint(
  geom: string | null | undefined,
): { lat: number; lng: number } | null {
  return geom ? parseEwkbPoint(geom) : null;
}

/**
 * One quiet line about how a set of planned places relates spatially, or null
 * when there is nothing worth saying: fewer than two located places, or a
 * spread in the unremarkable middle band.
 */
export function proximitySummary(
  points: { lat: number; lng: number }[],
): string | null {
  if (points.length < 2) return null;
  let maxKm = 0;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const km = haversineKm(
        points[i].lat,
        points[i].lng,
        points[j].lat,
        points[j].lng,
      );
      if (km > maxKm) maxKm = km;
    }
  }
  if (maxKm <= CLUSTER_KM) {
    const within = Math.max(1, Math.round(maxKm));
    return `${points.length} places within ~${within} km`;
  }
  if (maxKm > SPREAD_KM) {
    return `Spread across ~${Math.round(maxKm)} km`;
  }
  return null;
}

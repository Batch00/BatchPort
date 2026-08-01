import { haversineKm } from "@/lib/geo";

// Pure proximity helpers for Nearby mode. Client-safe: no Supabase, no server
// imports, so both the map hook and the server data layer can share the shapes.
//
// The device position these functions receive lives in React state for the
// duration of the mode and is never written anywhere. The only place a
// coordinate leaves the session is the experience the user explicitly creates.

/** A device fix, in-session only. */
export interface NearbyPosition {
  lat: number;
  lng: number;
  /** Reported accuracy radius in metres, when the device supplies one. */
  accuracyM: number | null;
}

/** A planned experience with saved coordinates, for the checkoff prompt. */
export interface PlannedExperiencePoint {
  id: string;
  name: string;
  destinationId: string;
  destinationName: string;
  tripId: string;
  lat: number;
  lng: number;
}

/** Anything with coordinates that a match can be found among. */
interface Located {
  lat: number;
  lng: number;
}

/** A match plus how far away it is, in kilometres. */
export interface NearestMatch<T> {
  item: T;
  km: number;
}

// --- Thresholds ------------------------------------------------------------
//
// Three different questions, so three different radii.

/**
 * "Which of my stops am I in?" A city-sized answer: 50km comfortably covers a
 * metro area and its airport without claiming the next city over. Wrong only
 * for stops logged within 50km of each other, where the nearer one wins anyway.
 */
export const CONTEXT_RADIUS_KM = 50;

/**
 * "Am I standing at the thing I planned?" Tight enough that the prompt means
 * you are there, loose enough to survive a consumer GPS fix and a large site
 * (a temple complex, a park entrance): 250m.
 */
export const PLANNED_RADIUS_KM = 0.25;

/**
 * "What is this place called?" Only prefills the name field when a geosearch
 * result is close enough to be the thing in front of you: 150m.
 */
export const PREFILL_RADIUS_KM = 0.15;

/** The nearest item within `maxKm`, or null when nothing qualifies. */
export function nearestWithin<T extends Located>(
  position: NearbyPosition,
  items: T[],
  maxKm: number,
): NearestMatch<T> | null {
  let best: NearestMatch<T> | null = null;
  for (const item of items) {
    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng)) continue;
    const km = haversineKm(position.lat, position.lng, item.lat, item.lng);
    if (km > maxKm) continue;
    if (!best || km < best.km) best = { item, km };
  }
  return best;
}

/** "300m away", "2.4km away", "18km away". */
export function formatProximity(km: number): string {
  if (km < 1) {
    const metres = Math.max(10, Math.round((km * 1000) / 10) * 10);
    return `${metres}m away`;
  }
  if (km < 10) return `${km.toFixed(1)}km away`;
  return `${Math.round(km)}km away`;
}

/** Today in the device's own timezone, as YYYY-MM-DD, for the visited date of
 * something logged where you are standing. */
export function localToday(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

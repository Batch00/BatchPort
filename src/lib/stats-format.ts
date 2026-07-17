// Presentation helpers for stats. These format values that already come from
// the SQL views and functions; they do not compute any metric themselves.

const EARTH_CIRCUMFERENCE_KM = 40075;
const MOON_DISTANCE_KM = 384400;

// "12,450 km"
export function formatKm(km: number): string {
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

// A playful comparison for the distance traveled. Falls back to a Moon
// percentage when the trip is less than a tenth of the way around the world.
export function funDistanceComparison(km: number): string {
  if (km <= 0) return "Just getting started";
  const timesAround = km / EARTH_CIRCUMFERENCE_KM;
  if (timesAround >= 0.1) {
    return `${timesAround.toFixed(1)}x around the world`;
  }
  const pctToMoon = (km / MOON_DISTANCE_KM) * 100;
  return `${pctToMoon.toFixed(1)}% of the way to the Moon`;
}

// Fraction of the current lap around the world completed, in [0, 1]. Feeds
// the slim progress sliver on the distance card. Below one full lap this is
// simply distance over circumference; past that it is progress into the
// current lap.
export function lapProgress(km: number): number {
  if (km <= 0) return 0;
  const laps = km / EARTH_CIRCUMFERENCE_KM;
  if (laps < 1) return laps;
  const fraction = laps % 1;
  // A whole number of laps reads better as a full bar than an empty one.
  return fraction === 0 ? 1 : fraction;
}

// "59.91 N" / "40.62 N" (sign decides the hemisphere letter).
export function formatLatitude(value: number | null): string {
  if (value === null) return "Unknown";
  const hemisphere = value >= 0 ? "N" : "S";
  return `${Math.abs(value).toFixed(2)} ${hemisphere}`;
}

// "18.07 E" / "0.13 W"
export function formatLongitude(value: number | null): string {
  if (value === null) return "Unknown";
  const hemisphere = value >= 0 ? "E" : "W";
  return `${Math.abs(value).toFixed(2)} ${hemisphere}`;
}

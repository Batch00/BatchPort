// Shared geographic helpers. Pure functions, safe to import from both server
// and client code.

// EWKT for a PostGIS geography(Point,4326) column. PostgREST accepts this
// string form for inserts and updates; latitude/longitude generated columns
// are derived from it and must never be written directly.
export function pointEwkt(lng: number, lat: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}

const EARTH_RADIUS_KM = 6371;

// Great-circle distance between two lat/lng points in kilometers.
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

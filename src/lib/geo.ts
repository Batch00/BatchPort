// Shared geographic helpers. Pure functions, safe to import from both server
// and client code.

// EWKT for a PostGIS geography(Point,4326) column. PostgREST accepts this
// string form for inserts and updates; latitude/longitude generated columns
// are derived from it and must never be written directly.
export function pointEwkt(lng: number, lat: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}

// PostgREST returns PostGIS geography points as hex-encoded EWKB. Decode the
// two doubles directly rather than round-tripping through the database.
export function parseEwkbPoint(
  hex: string,
): { lat: number; lng: number } | null {
  if (typeof hex !== "string" || hex.length < 42) return null;
  try {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    const view = new DataView(bytes.buffer);
    const littleEndian = view.getUint8(0) === 1;
    const type = view.getUint32(1, littleEndian);
    // Bit 0x20000000 flags an embedded SRID; the base type must be Point (1).
    const hasSrid = (type & 0x20000000) !== 0;
    if ((type & 0xff) !== 1) return null;
    const offset = hasSrid ? 9 : 5;
    const lng = view.getFloat64(offset, littleEndian);
    const lat = view.getFloat64(offset + 8, littleEndian);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

// Case- and whitespace-insensitive identity for a named place within a
// country, used to match bucket list place items against geocoder results
// whose coordinates may differ slightly.
export function placeKey(name: string, countryCode: string | null): string {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, " ");
  return `${normalized}|${countryCode?.toUpperCase() ?? ""}`;
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

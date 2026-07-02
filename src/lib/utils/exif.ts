import ExifReader from "exifreader";

export interface ExifData {
  gpsLat: number | null;
  gpsLng: number | null;
  dateTaken: string | null;
}

export async function extractExif(file: File): Promise<ExifData> {
  try {
    const buffer = await file.arrayBuffer();
    const tags = ExifReader.load(buffer);

    let gpsLat: number | null = null;
    let gpsLng: number | null = null;
    let dateTaken: string | null = null;

    if (tags.GPSLatitude && tags.GPSLongitude) {
      gpsLat = tags.GPSLatitude.description as unknown as number;
      gpsLng = tags.GPSLongitude.description as unknown as number;
      if (tags.GPSLatitudeRef?.description === "South") gpsLat = -gpsLat;
      if (tags.GPSLongitudeRef?.description === "West") gpsLng = -gpsLng;
    }

    if (tags.DateTimeOriginal) {
      // EXIF format is "YYYY:MM:DD HH:MM:SS"; normalize to ISO "YYYY-MM-DD HH:MM:SS"
      // so PostgreSQL accepts it as a valid timestamptz.
      const raw = tags.DateTimeOriginal.description as unknown as string;
      dateTaken = raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
    }

    return { gpsLat, gpsLng, dateTaken };
  } catch {
    return { gpsLat: null, gpsLng: null, dateTaken: null };
  }
}

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function findNearestDestination(
  lat: number,
  lng: number,
  destinations: Array<{
    id: string;
    name: string;
    lat: number | null;
    lng: number | null;
  }>,
  maxKm = 50,
): { id: string; name: string } | null {
  let nearest: { id: string; name: string } | null = null;
  let minDist = Infinity;
  for (const dest of destinations) {
    if (dest.lat == null || dest.lng == null) continue;
    const dist = haversineKm(lat, lng, dest.lat, dest.lng);
    if (dist < minDist && dist <= maxKm) {
      minDist = dist;
      nearest = { id: dest.id, name: dest.name };
    }
  }
  return nearest;
}

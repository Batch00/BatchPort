import { haversineKm } from "@/lib/geo";

export interface ExifData {
  gpsLat: number | null;
  gpsLng: number | null;
  dateTaken: string | null;
}

// Parse EXIF from an already-read buffer, so callers that also need the raw
// bytes (e.g. for content fingerprinting) read the file only once. exifreader
// is imported lazily: it is a sizeable parser only needed once a user actually
// stages an upload, so it stays out of the page's initial bundle.
interface RefTag {
  value?: unknown;
  description?: unknown;
}

// True when a GPS hemisphere ref tag indicates the negative hemisphere.
// Matches the raw value ("S" / ["S"]) and any description phrasing that
// starts with the hemisphere word ("South", "South latitude").
function isSouthOrWest(
  tag: RefTag | undefined,
  letter: "S" | "W",
  word: "South" | "West",
): boolean {
  if (!tag) return false;
  const raw = Array.isArray(tag.value) ? tag.value[0] : tag.value;
  if (typeof raw === "string" && raw.toUpperCase().startsWith(letter)) {
    return true;
  }
  return typeof tag.description === "string" && tag.description.startsWith(word);
}

export async function extractExifFromBuffer(
  buffer: ArrayBuffer,
): Promise<ExifData> {
  try {
    const { default: ExifReader } = await import("exifreader");
    const tags = ExifReader.load(buffer);

    let gpsLat: number | null = null;
    let gpsLng: number | null = null;
    let dateTaken: string | null = null;

    if (tags.GPSLatitude && tags.GPSLongitude) {
      // exifreader's GPS descriptions are unsigned decimal degrees; the
      // hemisphere lives in the ref tags. The ref description is a phrase
      // ("South latitude", "West longitude"), never the bare word, and the
      // raw value is an array like ["S"], so check both defensively.
      gpsLat = Math.abs(Number(tags.GPSLatitude.description));
      gpsLng = Math.abs(Number(tags.GPSLongitude.description));
      if (isSouthOrWest(tags.GPSLatitudeRef, "S", "South")) gpsLat = -gpsLat;
      if (isSouthOrWest(tags.GPSLongitudeRef, "W", "West")) gpsLng = -gpsLng;
      if (Number.isNaN(gpsLat) || Number.isNaN(gpsLng)) {
        gpsLat = null;
        gpsLng = null;
      }
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

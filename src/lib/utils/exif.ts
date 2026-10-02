import { haversineKm } from "@/lib/geo";
import { sanitizeDateTaken, sanitizeGps } from "@/lib/photo-metadata";

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

// The sign a GPS hemisphere ref tag implies: 1 for N/E, -1 for S/W, null when
// the ref is missing or unreadable. Matches the raw value ("S" / ["S"]) and
// any description phrasing that starts with the hemisphere word ("South",
// "South latitude"). A missing ref is null rather than positive: shared-album
// exports can keep the coordinates and drop the refs, and guessing the
// northern/eastern hemisphere would put the photo on the wrong continent.
function hemisphereSign(
  tag: RefTag | undefined,
  positive: "N" | "E",
  negative: "S" | "W",
): 1 | -1 | null {
  if (!tag) return null;
  const raw = Array.isArray(tag.value) ? tag.value[0] : tag.value;
  const letter =
    typeof raw === "string" && raw.trim()
      ? raw.trim()[0].toUpperCase()
      : typeof tag.description === "string" && tag.description.trim()
        ? tag.description.trim()[0].toUpperCase()
        : null;
  if (letter === positive) return 1;
  if (letter === negative) return -1;
  return null;
}

export async function extractExifFromBuffer(
  buffer: ArrayBuffer,
): Promise<ExifData> {
  try {
    const { default: ExifReader } = await import("exifreader");
    const tags = ExifReader.load(buffer);

    let gpsLat: number | null = null;
    let gpsLng: number | null = null;

    if (tags.GPSLatitude && tags.GPSLongitude) {
      // exifreader's GPS descriptions are unsigned decimal degrees; the
      // hemisphere lives in the ref tags. The ref description is a phrase
      // ("South latitude", "West longitude"), never the bare word, and the
      // raw value is an array like ["S"], so check both defensively.
      const latSign = hemisphereSign(tags.GPSLatitudeRef, "N", "S");
      const lngSign = hemisphereSign(tags.GPSLongitudeRef, "E", "W");
      if (latSign !== null && lngSign !== null) {
        ({ gpsLat, gpsLng } = sanitizeGps(
          latSign * Math.abs(Number(tags.GPSLatitude.description)),
          lngSign * Math.abs(Number(tags.GPSLongitude.description)),
        ));
      }
    }

    // EXIF format is "YYYY:MM:DD HH:MM:SS", but shared-album exports can carry
    // a zeroed, blank, or truncated value that Postgres rejects. Anything that
    // is not a real, plausible timestamp becomes null.
    const dateTaken = sanitizeDateTaken(tags.DateTimeOriginal?.description);

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

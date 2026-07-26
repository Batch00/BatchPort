import { createClient } from "@/utils/supabase/server";
import { parseEwkbPoint } from "@/lib/geo";
import { getPhotoUrl } from "@/lib/photos";
import type { GlobePhoto } from "@/components/map/use-photo-mode";
import type { PhotoOwnerType, PhotoSource } from "@/lib/types";

// Data layer for the globe's photo map mode. Resolves a coordinate for every
// photo: EXIF GPS when captured at upload, otherwise the owner's location
// (experience geom, else the owning destination's geom; trip-level photos fall
// back to the trip's first destination). Photos with no resolvable location
// are excluded from the map but counted, so the UI can say so.
//
// RLS scopes every query: the user's own session on the dashboard, and the
// is_shared() helper for the sessionless demo and share surfaces, so passing
// a userId is safe here just like in map-data.ts.

/** A photo with no resolvable map coordinate. Carries everything needed to
 * show it in a grid/lightbox (so unmappable photos are still viewable), just
 * no lat/lng. */
export interface UnlocatedPhoto {
  id: string;
  thumbUrl: string;
  fullUrl: string;
  dateTaken: string | null;
  attribution: string | null;
  destinationName: string | null;
  tripName: string | null;
}

export interface PhotoMapData {
  photos: GlobePhoto[];
  /** Count of photos with no resolvable location (equals `unlocated.length`). */
  unlocatedCount: number;
  /** The unlocated photos themselves, so the UI can show them off-map. */
  unlocated: UnlocatedPhoto[];
}

interface PhotoRow {
  id: string;
  owner_type: PhotoOwnerType;
  owner_id: string;
  source: PhotoSource;
  storage_path: string | null;
  external_url: string | null;
  attribution: string | null;
  date_taken: string | null;
  thumb_path: string | null;
  gps_lat?: number | null;
  gps_lng?: number | null;
}

interface DestRow {
  id: string;
  trip_id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  order_index: number;
  trips: { name: string } | null;
}

interface ExpRow {
  id: string;
  destination_id: string;
  name: string;
  geom: string | null;
}

// Narrow column lists: the map never renders notes, covers, or fingerprints.
const PHOTO_COLUMNS_BASE =
  "id, owner_type, owner_id, source, storage_path, external_url, attribution, date_taken, thumb_path";
const PHOTO_COLUMNS_GPS = `${PHOTO_COLUMNS_BASE}, gps_lat, gps_lng`;

// Dated photos first in chronological order, undated ones after. Shared by the
// mapped and unlocated lists so both read chronologically.
function byDateTaken(
  a: { dateTaken: string | null },
  b: { dateTaken: string | null },
): number {
  if (a.dateTaken && b.dateTaken && a.dateTaken !== b.dateTaken) {
    return a.dateTaken < b.dateTaken ? -1 : 1;
  }
  if (a.dateTaken && !b.dateTaken) return -1;
  if (!a.dateTaken && b.dateTaken) return 1;
  return 0;
}

/**
 * Every photo for a user with a resolved map coordinate, plus the count of
 * photos that could not be placed. Three parallel indexed queries (photos,
 * destinations, experiences) joined in memory: the photos table's polymorphic
 * owner_type/owner_id has no foreign key, so PostgREST cannot embed the owner,
 * and at a few hundred photos the in-memory join is trivial.
 */
export async function getPhotoMapData(userId?: string): Promise<PhotoMapData> {
  const supabase = await createClient();

  let resolvedUserId = userId ?? null;
  if (!resolvedUserId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    resolvedUserId = user?.id ?? null;
  }
  if (!resolvedUserId) return { photos: [], unlocatedCount: 0, unlocated: [] };

  const [photosResult, destsResult, expsResult] = await Promise.all([
    supabase
      .from("photos")
      .select(PHOTO_COLUMNS_GPS)
      .eq("user_id", resolvedUserId),
    supabase
      .from("destinations")
      .select("id, trip_id, name, latitude, longitude, order_index, trips ( name )")
      .eq("user_id", resolvedUserId),
    supabase
      .from("experiences")
      .select("id, destination_id, name, geom")
      .eq("user_id", resolvedUserId),
  ]);

  let photoRows = (photosResult.data ?? []) as unknown as PhotoRow[];
  if (photosResult.error) {
    // Databases created before the GPS columns existed reject the select.
    // Retry without them; every photo then falls back to owner coordinates,
    // matching the degrade convention used by the photo insert action.
    const retry = await supabase
      .from("photos")
      .select(PHOTO_COLUMNS_BASE)
      .eq("user_id", resolvedUserId);
    if (retry.error) throw retry.error;
    photoRows = (retry.data ?? []) as unknown as PhotoRow[];
  }
  if (destsResult.error) throw destsResult.error;
  if (expsResult.error) throw expsResult.error;

  const destRows = (destsResult.data ?? []) as unknown as DestRow[];
  const expRows = (expsResult.data ?? []) as unknown as ExpRow[];

  const destById = new Map(destRows.map((row) => [row.id, row]));
  const expById = new Map(expRows.map((row) => [row.id, row]));
  // The first destination (by visit order) with coordinates per trip, so
  // trip-level photos still land somewhere sensible.
  const firstDestByTrip = new Map<string, DestRow>();
  for (const row of [...destRows].sort((a, b) => a.order_index - b.order_index)) {
    if (row.latitude === null || row.longitude === null) continue;
    if (!firstDestByTrip.has(row.trip_id)) firstDestByTrip.set(row.trip_id, row);
  }

  const photos: GlobePhoto[] = [];
  const unlocated: UnlocatedPhoto[] = [];

  for (const row of photoRows) {
    let lat: number | null = null;
    let lng: number | null = null;
    let destinationName: string | null = null;
    let tripName: string | null = null;

    // Owner context (and fallback coordinates) by owner type.
    let ownerDest: DestRow | undefined;
    let expPoint: { lat: number; lng: number } | null = null;
    if (row.owner_type === "destination") {
      ownerDest = destById.get(row.owner_id);
    } else if (row.owner_type === "experience") {
      const exp = expById.get(row.owner_id);
      if (exp) {
        ownerDest = destById.get(exp.destination_id);
        expPoint = exp.geom ? parseEwkbPoint(exp.geom) : null;
      }
    } else {
      ownerDest = firstDestByTrip.get(row.owner_id);
    }
    if (ownerDest) {
      destinationName = row.owner_type === "trip" ? null : ownerDest.name;
      tripName = ownerDest.trips?.name ?? null;
    }

    if (row.gps_lat != null && row.gps_lng != null) {
      lat = row.gps_lat;
      lng = row.gps_lng;
    } else if (expPoint) {
      lat = expPoint.lat;
      lng = expPoint.lng;
    } else if (ownerDest && ownerDest.latitude !== null && ownerDest.longitude !== null) {
      lat = ownerDest.latitude;
      lng = ownerDest.longitude;
    }

    if (lat === null || lng === null) {
      unlocated.push({
        id: row.id,
        thumbUrl: getPhotoUrl(row, "thumb"),
        fullUrl: getPhotoUrl(row),
        dateTaken: row.date_taken,
        attribution: row.attribution,
        destinationName,
        tripName,
      });
      continue;
    }

    photos.push({
      id: row.id,
      lat,
      lng,
      thumbUrl: getPhotoUrl(row, "thumb"),
      fullUrl: getPhotoUrl(row),
      dateTaken: row.date_taken,
      attribution: row.attribution,
      destinationName,
      tripName,
      ownerType: row.owner_type,
      tripId:
        row.owner_type === "trip" ? row.owner_id : ownerDest?.trip_id ?? null,
      destinationId: row.owner_type === "trip" ? null : ownerDest?.id ?? null,
    });
  }

  photos.sort(byDateTaken);
  unlocated.sort(byDateTaken);
  return { photos, unlocatedCount: unlocated.length, unlocated };
}

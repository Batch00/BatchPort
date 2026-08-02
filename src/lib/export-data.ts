import { requireUser } from "@/lib/current-user";
import { getHomeLocation } from "@/lib/home-location";
import { getShareSettings } from "@/lib/share-settings";
import { getPhotoUrl } from "@/lib/photos";
import {
  chronologicalDestinations,
  withResolvedTripDates,
} from "@/lib/trip-dates";
import type { PhotoSource, TripStatus } from "@/lib/types";

// Server-side export builders. Every read runs through requireUser's
// session-scoped client, so RLS restricts the result to the caller's own rows.
// Nothing here takes a userId argument on purpose: there is no way to ask this
// module for somebody else's data.

export const EXPORT_FORMATS = ["json", "geojson"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** "batchport-export-2026-07-29.json" */
export function exportFilename(format: ExportFormat, now = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  return `batchport-export-${date}.${format}`;
}

// --- Row shapes as they come back from PostgREST -----------------------------

interface ExperienceRow {
  id: string;
  destination_id: string;
  name: string;
  rating: number | null;
  visited_date: string | null;
  notes: string | null;
  status?: string | null;
  planned_day?: number | null;
  created_at: string;
  categories: { slug: string; label: string } | null;
}

interface DestinationRow {
  id: string;
  trip_id: string;
  name: string;
  country_code: string | null;
  admin_region: string | null;
  latitude: number | null;
  longitude: number | null;
  arrival_date: string | null;
  departure_date: string | null;
  order_index: number;
  notes: string | null;
  created_at: string;
}

interface TripRow {
  id: string;
  name: string;
  status: TripStatus;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  created_at: string;
}

interface PhotoRow {
  id: string;
  owner_type: string;
  owner_id: string;
  source: PhotoSource;
  storage_path: string | null;
  external_url: string | null;
  attribution: string | null;
  date_taken: string | null;
  created_at: string;
}

interface BucketRow {
  id: string;
  type: string;
  country_code: string | null;
  place_name: string | null;
  priority: number | null;
  target_date: string | null;
  notes?: string | null;
  fulfilled_trip_id: string | null;
  fulfilled_at: string | null;
  created_at: string;
}

interface ExportBundle {
  trips: TripRow[];
  destinations: DestinationRow[];
  experiences: ExperienceRow[];
  photos: PhotoRow[];
  bucket: BucketRow[];
  userId: string;
}

// One pass over the database, shared by both formats.
async function loadBundle(): Promise<ExportBundle> {
  const { supabase, user } = await requireUser();

  // select * on experiences and bucket_list so the export keeps working
  // whether or not the optional-column migrations (experience status and
  // planned_day, bucket notes) have run.
  const [trips, destinations, experiences, photos, bucket] = await Promise.all([
    supabase
      .from("trips")
      .select("id, name, status, start_date, end_date, notes, created_at")
      .order("start_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("destinations")
      .select(
        "id, trip_id, name, country_code, admin_region, latitude, longitude, arrival_date, departure_date, order_index, notes, created_at",
      )
      .order("order_index", { ascending: true }),
    supabase.from("experiences").select("*, categories(slug, label)"),
    supabase
      .from("photos")
      .select(
        "id, owner_type, owner_id, source, storage_path, external_url, attribution, date_taken, created_at",
      ),
    supabase.from("bucket_list").select("*"),
  ]);

  // Both formats walk bundle.destinations in order, and the GeoJSON route
  // LineStrings are literally that order drawn, so the visit-order rule is
  // applied once here rather than in each builder (see lib/trip-dates.ts).
  // Trip ranges are resolved from the same stops for the same reason.
  const destRows = (destinations.data ?? []) as DestinationRow[];
  const byTrip = new Map<string, DestinationRow[]>();
  for (const destination of destRows) {
    const list = byTrip.get(destination.trip_id) ?? [];
    list.push(destination);
    byTrip.set(destination.trip_id, list);
  }
  const orderedDestinations = Array.from(byTrip.values()).flatMap((list) =>
    chronologicalDestinations(list),
  );

  return {
    trips: ((trips.data ?? []) as TripRow[]).map((trip) =>
      withResolvedTripDates(trip, byTrip.get(trip.id) ?? []),
    ),
    destinations: orderedDestinations,
    experiences: (experiences.data ?? []) as unknown as ExperienceRow[],
    photos: (photos.data ?? []) as PhotoRow[],
    bucket: (bucket.data ?? []) as BucketRow[],
    userId: user.id,
  };
}

// Photo URLs in the export are absolute so the file is useful away from the
// app. Uploads resolve to their public Storage URL; wikimedia and url photos
// keep their upstream address rather than the in-app CORS proxy path.
function absolutePhotoUrl(photo: PhotoRow): string | null {
  if (photo.source === "upload") {
    const url = getPhotoUrl({
      source: photo.source,
      storage_path: photo.storage_path,
      external_url: photo.external_url,
    });
    return url || null;
  }
  return photo.external_url;
}

function experienceStatus(row: ExperienceRow): "planned" | "done" {
  return row.status === "planned" ? "planned" : "done";
}

// --- JSON --------------------------------------------------------------------

/** The complete archive: every trip with its nested destinations and
 * experiences, plus the bucket list, photo metadata, and settings. */
export async function buildExportJson(): Promise<string> {
  const bundle = await loadBundle();
  const [settings, home] = await Promise.all([
    getShareSettings(bundle.userId),
    getHomeLocation(bundle.userId),
  ]);

  const photosByOwner = new Map<string, PhotoRow[]>();
  for (const photo of bundle.photos) {
    const key = `${photo.owner_type}:${photo.owner_id}`;
    const list = photosByOwner.get(key) ?? [];
    list.push(photo);
    photosByOwner.set(key, list);
  }
  const photoJson = (ownerType: string, ownerId: string) =>
    (photosByOwner.get(`${ownerType}:${ownerId}`) ?? []).map((photo) => ({
      id: photo.id,
      source: photo.source,
      url: absolutePhotoUrl(photo),
      storage_path: photo.storage_path,
      attribution: photo.attribution,
      date_taken: photo.date_taken,
      created_at: photo.created_at,
    }));

  const experiencesByDestination = new Map<string, ExperienceRow[]>();
  for (const experience of bundle.experiences) {
    const list = experiencesByDestination.get(experience.destination_id) ?? [];
    list.push(experience);
    experiencesByDestination.set(experience.destination_id, list);
  }

  const destinationsByTrip = new Map<string, DestinationRow[]>();
  for (const destination of bundle.destinations) {
    const list = destinationsByTrip.get(destination.trip_id) ?? [];
    list.push(destination);
    destinationsByTrip.set(destination.trip_id, list);
  }

  const payload = {
    exported_at: new Date().toISOString(),
    app: "BatchPort",
    format_version: 1,
    settings: {
      public_share_enabled: settings.public_share_enabled,
      public_slug: settings.public_slug,
      home_location: home
        ? {
            name: home.name,
            country_code: home.country_code,
            latitude: home.lat,
            longitude: home.lng,
          }
        : null,
    },
    trips: bundle.trips.map((trip) => ({
      id: trip.id,
      name: trip.name,
      status: trip.status,
      start_date: trip.start_date,
      end_date: trip.end_date,
      notes: trip.notes,
      created_at: trip.created_at,
      photos: photoJson("trip", trip.id),
      destinations: (destinationsByTrip.get(trip.id) ?? []).map(
        (destination) => ({
          id: destination.id,
          name: destination.name,
          country_code: destination.country_code,
          admin_region: destination.admin_region,
          latitude: destination.latitude,
          longitude: destination.longitude,
          arrival_date: destination.arrival_date,
          departure_date: destination.departure_date,
          order_index: destination.order_index,
          notes: destination.notes,
          created_at: destination.created_at,
          photos: photoJson("destination", destination.id),
          experiences: (
            experiencesByDestination.get(destination.id) ?? []
          ).map((experience) => ({
            id: experience.id,
            name: experience.name,
            category: experience.categories?.slug ?? null,
            category_label: experience.categories?.label ?? null,
            // Stored as a smallint 1-10 where each step is half a star; both
            // forms are emitted so the file needs no decoder ring.
            rating: experience.rating,
            rating_stars:
              experience.rating === null ? null : experience.rating / 2,
            status: experienceStatus(experience),
            planned_day: experience.planned_day ?? null,
            visited_date: experience.visited_date,
            notes: experience.notes,
            created_at: experience.created_at,
            photos: photoJson("experience", experience.id),
          })),
        }),
      ),
    })),
    bucket_list: bundle.bucket.map((item) => ({
      id: item.id,
      type: item.type,
      country_code: item.country_code,
      place_name: item.place_name,
      priority: item.priority,
      target_date: item.target_date,
      notes: item.notes ?? null,
      fulfilled_trip_id: item.fulfilled_trip_id,
      fulfilled_at: item.fulfilled_at,
      created_at: item.created_at,
    })),
  };

  return JSON.stringify(payload, null, 2);
}

// --- GeoJSON -----------------------------------------------------------------

interface PointFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: Record<string, unknown>;
}

interface LineFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: Record<string, unknown>;
}

/** A FeatureCollection any GIS tool or geojson.io can open: one Point per
 * destination and one LineString per trip that has at least two located
 * stops. Coordinates are [lng, lat], per the GeoJSON spec. */
export async function buildExportGeoJson(): Promise<string> {
  const bundle = await loadBundle();

  const tripById = new Map(bundle.trips.map((trip) => [trip.id, trip]));

  const experiencesByDestination = new Map<string, ExperienceRow[]>();
  for (const experience of bundle.experiences) {
    const list = experiencesByDestination.get(experience.destination_id) ?? [];
    list.push(experience);
    experiencesByDestination.set(experience.destination_id, list);
  }

  const photoCountByOwner = new Map<string, number>();
  for (const photo of bundle.photos) {
    const key = `${photo.owner_type}:${photo.owner_id}`;
    photoCountByOwner.set(key, (photoCountByOwner.get(key) ?? 0) + 1);
  }

  const features: (PointFeature | LineFeature)[] = [];
  // Ordered stops per trip, for the route LineStrings.
  const routeByTrip = new Map<string, [number, number][]>();

  for (const destination of bundle.destinations) {
    if (destination.latitude === null || destination.longitude === null) {
      continue;
    }
    const coordinates: [number, number] = [
      destination.longitude,
      destination.latitude,
    ];
    const trip = tripById.get(destination.trip_id) ?? null;
    const experiences = experiencesByDestination.get(destination.id) ?? [];
    const done = experiences.filter(
      (experience) => experienceStatus(experience) === "done",
    );
    const rated = done.filter((experience) => experience.rating !== null);

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates },
      properties: {
        kind: "destination",
        id: destination.id,
        name: destination.name,
        country_code: destination.country_code,
        admin_region: destination.admin_region,
        arrival_date: destination.arrival_date,
        departure_date: destination.departure_date,
        notes: destination.notes,
        trip_id: destination.trip_id,
        trip_name: trip?.name ?? null,
        trip_status: trip?.status ?? null,
        experience_count: done.length,
        // A flat, comma-joined list: nested arrays survive geojson.io but many
        // desktop GIS tools flatten properties to scalars on import.
        experiences: done.map((experience) => experience.name).join(", "),
        avg_rating_stars:
          rated.length === 0
            ? null
            : Number(
                (
                  rated.reduce(
                    (sum, experience) => sum + (experience.rating ?? 0),
                    0,
                  ) /
                  rated.length /
                  2
                ).toFixed(2),
              ),
        photo_count: photoCountByOwner.get(`destination:${destination.id}`) ?? 0,
      },
    });

    const route = routeByTrip.get(destination.trip_id) ?? [];
    route.push(coordinates);
    routeByTrip.set(destination.trip_id, route);
  }

  for (const trip of bundle.trips) {
    const route = routeByTrip.get(trip.id) ?? [];
    // A single stop is a point, not a route; it is already a Point feature.
    if (route.length < 2) continue;
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: route },
      properties: {
        kind: "trip_route",
        id: trip.id,
        name: trip.name,
        status: trip.status,
        start_date: trip.start_date,
        end_date: trip.end_date,
        notes: trip.notes,
        destination_count: route.length,
      },
    });
  }

  return JSON.stringify(
    {
      type: "FeatureCollection",
      // Not part of the spec but widely tolerated, and it makes a downloaded
      // file self-describing.
      metadata: {
        app: "BatchPort",
        exported_at: new Date().toISOString(),
      },
      features,
    },
    null,
    2,
  );
}

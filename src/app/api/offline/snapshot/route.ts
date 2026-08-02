import { NextResponse } from "next/server";

import { requireUser } from "@/lib/current-user";
import { isDemoUser } from "@/lib/demo";
import { getCategories, normalizeExperience } from "@/lib/experiences";
import { DESTINATION_COLUMNS } from "@/lib/destinations";
import { chronologicalDestinations, withResolvedTripDates } from "@/lib/trip-dates";
import { getMapData } from "@/lib/map-data";
import { getPhotoUrl, PHOTO_COLUMNS } from "@/lib/photos";
import { bucketItemName } from "@/lib/bucket-format";
import { toTransportMode } from "@/lib/transport";
import { SNAPSHOT_VERSION } from "@/lib/offline/types";
import type {
  OfflineBucketItem,
  OfflineDestination,
  OfflineSnapshot,
  OfflineTrip,
} from "@/lib/offline/types";
import type {
  DestinationWithExperiences,
  Photo,
  Trip,
} from "@/lib/types";

// GET /api/offline/snapshot
//
// The one read that produces everything the app can show with no connection.
//
// It takes no user parameter, for the same reason search and export do not: it
// reads through requireUser()'s session-scoped client, so RLS is the access
// boundary and no request can name another account. Adding a userId here would
// turn the offline feature into a data leak.
//
// Shape decisions worth knowing:
//
//   - Photos are reduced to thumbnail URLs. The snapshot is a JSON document
//     held in IndexedDB and re-fetched on reconnect, so it carries pointers,
//     not bytes; the bytes live in Cache Storage and only for trips the user
//     explicitly marked available offline.
//   - The globe payload is getMapData() verbatim. The offline shell renders
//     the same Globe component with the same props, so there is no second
//     definition of what the map is.
//   - Journal entries and transport legs degrade to empty. Their tables are
//     behind migrations, and a database without them should produce a snapshot
//     missing those two things rather than no snapshot at all.

export const dynamic = "force-dynamic";

interface JournalRow {
  trip_id: string;
  entry_date: string;
  body: string;
}

interface LegRow {
  trip_id: string;
  destination_id: string;
  mode: string;
}

interface BucketRow {
  id: string;
  type: "country" | "place";
  country_code: string | null;
  place_name: string | null;
  fulfilled_at: string | null;
  countries: { name: string } | null;
}

export async function GET() {
  let session: Awaited<ReturnType<typeof requireUser>>;
  try {
    session = await requireUser();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { supabase, user } = session;

  try {
    const [
      tripsResult,
      destinationsResult,
      journalResult,
      legsResult,
      photosResult,
      bucketResult,
      categories,
      map,
    ] = await Promise.all([
      supabase.from("trips").select("*"),
      supabase.from("destinations").select(`${DESTINATION_COLUMNS}, experiences(*)`),
      supabase.from("journal_entries").select("trip_id, entry_date, body"),
      supabase.from("transport_legs").select("trip_id, destination_id, mode"),
      supabase.from("photos").select(PHOTO_COLUMNS),
      supabase
        .from("bucket_list")
        .select("id, type, country_code, place_name, fulfilled_at, countries(name)"),
      getCategories(),
      getMapData(),
    ]);

    if (tripsResult.error) throw tripsResult.error;
    if (destinationsResult.error) throw destinationsResult.error;

    const trips = (tripsResult.data ?? []) as Trip[];
    const destinationRows = (destinationsResult.data ??
      []) as unknown as DestinationWithExperiences[];
    const photos = (photosResult.data ?? []) as unknown as Photo[];

    // --- Photo indexes ----------------------------------------------------
    // Thumbnails by owner, plus a by-id lookup so an explicit cover pointer
    // resolves the same way the live pages resolve it (a trip cover can be
    // owned by a destination, a destination cover by an experience).
    const photoById = new Map<string, Photo>(
      photos.map((photo) => [photo.id, photo]),
    );
    const thumbsByOwner = new Map<string, string[]>();
    for (const photo of photos) {
      const key = `${photo.owner_type}:${photo.owner_id}`;
      const list = thumbsByOwner.get(key) ?? [];
      list.push(getPhotoUrl(photo, "thumb"));
      thumbsByOwner.set(key, list);
    }
    const coverUrl = (
      coverPhotoId: string | null,
      ownerKey: string,
    ): string | null => {
      if (coverPhotoId) {
        const photo = photoById.get(coverPhotoId);
        if (photo) return getPhotoUrl(photo, "thumb");
      }
      return thumbsByOwner.get(ownerKey)?.[0] ?? null;
    };

    // --- Journal and legs (both degrade to empty) -------------------------
    const journalByTrip = new Map<string, { date: string; body: string }[]>();
    for (const row of (journalResult.error
      ? []
      : ((journalResult.data ?? []) as unknown as JournalRow[]))) {
      const list = journalByTrip.get(row.trip_id) ?? [];
      list.push({ date: row.entry_date.slice(0, 10), body: row.body });
      journalByTrip.set(row.trip_id, list);
    }

    const legsByTrip = new Map<
      string,
      OfflineTrip["legs"]
    >();
    for (const row of (legsResult.error
      ? []
      : ((legsResult.data ?? []) as unknown as LegRow[]))) {
      const mode = toTransportMode(row.mode);
      if (!mode) continue;
      const list = legsByTrip.get(row.trip_id) ?? [];
      list.push({ destinationId: row.destination_id, mode });
      legsByTrip.set(row.trip_id, list);
    }

    // --- Destinations grouped by trip -------------------------------------
    const destinationsByTrip = new Map<string, DestinationWithExperiences[]>();
    for (const row of destinationRows) {
      const list = destinationsByTrip.get(row.trip_id) ?? [];
      list.push(row);
      destinationsByTrip.set(row.trip_id, list);
    }

    const offlineTrips: OfflineTrip[] = trips.map((trip) => {
      const stops = chronologicalDestinations(
        destinationsByTrip.get(trip.id) ?? [],
      );
      const resolved = withResolvedTripDates(trip, stops);

      const destinations: OfflineDestination[] = stops.map(
        (destination, index) => {
          const experiences = (destination.experiences ?? []).map(
            normalizeExperience,
          );
          const ownerKey = `destination:${destination.id}`;
          const thumbUrls = [...(thumbsByOwner.get(ownerKey) ?? [])];
          for (const experience of experiences) {
            const own = thumbsByOwner.get(`experience:${experience.id}`);
            if (own) thumbUrls.push(...own);
          }
          return {
            id: destination.id,
            name: destination.name,
            countryCode: destination.country_code,
            adminRegion: destination.admin_region,
            arrivalDate: destination.arrival_date,
            departureDate: destination.departure_date,
            latitude: destination.latitude,
            longitude: destination.longitude,
            notes: destination.notes,
            // The position in visit order, matching how every other read path
            // re-issues it (see getMapData), not the stored column.
            orderIndex: index,
            coverThumbUrl: coverUrl(destination.cover_photo_id, ownerKey),
            thumbUrls,
            experiences: experiences.map((experience) => ({
              id: experience.id,
              name: experience.name,
              status: experience.status,
              rating: experience.rating,
              visitedDate: experience.visited_date,
              notes: experience.notes,
              plannedDay: experience.planned_day,
              categoryId: experience.category_id,
            })),
          };
        },
      );

      const journal = (journalByTrip.get(trip.id) ?? []).sort((a, b) =>
        a.date < b.date ? -1 : 1,
      );

      return {
        id: trip.id,
        name: trip.name,
        status: trip.status,
        startDate: resolved.start_date,
        endDate: resolved.end_date,
        notes: trip.notes,
        coverThumbUrl: coverUrl(trip.cover_photo_id, `trip:${trip.id}`),
        destinations,
        journal,
        legs: legsByTrip.get(trip.id) ?? [],
      };
    });

    // Newest trip first, undated last: the dashboard's order, so the offline
    // list is not a differently sorted version of the same trips.
    offlineTrips.sort((a, b) => {
      const aStart = a.startDate ?? "";
      const bStart = b.startDate ?? "";
      if (aStart === bStart) return a.name.localeCompare(b.name);
      if (!aStart) return 1;
      if (!bStart) return -1;
      return aStart > bStart ? -1 : 1;
    });

    const bucketRows = bucketResult.error
      ? []
      : ((bucketResult.data ?? []) as unknown as BucketRow[]);
    const bucket: OfflineBucketItem[] = bucketRows.map((row) => ({
      id: row.id,
      type: row.type,
      label: bucketItemName({
        type: row.type,
        country_name: row.countries?.name ?? null,
        country_code: row.country_code,
        place_name: row.place_name,
      }),
      countryCode: row.country_code,
      fulfilled: row.fulfilled_at !== null,
    }));

    const snapshot: OfflineSnapshot = {
      version: SNAPSHOT_VERSION,
      savedAt: new Date().toISOString(),
      userId: user.id,
      email: user.email ?? null,
      demo: isDemoUser(user.id),
      trips: offlineTrips,
      categories,
      bucket,
      map,
    };

    return NextResponse.json(snapshot, {
      // Never store this at any layer between here and IndexedDB: it is one
      // user's whole account, and the client already owns its freshness.
      headers: { "cache-control": "no-store, private" },
    });
  } catch {
    return NextResponse.json(
      { error: "Could not build the offline snapshot" },
      { status: 500 },
    );
  }
}

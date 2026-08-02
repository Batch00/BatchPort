import { createClient } from "@/utils/supabase/server";
import { getMapData, type MapData, type MapDataClient } from "@/lib/map-data";
import { getPhotoMapData, type PhotoMapData } from "@/lib/photo-map-data";
import { getSummaryStats, type SummaryStats } from "@/lib/stats-data";
import { getSharedBucketList, type BucketItem } from "@/lib/bucket-list";
import { getSharedJournalByTrip } from "@/lib/journal-data";
import { getSharedTransportByTrip } from "@/lib/transport-data";
import type { TransportLeg } from "@/lib/transport";
import { getPhotoUrl, resolveCoverPhoto } from "@/lib/photos";
import { chronologicalDestinations, resolveTripDates } from "@/lib/trip-dates";
import { DEMO_USER_ID } from "@/lib/constants";
import type { JournalEntry } from "@/lib/journal";
import type { StoryPhoto } from "@/lib/story";
import type { CoverPosition, PhotoSource } from "@/lib/types";

// Data layer for the public share and demo surfaces. Everything here uses the
// anon/server Supabase client (never the admin client), so the is_shared() RLS
// policy gates access: anon SELECT is granted only when a user has sharing
// enabled or is the demo account. The userId is always passed explicitly.

export interface ProfileExperience {
  id: string;
  name: string;
  rating: number | null;
  /** The day it happened, which is what puts it on a story slide. */
  visited_date: string | null;
  notes: string | null;
  // "planned" ideas render as a read-only checklist row; "done" as a normal
  // logged experience. Rows predating the status column read as "done".
  status: "planned" | "done";
  // Day-planning slot (1 = arrival date), null when unassigned or predating
  // the column. Lets the read-only card group ideas by day.
  planned_day: number | null;
  category: { label: string; icon: string | null; color: string | null } | null;
}

export interface ProfileDestination {
  id: string;
  name: string;
  country_code: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  /** Generated from geom. Null on stops saved without a location; the
   * observed-weather line is simply absent for those. */
  latitude: number | null;
  longitude: number | null;
  coverUrl: string | null;
  cover_position: { x: number; y: number } | null;
  experiences: ProfileExperience[];
}

export interface ProfileTrip {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  notes: string | null;
  coverUrl: string | null;
  // The explicit cover photo id, when set. Lets the dashboard cover editor
  // mark the current cover; the read-only share view ignores it.
  cover_photo_id: string | null;
  cover_position: { x: number; y: number } | null;
  destinations: ProfileDestination[];
  /** Story payload, only populated when getProfileTrips is asked for it (see
   * the `story` option). Empty arrays otherwise, so callers never branch. */
  journal: JournalEntry[];
  photos: StoryPhoto[];
  /** Recorded transport legs, keyed within the card by the stop each arrives
   * at. An array rather than a map so it crosses the server boundary plainly;
   * empty when nothing was recorded or the table does not exist yet. */
  transport: TransportLeg[];
}

/** A fulfilled item's trip cover on the read-only bucket grid. */
export interface SharedBucketCover {
  url: string;
  position: CoverPosition | null;
}

export interface SharedProfile {
  stats: SummaryStats;
  mapData: MapData;
  /** Photos for the globe's photo map mode, anon-readable via is_shared(). */
  photoMapData: PhotoMapData;
  trips: ProfileTrip[];
  bucketItems: BucketItem[];
  /** Fulfilling-trip covers for completed bucket items, keyed by item id. */
  bucketTripCovers: Record<string, SharedBucketCover>;
}

// Resolve a public slug to a user id, but only when that profile is actually
// shared. Returns null for unknown or unshared slugs.
export async function getUserBySlug(slug: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_settings")
    .select("user_id")
    .eq("public_slug", slug)
    .or("public_share_enabled.eq.true,is_demo.eq.true")
    .maybeSingle();
  if (error || !data) return null;
  return (data.user_id as string) ?? null;
}

// The demo user id from user_settings (is_demo = true), falling back to the
// constant if the row is missing. An explicit client lets callers outside a
// request context (the cached landing hero) read through the sessionless anon
// client instead of the cookie-backed one.
export async function getDemoUserId(client?: MapDataClient): Promise<string> {
  const supabase = client ?? (await createClient());
  const { data } = await supabase
    .from("user_settings")
    .select("user_id")
    .eq("is_demo", true)
    .maybeSingle();
  return (data?.user_id as string | undefined) ?? DEMO_USER_ID;
}

// Lightweight counts for share-page metadata.
export async function getShareMeta(
  userId: string,
): Promise<{ countries: number; trips: number }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("v_user_travel_summary")
    .select("countries_visited, total_trips")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    countries: Number(data?.countries_visited) || 0,
    trips: Number(data?.total_trips) || 0,
  };
}

interface ExperienceRow {
  id: string;
  name: string;
  rating: number | null;
  visited_date: string | null;
  notes: string | null;
  created_at: string;
  // Absent until the status column migration runs; missing means "done".
  status?: string | null;
  // Absent until the planned_day migration runs; missing means unassigned.
  planned_day?: number | null;
  categories: {
    label: string;
    icon: string | null;
    color: string | null;
  } | null;
}

interface DestinationRow {
  id: string;
  trip_id: string;
  name: string;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  arrival_date: string | null;
  departure_date: string | null;
  order_index: number;
  cover_photo_id: string | null;
  cover_position: { x: number; y: number } | null;
  experiences: ExperienceRow[];
}

interface TripRow {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  notes: string | null;
  cover_photo_id: string | null;
  cover_position: { x: number; y: number } | null;
}

interface PhotoRow {
  id: string;
  source: PhotoSource;
  storage_path: string | null;
  external_url: string | null;
  thumb_path: string | null;
}

interface FallbackPhotoRow extends PhotoRow {
  owner_type: string;
  owner_id: string;
  // Only selected when the story payload was asked for.
  date_taken?: string | null;
  attribution?: string | null;
}

/** Options for getProfileTrips. `story` adds the journal entries and the full
 * photo list the trip story view interleaves. It is off by default because
 * the dashboard and the share trip cards render neither, and a story's worth
 * of photo rows and journal prose is not worth shipping to a page that only
 * needs cover thumbnails. */
export interface ProfileTripsOptions {
  story?: boolean;
}

// Highest-rated experiences first, then alphabetical, for a tidy showcase.
function sortExperiences(a: ExperienceRow, b: ExperienceRow): number {
  const ar = a.rating ?? -1;
  const br = b.rating ?? -1;
  if (ar !== br) return br - ar;
  return a.name.localeCompare(b.name);
}

// Read-only trips with their destinations and experiences for the share view.
// Anon client plus an explicit user filter, gated by is_shared() RLS.
export async function getProfileTrips(
  userId: string,
  options: ProfileTripsOptions = {},
): Promise<ProfileTrip[]> {
  const supabase = await createClient();
  const wantStory = options.story === true;

  const [tripsResult, destsResult] = await Promise.all([
    supabase
      .from("trips")
      .select("id, name, start_date, end_date, status, notes, cover_photo_id, cover_position")
      .eq("user_id", userId)
      .order("start_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("destinations")
      .select(
        // The experiences embed selects * so a missing status column (before
        // the migration) degrades to undefined instead of erroring.
        "id, trip_id, name, country_code, latitude, longitude, arrival_date, departure_date, order_index, cover_photo_id, cover_position, experiences ( *, categories ( label, icon, color ) )",
      )
      .eq("user_id", userId)
      .order("order_index", { ascending: true }),
  ]);

  if (tripsResult.error) throw tripsResult.error;
  if (destsResult.error) throw destsResult.error;

  const tripRows = (tripsResult.data ?? []) as TripRow[];
  const destRows = (destsResult.data ?? []) as unknown as DestinationRow[];
  if (tripRows.length === 0) return [];

  // Two parallel photo queries: the explicit covers by id (they can be owned
  // by any entity, including experiences), and the trip- and destination-owned
  // photos used as fallbacks when no explicit cover is set. The fallback rows
  // mirror what the trip page shows, so the dashboard cards and the trip
  // detail banner always resolve to the same image.
  const coverIds = Array.from(
    new Set(
      [
        ...tripRows.map((t) => t.cover_photo_id),
        ...destRows.map((d) => d.cover_photo_id),
      ].filter((id): id is string => Boolean(id)),
    ),
  );
  // The story reads photos at every level (an experience's photos are part of
  // that day) and needs the capture date to place them, so it widens both the
  // owner filter and the column list. Without it the query stays exactly as
  // narrow as the covers need.
  const fallbackColumns = wantStory
    ? "id, owner_type, owner_id, source, storage_path, external_url, thumb_path, date_taken, attribution"
    : "id, owner_type, owner_id, source, storage_path, external_url, thumb_path";
  const fallbackOwnerTypes = wantStory
    ? ["trip", "destination", "experience"]
    : ["trip", "destination"];

  const [coversResult, fallbacksResult, journalByTrip, transportByTrip] =
    await Promise.all([
    coverIds.length > 0
      ? supabase
          .from("photos")
          .select("id, source, storage_path, external_url, thumb_path")
          .eq("user_id", userId)
          .in("id", coverIds)
      : Promise.resolve({ data: [] as PhotoRow[] }),
    supabase
      .from("photos")
      .select(fallbackColumns)
      .eq("user_id", userId)
      .in("owner_type", fallbackOwnerTypes)
      .order("order_index", { ascending: true })
      .order("created_at", { ascending: true }),
    wantStory
      ? getSharedJournalByTrip(userId)
      : Promise.resolve(new Map<string, JournalEntry[]>()),
    // Unconditional: legs render on the expanded trip card, not just in the
    // story, and the read is one small query that degrades to empty.
    getSharedTransportByTrip(userId),
  ]);

  const photoById = new Map<string, PhotoRow>();
  // First photo per owner, in gallery order, keyed by "type:id".
  const firstByOwner = new Map<string, PhotoRow>();
  for (const row of (fallbacksResult.data ?? []) as unknown as FallbackPhotoRow[]) {
    photoById.set(row.id, row);
    const key = `${row.owner_type}:${row.owner_id}`;
    if (!firstByOwner.has(key)) firstByOwner.set(key, row);
  }
  for (const photo of (coversResult.data ?? []) as PhotoRow[]) {
    photoById.set(photo.id, photo);
  }
  // Card covers render at card size, so the thumbnail is enough; photos
  // without one resolve to the full image inside getPhotoUrl.
  const thumbUrl = (photo: PhotoRow | null | undefined): string | null =>
    photo ? getPhotoUrl(photo, "thumb") : null;

  // Group destinations under their trip, in visit order. PostgREST can only
  // order by the stored order_index, so the date-aware sequence is applied
  // here, per trip (see lib/trip-dates.ts).
  const rowsByTrip = new Map<string, DestinationRow[]>();
  for (const dest of destRows) {
    const list = rowsByTrip.get(dest.trip_id) ?? [];
    list.push(dest);
    rowsByTrip.set(dest.trip_id, list);
  }
  const orderedDestRows = Array.from(rowsByTrip.values()).flatMap((list) =>
    chronologicalDestinations(list),
  );

  const destsByTrip = new Map<string, ProfileDestination[]>();
  for (const dest of orderedDestRows) {
    const experiences: ProfileExperience[] = [...(dest.experiences ?? [])]
      .sort(sortExperiences)
      .map((exp) => ({
        id: exp.id,
        name: exp.name,
        rating: exp.rating,
        visited_date: exp.visited_date,
        notes: exp.notes ?? null,
        status: (exp.status === "planned" ? "planned" : "done") as
          | "planned"
          | "done",
        planned_day:
          typeof exp.planned_day === "number" ? exp.planned_day : null,
        category: exp.categories
          ? {
              label: exp.categories.label,
              icon: exp.categories.icon,
              color: exp.categories.color,
            }
          : null,
      }));
    const fallback = firstByOwner.get(`destination:${dest.id}`);
    const cover = resolveCoverPhoto(
      photoById,
      fallback ? [fallback] : [],
      dest.cover_photo_id,
    );
    const list = destsByTrip.get(dest.trip_id) ?? [];
    list.push({
      id: dest.id,
      name: dest.name,
      country_code: dest.country_code,
      arrival_date: dest.arrival_date,
      departure_date: dest.departure_date,
      latitude: dest.latitude,
      longitude: dest.longitude,
      coverUrl: thumbUrl(cover?.photo),
      // The stored crop position describes the explicit cover only.
      cover_position: cover?.explicit ? (dest.cover_position ?? null) : null,
      experiences,
    });
    destsByTrip.set(dest.trip_id, list);
  }

  // Story photos, resolved to the stop that owns them. An experience-owned
  // photo resolves through its experience, which is why the destination embed
  // above is the only place that mapping has to exist.
  const storyPhotosByTrip = new Map<string, StoryPhoto[]>();
  if (wantStory) {
    const tripByDestination = new Map<string, string>();
    const destinationByExperience = new Map<string, string>();
    for (const dest of destRows) {
      tripByDestination.set(dest.id, dest.trip_id);
      for (const exp of dest.experiences ?? []) {
        destinationByExperience.set(exp.id, dest.id);
      }
    }
    for (const row of (fallbacksResult.data ?? []) as unknown as FallbackPhotoRow[]) {
      let destinationId: string | null = null;
      let tripId: string | null = null;
      if (row.owner_type === "trip") {
        tripId = row.owner_id;
      } else if (row.owner_type === "destination") {
        destinationId = row.owner_id;
        tripId = tripByDestination.get(row.owner_id) ?? null;
      } else {
        destinationId = destinationByExperience.get(row.owner_id) ?? null;
        tripId = destinationId
          ? tripByDestination.get(destinationId) ?? null
          : null;
      }
      if (!tripId) continue;
      const list = storyPhotosByTrip.get(tripId) ?? [];
      list.push({
        id: row.id,
        url: getPhotoUrl(row),
        thumbUrl: getPhotoUrl(row, "thumb"),
        dateTaken: row.date_taken ?? null,
        attribution: row.attribution ?? null,
        destinationId,
      });
      storyPhotosByTrip.set(tripId, list);
    }
  }

  return tripRows.map((trip) => {
    const destinations = destsByTrip.get(trip.id) ?? [];
    // Same order as the trip detail banner: explicit trip cover, then the
    // first destination's cover, then the first trip-level photo.
    const explicit = trip.cover_photo_id
      ? photoById.get(trip.cover_photo_id)
      : undefined;
    const firstDestCover =
      destinations.find((d) => d.coverUrl)?.coverUrl ?? null;
    const tripFallback = firstByOwner.get(`trip:${trip.id}`);
    // Dated stops define the range; the stored columns are the fallback for a
    // trip nobody has dated a stop on.
    const dates = resolveTripDates(trip, destinations);
    return {
      id: trip.id,
      name: trip.name,
      start_date: dates.start_date,
      end_date: dates.end_date,
      status: trip.status,
      notes: trip.notes,
      coverUrl: thumbUrl(explicit) ?? firstDestCover ?? thumbUrl(tripFallback),
      cover_photo_id: trip.cover_photo_id,
      cover_position: explicit ? (trip.cover_position ?? null) : null,
      destinations,
      journal: journalByTrip.get(trip.id) ?? [],
      photos: storyPhotosByTrip.get(trip.id) ?? [],
      transport: Array.from(
        (transportByTrip.get(trip.id) ?? new Map<string, TransportLeg>()).values(),
      ),
    };
  });
}

// Fulfilled bucket cards prefer the fulfilling trip's cover photo (the memory)
// over the Wikimedia stock image, mirroring the authenticated bucket page.
// Anon client: the photos are readable through the same is_shared() RLS path.
async function getBucketTripCovers(
  userId: string,
  items: BucketItem[],
): Promise<Record<string, SharedBucketCover>> {
  const coverIds = Array.from(
    new Set(
      items
        .map((item) => item.fulfilled_trip_cover_photo_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  if (coverIds.length === 0) return {};

  const supabase = await createClient();
  const { data } = await supabase
    .from("photos")
    .select("id, source, storage_path, external_url, thumb_path")
    .eq("user_id", userId)
    .in("id", coverIds);

  const photoById = new Map(
    ((data ?? []) as PhotoRow[]).map((photo) => [photo.id, photo]),
  );
  const covers: Record<string, SharedBucketCover> = {};
  for (const item of items) {
    if (!item.fulfilled_trip_cover_photo_id) continue;
    const photo = photoById.get(item.fulfilled_trip_cover_photo_id);
    if (!photo) continue;
    covers[item.id] = {
      url: getPhotoUrl(photo),
      position: item.fulfilled_trip_cover_position,
    };
  }
  return covers;
}

// Everything the public/demo surface needs, in parallel. The share view only
// renders summary stats, so it skips the chart and extremes queries entirely.
export async function getSharedProfile(userId: string): Promise<SharedProfile> {
  const [stats, mapData, photoMapData, trips, bucketItems] = await Promise.all([
    getSummaryStats(userId),
    getMapData(userId),
    getPhotoMapData(userId),
    // The read-only surfaces offer the story, so they ask for its payload.
    getProfileTrips(userId, { story: true }),
    getSharedBucketList(userId),
  ]);
  const bucketTripCovers = await getBucketTripCovers(userId, bucketItems);
  return { stats, mapData, photoMapData, trips, bucketItems, bucketTripCovers };
}

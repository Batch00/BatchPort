import { createClient } from "@/utils/supabase/server";
import { getMapData, type MapData } from "@/lib/map-data";
import { getSummaryStats, type SummaryStats } from "@/lib/stats-data";
import { getPhotoUrl } from "@/lib/photos";
import { DEMO_USER_ID } from "@/lib/constants";
import type { PhotoSource } from "@/lib/types";

// Data layer for the public share and demo surfaces. Everything here uses the
// anon/server Supabase client (never the admin client), so the is_shared() RLS
// policy gates access: anon SELECT is granted only when a user has sharing
// enabled or is the demo account. The userId is always passed explicitly.

export interface ProfileExperience {
  id: string;
  name: string;
  rating: number | null;
  category: { label: string; icon: string | null; color: string | null } | null;
}

export interface ProfileDestination {
  id: string;
  name: string;
  country_code: string | null;
  arrival_date: string | null;
  departure_date: string | null;
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
}

export interface SharedProfile {
  stats: SummaryStats;
  mapData: MapData;
  trips: ProfileTrip[];
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
// constant if the row is missing.
export async function getDemoUserId(): Promise<string> {
  const supabase = await createClient();
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
  created_at: string;
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

// Highest-rated experiences first, then alphabetical, for a tidy showcase.
function sortExperiences(a: ExperienceRow, b: ExperienceRow): number {
  const ar = a.rating ?? -1;
  const br = b.rating ?? -1;
  if (ar !== br) return br - ar;
  return a.name.localeCompare(b.name);
}

// Read-only trips with their destinations and experiences for the share view.
// Anon client plus an explicit user filter, gated by is_shared() RLS.
export async function getProfileTrips(userId: string): Promise<ProfileTrip[]> {
  const supabase = await createClient();

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
        "id, trip_id, name, country_code, arrival_date, departure_date, order_index, cover_photo_id, cover_position, experiences ( id, name, rating, visited_date, created_at, categories ( label, icon, color ) )",
      )
      .eq("user_id", userId)
      .order("order_index", { ascending: true }),
  ]);

  if (tripsResult.error) throw tripsResult.error;
  if (destsResult.error) throw destsResult.error;

  const tripRows = (tripsResult.data ?? []) as TripRow[];
  const destRows = (destsResult.data ?? []) as unknown as DestinationRow[];
  if (tripRows.length === 0) return [];

  // Resolve cover photos for trips and destinations in one query.
  const coverIds = Array.from(
    new Set(
      [
        ...tripRows.map((t) => t.cover_photo_id),
        ...destRows.map((d) => d.cover_photo_id),
      ].filter((id): id is string => Boolean(id)),
    ),
  );
  const photoById = new Map<string, PhotoRow>();
  if (coverIds.length > 0) {
    const { data: photos } = await supabase
      .from("photos")
      .select("id, source, storage_path, external_url, thumb_path")
      .eq("user_id", userId)
      .in("id", coverIds);
    for (const photo of (photos ?? []) as PhotoRow[]) {
      photoById.set(photo.id, photo);
    }
  }
  // Card covers render at card size, so the thumbnail is enough; photos
  // without one resolve to the full image inside getPhotoUrl.
  const coverUrl = (id: string | null): string | null => {
    if (!id) return null;
    const photo = photoById.get(id);
    return photo ? getPhotoUrl(photo, "thumb") : null;
  };

  // Group destinations under their trip.
  const destsByTrip = new Map<string, ProfileDestination[]>();
  for (const dest of destRows) {
    const experiences: ProfileExperience[] = [...(dest.experiences ?? [])]
      .sort(sortExperiences)
      .map((exp) => ({
        id: exp.id,
        name: exp.name,
        rating: exp.rating,
        category: exp.categories
          ? {
              label: exp.categories.label,
              icon: exp.categories.icon,
              color: exp.categories.color,
            }
          : null,
      }));
    const list = destsByTrip.get(dest.trip_id) ?? [];
    list.push({
      id: dest.id,
      name: dest.name,
      country_code: dest.country_code,
      arrival_date: dest.arrival_date,
      departure_date: dest.departure_date,
      coverUrl: coverUrl(dest.cover_photo_id),
      cover_position: dest.cover_position ?? null,
      experiences,
    });
    destsByTrip.set(dest.trip_id, list);
  }

  return tripRows.map((trip) => {
    const destinations = destsByTrip.get(trip.id) ?? [];
    const firstDestCover =
      destinations.find((d) => d.coverUrl)?.coverUrl ?? null;
    const hasTripCover = Boolean(trip.cover_photo_id && coverUrl(trip.cover_photo_id));
    return {
      id: trip.id,
      name: trip.name,
      start_date: trip.start_date,
      end_date: trip.end_date,
      status: trip.status,
      notes: trip.notes,
      coverUrl: coverUrl(trip.cover_photo_id) ?? firstDestCover,
      cover_photo_id: trip.cover_photo_id,
      cover_position: hasTripCover ? (trip.cover_position ?? null) : null,
      destinations,
    };
  });
}

// Everything the public/demo surface needs, in parallel. The share view only
// renders summary stats, so it skips the chart and extremes queries entirely.
export async function getSharedProfile(userId: string): Promise<SharedProfile> {
  const [stats, mapData, trips] = await Promise.all([
    getSummaryStats(userId),
    getMapData(userId),
    getProfileTrips(userId),
  ]);
  return { stats, mapData, trips };
}

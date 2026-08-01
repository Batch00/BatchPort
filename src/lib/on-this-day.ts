import { requireUser } from "@/lib/current-user";
import { getPhotoUrl } from "@/lib/photos";
import type { PhotoSource } from "@/lib/types";

// "On this day": photos taken and experiences logged on today's month and day
// in earlier years. A dashboard grace note, so it has to be cheap and it has
// to be absent rather than empty.
//
// Cost, deliberately: Postgres has no index on (month, day) of a date, and
// this app is not adding one for a strip of thumbnails. Instead the query
// enumerates the handful of concrete dates that could match ("2024-08-01",
// "2023-08-01", ...) over a bounded look-back and asks for exactly those. That
// is a bitmap OR over the existing date columns, not a sequential scan with a
// date_part filter, and it returns only rows that will actually be rendered.
// Two such queries run in parallel; the context lookups that follow run only
// when something matched, and only for the ids that did.
//
// Like search and export, these read through requireUser()'s session-scoped
// client and take no userId: RLS is the boundary.

/** How far back to look. Beyond this a "memory" is not one the dashboard is
 * the right place for, and every extra year is another OR term. */
const LOOKBACK_YEARS = 25;

/** A strip, not a feed. */
const MAX_PHOTOS = 12;
const MAX_EXPERIENCES = 6;

export interface OnThisDayPhoto {
  id: string;
  url: string;
  thumbUrl: string;
  dateTaken: string;
  attribution: string | null;
  year: number;
  destinationName: string | null;
  tripName: string | null;
  /** Where tapping through goes: the owning destination, else the trip. */
  href: string | null;
}

export interface OnThisDayExperience {
  id: string;
  name: string;
  rating: number | null;
  year: number;
  destinationName: string | null;
  tripName: string | null;
  href: string | null;
}

export interface OnThisDay {
  /** "August 1", for the heading. */
  label: string;
  photos: OnThisDayPhoto[];
  experiences: OnThisDayExperience[];
}

interface PhotoRow {
  id: string;
  owner_type: string;
  owner_id: string;
  source: PhotoSource;
  storage_path: string | null;
  external_url: string | null;
  thumb_path: string | null;
  attribution: string | null;
  date_taken: string;
}

interface ExperienceRow {
  id: string;
  name: string;
  rating: number | null;
  visited_date: string;
  destination_id: string;
}

interface DestinationRow {
  id: string;
  name: string;
  trip_id: string;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Today's month and day in each of the previous LOOKBACK_YEARS years, newest
 * first. The current year is excluded: today is not yet a memory. */
function anniversaryDates(today: Date): string[] {
  const month = pad(today.getMonth() + 1);
  const day = pad(today.getDate());
  const thisYear = today.getFullYear();
  const dates: string[] = [];
  for (let back = 1; back <= LOOKBACK_YEARS; back += 1) {
    const year = thisYear - back;
    const candidate = `${year}-${month}-${day}`;
    // Feb 29 does not exist in most years; skip rather than silently sliding
    // the memory onto March 1.
    if (new Date(`${candidate}T00:00:00Z`).toISOString().slice(0, 10) === candidate) {
      dates.push(candidate);
    }
  }
  return dates;
}

/**
 * Today's memories, or null when there are none. Callers render nothing on
 * null: there is no "no memories today" card, because a day with nothing in it
 * is the common case and saying so every morning is noise.
 */
export async function getOnThisDay(): Promise<OnThisDay | null> {
  const today = new Date();
  const dates = anniversaryDates(today);
  if (dates.length === 0) return null;

  const { supabase } = await requireUser();

  // date_taken may carry a time, so each anniversary is a one-day range
  // rather than an equality. visited_date is a plain date, so `in` serves.
  const photoFilter = dates
    .map((date) => `and(date_taken.gte.${date},date_taken.lt.${nextDay(date)})`)
    .join(",");

  const [photosResult, experiencesResult] = await Promise.all([
    supabase
      .from("photos")
      .select(
        "id, owner_type, owner_id, source, storage_path, external_url, thumb_path, attribution, date_taken",
      )
      .or(photoFilter)
      .order("date_taken", { ascending: false })
      .limit(MAX_PHOTOS),
    supabase
      .from("experiences")
      .select("id, name, rating, visited_date, destination_id")
      .in("visited_date", dates)
      .order("visited_date", { ascending: false })
      .limit(MAX_EXPERIENCES),
  ]);

  const photoRows = (photosResult.data ?? []) as PhotoRow[];
  const experienceRows = (experiencesResult.data ?? []) as ExperienceRow[];
  if (photoRows.length === 0 && experienceRows.length === 0) return null;

  // --- Context, only for what matched -------------------------------------
  const destinationIds = new Set<string>(
    experienceRows.map((row) => row.destination_id),
  );
  const tripIds = new Set<string>();
  const experiencePhotoIds: string[] = [];
  for (const row of photoRows) {
    if (row.owner_type === "destination") destinationIds.add(row.owner_id);
    else if (row.owner_type === "trip") tripIds.add(row.owner_id);
    else experiencePhotoIds.push(row.owner_id);
  }

  // An experience-owned photo needs one extra hop to reach its destination.
  const destinationByExperience = new Map<string, string>();
  if (experiencePhotoIds.length > 0) {
    const { data } = await supabase
      .from("experiences")
      .select("id, destination_id")
      .in("id", experiencePhotoIds);
    for (const row of (data ?? []) as { id: string; destination_id: string }[]) {
      destinationByExperience.set(row.id, row.destination_id);
      destinationIds.add(row.destination_id);
    }
  }

  const destinationById = new Map<string, DestinationRow>();
  if (destinationIds.size > 0) {
    const { data } = await supabase
      .from("destinations")
      .select("id, name, trip_id")
      .in("id", Array.from(destinationIds));
    for (const row of (data ?? []) as DestinationRow[]) {
      destinationById.set(row.id, row);
      tripIds.add(row.trip_id);
    }
  }

  const tripNameById = new Map<string, string>();
  if (tripIds.size > 0) {
    const { data } = await supabase
      .from("trips")
      .select("id, name")
      .in("id", Array.from(tripIds));
    for (const row of (data ?? []) as { id: string; name: string }[]) {
      tripNameById.set(row.id, row.name);
    }
  }

  function context(destinationId: string | null, tripId: string | null) {
    const destination = destinationId
      ? destinationById.get(destinationId) ?? null
      : null;
    const resolvedTripId = destination?.trip_id ?? tripId;
    return {
      destinationName: destination?.name ?? null,
      tripName: resolvedTripId
        ? tripNameById.get(resolvedTripId) ?? null
        : null,
      href: destination
        ? `/trips/${destination.trip_id}/destinations/${destination.id}`
        : resolvedTripId
          ? `/trips/${resolvedTripId}`
          : null,
    };
  }

  const photos: OnThisDayPhoto[] = photoRows.map((row) => {
    const destinationId =
      row.owner_type === "destination"
        ? row.owner_id
        : destinationByExperience.get(row.owner_id) ?? null;
    const tripId = row.owner_type === "trip" ? row.owner_id : null;
    return {
      id: row.id,
      url: getPhotoUrl(row),
      thumbUrl: getPhotoUrl(row, "thumb"),
      dateTaken: row.date_taken,
      attribution: row.attribution,
      year: Number(row.date_taken.slice(0, 4)),
      ...context(destinationId, tripId),
    };
  });

  const experiences: OnThisDayExperience[] = experienceRows.map((row) => ({
    id: row.id,
    name: row.name,
    rating: row.rating,
    year: Number(row.visited_date.slice(0, 4)),
    ...context(row.destination_id, null),
  }));

  return {
    label: today.toLocaleDateString("en-US", { month: "long", day: "numeric" }),
    photos,
    experiences,
  };
}

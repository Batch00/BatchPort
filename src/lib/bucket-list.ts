import { cache } from "react";

import { requireUser } from "@/lib/current-user";
import { createClient } from "@/utils/supabase/server";
import { parseEwkbPoint } from "@/lib/geo";
import { compareByDateTaken } from "@/lib/photos";
import {
  resolveBucketCovers,
  type BucketCover,
  type BucketCoverPhoto,
  type BucketCoverStop,
  type BucketCoverTrip,
} from "@/lib/bucket-cover";
import type { CoverPosition, Photo } from "@/lib/types";

type BucketClient = Awaited<ReturnType<typeof createClient>>;

// Server-side data layer for the bucket list. Reads run with the user's session
// (RLS scopes them); the userId argument lets callers fetch a specific user's
// data for demo or public-share views. Mutations live in actions/bucket-list.ts.

export type BucketType = "country" | "place";

export interface BucketItem {
  id: string;
  type: BucketType;
  country_code: string | null;
  country_name: string | null;
  place_name: string | null;
  /** Rank weight: higher sorts first. Written by drag-to-rank. */
  priority: number | null;
  target_date: string | null;
  /** Why this place. Null until the notes column migration has run. */
  notes: string | null;
  /** Stored coordinates for place items, when saved with them. */
  lat: number | null;
  lng: number | null;
  fulfilled_trip_id: string | null;
  fulfilled_trip_name: string | null;
  /**
   * The photograph a fulfilled card shows, most specific first: the matching
   * stop's cover, its first photo, then the trip cover. Null when none exists
   * (the card keeps its Wikimedia hero). See lib/bucket-cover.ts.
   */
  fulfilled_cover: BucketCover | null;
  fulfilled_at: string | null;
  created_at: string;
}

export interface BucketStats {
  total: number;
  fulfilled: number;
  completion_pct: number;
}

export interface CountryOption {
  code: string;
  name: string;
}

// The shape the dialog sends when creating or editing an item.
export interface BucketItemInput {
  type: BucketType;
  country_code: string | null;
  place_name: string | null;
  lat: number | null;
  lng: number | null;
  priority: number | null;
  target_date: string | null;
  notes: string | null;
}

// The base row uses * so the read keeps working whether or not the optional
// notes column migration has run; missing columns simply read as undefined.
const SELECT =
  "*, countries(name), fulfilling_trip:trips!fulfilled_trip_id(name, cover_photo_id, cover_position)";

interface BucketRow {
  id: string;
  type: string;
  country_code: string | null;
  place_name: string | null;
  priority: number | null;
  target_date: string | null;
  notes?: string | null;
  geom: string | null;
  fulfilled_trip_id: string | null;
  fulfilled_at: string | null;
  created_at: string;
  countries: { name: string } | null;
  fulfilling_trip: {
    name: string;
    cover_photo_id: string | null;
    cover_position: CoverPosition | null;
  } | null;
}

async function resolveUserId(userId?: string): Promise<string> {
  const { user } = await requireUser();
  return userId ?? user.id;
}

// The shared query and row mapping behind both the authenticated and the
// public (share/demo) bucket reads.
async function fetchBucketList(
  supabase: BucketClient,
  uid: string,
): Promise<BucketItem[]> {
  const { data, error } = await supabase
    .from("bucket_list")
    .select(SELECT)
    .eq("user_id", uid)
    .order("fulfilled_at", { ascending: true, nullsFirst: true })
    .order("priority", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as unknown as BucketRow[];
  const items: BucketItem[] = rows.map((row) => {
    const point = row.geom ? parseEwkbPoint(row.geom) : null;
    return {
      id: row.id,
      type: (row.type === "place" ? "place" : "country") as BucketType,
      country_code: row.country_code,
      country_name: row.countries?.name ?? null,
      place_name: row.place_name,
      priority: row.priority,
      target_date: row.target_date,
      notes: row.notes ?? null,
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
      fulfilled_trip_id: row.fulfilled_trip_id,
      fulfilled_trip_name: row.fulfilling_trip?.name ?? null,
      fulfilled_cover: null,
      fulfilled_at: row.fulfilled_at,
      created_at: row.created_at,
    };
  });

  const tripById = new Map<string, BucketCoverTrip>();
  for (const row of rows) {
    if (row.fulfilled_trip_id && row.fulfilling_trip) {
      tripById.set(row.fulfilled_trip_id, row.fulfilling_trip);
    }
  }
  const covers = await fetchFulfilledCovers(supabase, uid, items, tripById);
  for (const item of items) item.fulfilled_cover = covers.get(item.id) ?? null;
  return items;
}

const COVER_PHOTO_COLUMNS =
  "id, source, storage_path, external_url, thumb_path";

// The photographs behind fulfilled cards, in three batched reads whatever the
// list's size: the fulfilling trips' stops, the covers they and the trips
// point at, then the photos of matching stops that have no usable cover (the
// only ones the fallback reaches). Best-effort: a failed read degrades the
// affected cards to the Wikimedia hero rather than failing the list.
async function fetchFulfilledCovers(
  supabase: BucketClient,
  uid: string,
  items: BucketItem[],
  tripById: Map<string, BucketCoverTrip>,
): Promise<Map<string, BucketCover>> {
  const tripIds = Array.from(
    new Set(
      items
        .map((item) => (item.fulfilled_at ? item.fulfilled_trip_id : null))
        .filter((id): id is string => Boolean(id)),
    ),
  );
  if (tripIds.length === 0) return new Map();

  const { data: stopData, error: stopError } = await supabase
    .from("destinations")
    .select(
      "id, trip_id, name, country_code, latitude, longitude, arrival_date, departure_date, order_index, cover_photo_id, cover_position",
    )
    .eq("user_id", uid)
    .in("trip_id", tripIds);
  if (stopError) {
    console.warn("Bucket covers: stop read failed:", stopError.message);
  }
  const stopsByTrip = new Map<string, BucketCoverStop[]>();
  for (const stop of (stopData ?? []) as BucketCoverStop[]) {
    const list = stopsByTrip.get(stop.trip_id) ?? [];
    list.push(stop);
    stopsByTrip.set(stop.trip_id, list);
  }

  const coverIds = new Set<string>();
  for (const stops of stopsByTrip.values()) {
    for (const stop of stops) {
      if (stop.cover_photo_id) coverIds.add(stop.cover_photo_id);
    }
  }
  for (const trip of tripById.values()) {
    if (trip.cover_photo_id) coverIds.add(trip.cover_photo_id);
  }
  const photoById = new Map<string, BucketCoverPhoto>();
  if (coverIds.size > 0) {
    const { data, error } = await supabase
      .from("photos")
      .select(COVER_PHOTO_COLUMNS)
      .eq("user_id", uid)
      .in("id", Array.from(coverIds));
    if (error) console.warn("Bucket covers: cover read failed:", error.message);
    for (const photo of (data ?? []) as BucketCoverPhoto[]) {
      photoById.set(photo.id, photo);
    }
  }

  // First pass without fallback photos, to learn which items still need one.
  // An item resolved from a stop cover never reaches the fallback, so only the
  // stops of unresolved items are worth reading photos for.
  const firstPass = resolveBucketCovers(
    items,
    stopsByTrip,
    new Map(),
    photoById,
    new Map(),
  );
  const fallbackStopIds = new Set<string>();
  for (const item of items) {
    if (!item.fulfilled_at || !item.fulfilled_trip_id) continue;
    if (firstPass.has(item.id)) continue;
    for (const stop of stopsByTrip.get(item.fulfilled_trip_id) ?? []) {
      fallbackStopIds.add(stop.id);
    }
  }
  const firstPhotoByStop = new Map<string, BucketCoverPhoto>();
  if (fallbackStopIds.size > 0) {
    const { data, error } = await supabase
      .from("photos")
      .select(`${COVER_PHOTO_COLUMNS}, owner_id, date_taken, order_index, created_at`)
      .eq("user_id", uid)
      .eq("owner_type", "destination")
      .in("owner_id", Array.from(fallbackStopIds));
    if (error) console.warn("Bucket covers: photo read failed:", error.message);
    // Gallery order, so "first photo" is the one the stop's gallery leads with.
    const photos = ((data ?? []) as (Photo & { owner_id: string })[]).sort(
      compareByDateTaken,
    );
    for (const photo of photos) {
      if (!firstPhotoByStop.has(photo.owner_id)) {
        firstPhotoByStop.set(photo.owner_id, photo);
      }
    }
  }

  return resolveBucketCovers(
    items,
    stopsByTrip,
    tripById,
    photoById,
    firstPhotoByStop,
  );
}

// All bucket items for the user: unfulfilled first, then highest priority, then
// newest. Country and trip names come from joined reference rows.
export async function getBucketList(userId?: string): Promise<BucketItem[]> {
  const { supabase } = await requireUser();
  const uid = await resolveUserId(userId);
  return fetchBucketList(supabase, uid);
}

// Sessionless read for the share and demo surfaces: the anon server client
// triggers the is_shared() RLS helper, so rows come back only for profiles
// with sharing enabled or the demo account. Never use the admin client here.
export async function getSharedBucketList(
  userId: string,
): Promise<BucketItem[]> {
  const supabase = await createClient();
  return fetchBucketList(supabase, userId);
}

// Completion totals from the SQL view, or null when the user has no items.
export async function getBucketListStats(
  userId?: string,
): Promise<BucketStats | null> {
  const { supabase } = await requireUser();
  const uid = await resolveUserId(userId);

  const { data, error } = await supabase
    .from("v_bucket_completion")
    .select("total, fulfilled, completion_pct")
    .eq("user_id", uid)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    total: Number(data.total) || 0,
    fulfilled: Number(data.fulfilled) || 0,
    completion_pct: Number(data.completion_pct) || 0,
  };
}

// The reference list of countries for the add/edit dialog dropdown. Static
// reference data; cache() dedupes repeat calls within one request.
export const getCountries = cache(async (): Promise<CountryOption[]> => {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("countries")
    .select("code, name")
    .order("name", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as { code: string; name: string }[]).map((row) => ({
    code: row.code,
    name: row.name,
  }));
});

// Distinct country codes of unfulfilled country-type items, for the globe's
// "want to visit" fill layer.
export async function getBucketCountryCodes(userId?: string): Promise<string[]> {
  const { supabase } = await requireUser();
  const uid = await resolveUserId(userId);

  const { data, error } = await supabase
    .from("bucket_list")
    .select("country_code")
    .eq("user_id", uid)
    .eq("type", "country")
    .is("fulfilled_at", null);
  if (error) throw error;
  return Array.from(
    new Set(
      ((data ?? []) as { country_code: string | null }[])
        .map((row) => row.country_code)
        .filter((code): code is string => Boolean(code)),
    ),
  );
}

// Best-effort: fulfill every unfulfilled bucket item the signed-in user's
// completed or ongoing trips now reach. The match rule (country code for
// country items, 25km ST_DWithin for place items, earliest visit wins, the
// visit's own date as fulfilled_at) lives in ONE place, the SQL view
// v_bucket_fulfillment_matches, which the one-off backfill reads too. See
// scripts/sql/2026-09-28-bucket-fulfillment.sql.
//
// Called after a destination create or edit and after a trip edit (a planned
// trip flipped to completed is the common way a match appears). The callers
// swallow errors; this logs rather than throwing where it can, so a database
// without the view degrades to no auto-fulfillment rather than a failed save.
export async function autoFulfillBucketItems(): Promise<void> {
  const { supabase, user } = await requireUser();

  const { data, error } = await supabase
    .from("v_bucket_fulfillment_matches")
    .select("bucket_id, trip_id, fulfilled_on")
    .eq("user_id", user.id);
  if (error) {
    console.warn("Bucket auto-fulfill: match read failed:", error.message);
    return;
  }
  const matches = (data ?? []) as {
    bucket_id: string;
    trip_id: string;
    fulfilled_on: string;
  }[];

  const results = await Promise.all(
    matches.map((match) =>
      supabase
        .from("bucket_list")
        .update({
          fulfilled_trip_id: match.trip_id,
          // A YYYY-MM-DD: the visit day, never the moment this ran.
          fulfilled_at: match.fulfilled_on,
        })
        .eq("id", match.bucket_id)
        .eq("user_id", user.id)
        // A manual fulfillment between the read and this write wins.
        .is("fulfilled_at", null),
    ),
  );
  for (const result of results) {
    if (result.error) {
      console.warn("Bucket auto-fulfill: update failed:", result.error.message);
    }
  }
}

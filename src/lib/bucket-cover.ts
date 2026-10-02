import { haversineKm, placeKey } from "@/lib/geo";
import { getPhotoUrl } from "@/lib/photos";
import { chronologicalDestinations } from "@/lib/trip-dates";
import type { CoverPosition, Photo } from "@/lib/types";

// Which photograph a FULFILLED bucket card shows. Pure and client-safe; the
// batched reads that feed it live in fetchBucketList (lib/bucket-list.ts), so
// every surface that renders a fulfilled item (the bucket page, the share and
// demo grid, the recap's "ticked off" tiles) reads one resolved field and they
// cannot disagree.
//
// It used to be the fulfilling trip's cover, which made one trip through four
// bucket-list countries print the same picture on four cards. The most
// specific image wins instead:
//
//   1. the cover of the trip's stop that answers the item: for a country, the
//      earliest stop in that country that has a cover; for a place, the
//      matching stop (closest first),
//   2. the first photo of a matching stop,
//   3. the trip cover,
//   4. nothing, and the card keeps its Wikimedia hero.
//
// A place matches by the same rule v_bucket_fulfillment_matches uses: within
// 25km, its country code ignored. That view only lists UNFULFILLED items, so
// it cannot be asked after the fact; the radius is repeated here and must move
// with it. A place item saved without coordinates (manual fulfillment) falls
// back to a name match, which is the only identity it has.

/** The fulfillment view's place radius (st_dwithin 25000 metres). */
export const BUCKET_PLACE_MATCH_KM = 25;

export interface BucketCover {
  /** Full image, for the bucket cards. */
  url: string;
  /** Gallery thumbnail, for small tiles (the recap's closing slide). */
  thumbUrl: string;
  /** The crop of whichever cover answered; null for a plain photo. */
  position: CoverPosition | null;
  /** Which step of the chain answered, for anyone debugging a card. */
  source: "destination" | "destination-photo" | "trip";
}

export type BucketCoverPhoto = Pick<
  Photo,
  "id" | "source" | "storage_path" | "external_url" | "thumb_path"
>;

export interface BucketCoverStop {
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
  cover_position: CoverPosition | null;
}

export interface BucketCoverItem {
  id: string;
  type: "country" | "place";
  country_code: string | null;
  place_name: string | null;
  lat: number | null;
  lng: number | null;
  fulfilled_trip_id: string | null;
  fulfilled_at: string | null;
}

export interface BucketCoverTrip {
  cover_photo_id: string | null;
  cover_position: CoverPosition | null;
}

/**
 * The fulfilling trip's stops that answer an item, most specific first:
 * a country's stops in visit order, a place's stops by distance (or, with no
 * coordinates on either side, by name in visit order).
 */
export function matchingStops(
  item: BucketCoverItem,
  tripStops: BucketCoverStop[],
): BucketCoverStop[] {
  const ordered = chronologicalDestinations(tripStops);
  if (item.type === "country") {
    if (!item.country_code) return [];
    const code = item.country_code.toUpperCase();
    return ordered.filter((stop) => stop.country_code?.toUpperCase() === code);
  }

  const byDistance: { stop: BucketCoverStop; km: number }[] = [];
  if (item.lat !== null && item.lng !== null) {
    for (const stop of ordered) {
      if (stop.latitude === null || stop.longitude === null) continue;
      const km = haversineKm(item.lat, item.lng, stop.latitude, stop.longitude);
      if (km <= BUCKET_PLACE_MATCH_KM) byDistance.push({ stop, km });
    }
  }
  if (byDistance.length > 0) {
    // Stable sort: equal distances keep visit order.
    return byDistance.sort((a, b) => a.km - b.km).map((entry) => entry.stop);
  }
  if (!item.place_name) return [];
  const key = placeKey(item.place_name, null);
  return ordered.filter((stop) => placeKey(stop.name, null) === key);
}

function coverOf(
  photo: BucketCoverPhoto,
  position: CoverPosition | null,
  source: BucketCover["source"],
): BucketCover {
  return {
    url: getPhotoUrl(photo),
    thumbUrl: getPhotoUrl(photo, "thumb"),
    position,
    source,
  };
}

/**
 * Covers for every fulfilled item, keyed by item id. Items with no fulfilling
 * trip, or nothing to show, are absent.
 *
 * `firstPhotoByStop` holds each stop's first photo in gallery order, and only
 * needs entries for stops the chain may reach (matching stops with no usable
 * cover); `photoById` holds the cover photos.
 */
export function resolveBucketCovers(
  items: BucketCoverItem[],
  stopsByTrip: Map<string, BucketCoverStop[]>,
  tripById: Map<string, BucketCoverTrip>,
  photoById: Map<string, BucketCoverPhoto>,
  firstPhotoByStop: Map<string, BucketCoverPhoto>,
): Map<string, BucketCover> {
  const covers = new Map<string, BucketCover>();
  for (const item of items) {
    if (!item.fulfilled_at || !item.fulfilled_trip_id) continue;
    const stops = matchingStops(
      item,
      stopsByTrip.get(item.fulfilled_trip_id) ?? [],
    );

    let cover: BucketCover | null = null;
    for (const stop of stops) {
      const photo = stop.cover_photo_id
        ? photoById.get(stop.cover_photo_id)
        : undefined;
      if (photo) {
        cover = coverOf(photo, stop.cover_position, "destination");
        break;
      }
    }
    if (!cover) {
      for (const stop of stops) {
        const photo = firstPhotoByStop.get(stop.id);
        if (photo) {
          cover = coverOf(photo, null, "destination-photo");
          break;
        }
      }
    }
    if (!cover) {
      const trip = tripById.get(item.fulfilled_trip_id);
      const photo = trip?.cover_photo_id
        ? photoById.get(trip.cover_photo_id)
        : undefined;
      if (trip && photo) cover = coverOf(photo, trip.cover_position, "trip");
    }
    if (cover) covers.set(item.id, cover);
  }
  return covers;
}

"use client";

// Per-trip "available offline": the explicit, bounded, removable version of
// caching everything.
//
// What the toggle actually does, and what it deliberately does not:
//
//   - Trip DATA is not what it controls. The snapshot already carries every
//     trip, because trip rows are small (a year of travel is well under a
//     megabyte of JSON) and a toggle that decides whether a trip is readable
//     offline would fail exactly the user who forgot to flip it. The toggle is
//     about the expensive part: photos.
//   - It warms this trip's photo THUMBNAILS into a dedicated Cache Storage
//     bucket, capped, with the count and an approximate size shown before and
//     after. Full-size images stay on demand: they are five to fifty times the
//     bytes for a view the user may never open.
//   - It does NOT pre-download map tiles. MapTiler's Cloud terms permit "a
//     temporary personal cache (browser cache, mobile app cache, etc.) for use
//     by a single end-user" but prohibit "batch or excessive bulk download of
//     map tiles". Warming a bounding box at several zooms is bulk download by
//     any reading of that sentence, so the service worker caches only tiles
//     the user has already looked at, and this toggle says so rather than
//     quietly doing less than its label claims. The keyless dark basemap and
//     the countries GeoJSON are local static files and are precached in full,
//     so the globe itself always works offline.

import {
  APPROX_THUMB_BYTES,
  MAX_THUMBS_PER_TRIP,
  PHOTO_CACHE,
} from "./constants";
import { META_OFFLINE_TRIPS, metaGet, metaPut } from "./db";

/** What was stored for one trip marked available offline. */
export interface OfflineTripRecord {
  savedAt: number;
  /** Thumbnails actually cached (a failed fetch is not counted). */
  photoCount: number;
  /** Every URL this trip put in the photo cache, so removal takes back exactly
   * what it added and nothing another trip still needs. */
  urls: string[];
}

export type OfflineTripMap = Record<string, OfflineTripRecord>;

export async function readOfflineTrips(): Promise<OfflineTripMap> {
  return (await metaGet<OfflineTripMap>(META_OFFLINE_TRIPS)) ?? {};
}

function cachesAvailable(): boolean {
  return typeof caches !== "undefined";
}

/** Human-readable approximate size of a cached trip. */
export function approxSize(photoCount: number): string {
  const bytes = photoCount * APPROX_THUMB_BYTES;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface WarmResult {
  ok: boolean;
  photoCount: number;
  /** True when the trip has more thumbnails than the per-trip cap, so the UI
   * can say how many it took rather than implying it took them all. */
  capped: boolean;
  error: string | null;
}

/**
 * Fetch and store this trip's thumbnails. Individual failures are tolerated
 * (a photo that 404s should not fail the whole trip); a total failure to open
 * Cache Storage is reported, because the toggle would otherwise claim an
 * offline copy that does not exist.
 */
export async function warmTrip(
  tripId: string,
  thumbUrls: string[],
): Promise<WarmResult> {
  if (!cachesAvailable()) {
    return {
      ok: false,
      photoCount: 0,
      capped: false,
      error: "This browser cannot store photos offline.",
    };
  }

  const capped = thumbUrls.length > MAX_THUMBS_PER_TRIP;
  const wanted = thumbUrls.slice(0, MAX_THUMBS_PER_TRIP);

  let cache: Cache;
  try {
    cache = await caches.open(PHOTO_CACHE);
  } catch {
    return {
      ok: false,
      photoCount: 0,
      capped,
      error: "Could not open offline storage.",
    };
  }

  const stored: string[] = [];
  // Sequential in small batches rather than one addAll: addAll rejects the
  // whole set if any single request fails, and one dead thumbnail should not
  // cost the user the other 299.
  const BATCH = 6;
  for (let i = 0; i < wanted.length; i += BATCH) {
    const batch = wanted.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (url) => {
        try {
          const response = await fetch(url, { mode: "cors" });
          if (!response.ok) return;
          await cache.put(url, response);
          stored.push(url);
        } catch {
          // Skip this one; the count reported reflects what actually landed.
        }
      }),
    );
  }

  const trips = await readOfflineTrips();
  trips[tripId] = { savedAt: Date.now(), photoCount: stored.length, urls: stored };
  const written = await metaPut(META_OFFLINE_TRIPS, trips);
  if (!written) {
    return {
      ok: false,
      photoCount: stored.length,
      capped,
      error: "Could not record the offline copy.",
    };
  }

  return { ok: true, photoCount: stored.length, capped, error: null };
}

/** Drop this trip's offline photos. Only URLs no other cached trip still lists
 * are actually evicted, so removing one trip cannot blank another's gallery. */
export async function removeTrip(tripId: string): Promise<void> {
  const trips = await readOfflineTrips();
  const record = trips[tripId];
  delete trips[tripId];
  await metaPut(META_OFFLINE_TRIPS, trips);

  if (!record || !cachesAvailable()) return;

  const stillNeeded = new Set<string>();
  for (const other of Object.values(trips)) {
    for (const url of other.urls) stillNeeded.add(url);
  }

  try {
    const cache = await caches.open(PHOTO_CACHE);
    await Promise.all(
      record.urls
        .filter((url) => !stillNeeded.has(url))
        .map((url) => cache.delete(url).catch(() => false)),
    );
  } catch {
    // The record is already gone, so the toggle reads as off. Leftover cache
    // entries are harmless and the browser evicts them under pressure.
  }
}

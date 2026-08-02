// The offline snapshot: everything the app can read with no connection.
//
// Why a snapshot rather than cached RSC payloads. BatchPort is server-rendered
// and mutates through server actions, so the thing a page produces on the wire
// is an RSC flight payload keyed by a URL, a router state, and a build id. To
// serve those offline the service worker would have to cache one opaque blob
// per route it ever saw, and none of them would survive a deploy (the build id
// is baked in), be readable by anything (a flight payload is not data), or
// cover a trip the user never happened to open while online. A snapshot is the
// opposite on all four counts: one versioned document, deploy-independent,
// queryable, and complete for every trip whether or not it was visited.
//
// The cost is that the offline reading surface is its own shell (/offline)
// rather than the live pages. That is the honest trade: the live pages need a
// server to render, and pretending otherwise is where offline PWAs usually
// start lying about what they have.
//
// Shapes here are deliberately flat and self-contained (URLs already resolved,
// no PostGIS, no joins to follow), because the reader is a client component
// with no data layer underneath it.

import type { Category } from "@/lib/types";
import type { MapData } from "@/lib/map-data";
import type { TransportMode } from "@/lib/transport";
import type { ExperienceStatus, TripStatus } from "@/lib/types";

/** Bumped whenever the snapshot shape changes. A snapshot written by an older
 * version is discarded on read rather than migrated: it is a cache of server
 * data, so throwing it away costs one refetch and nothing else. */
export const SNAPSHOT_VERSION = 1;

export interface OfflineExperience {
  id: string;
  name: string;
  status: ExperienceStatus;
  rating: number | null;
  visitedDate: string | null;
  notes: string | null;
  plannedDay: number | null;
  categoryId: string | null;
}

export interface OfflineDestination {
  id: string;
  name: string;
  countryCode: string | null;
  adminRegion: string | null;
  arrivalDate: string | null;
  departureDate: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  orderIndex: number;
  /** Thumbnail of this stop's cover, already resolved to an absolute URL. */
  coverThumbUrl: string | null;
  /** Every thumbnail owned by this stop (and its experiences). This is the
   * list the per-trip "available offline" toggle warms into the photo cache;
   * it is URLs only, so the snapshot itself stays small. */
  thumbUrls: string[];
  experiences: OfflineExperience[];
}

export interface OfflineJournalEntry {
  date: string;
  body: string;
}

export interface OfflineTrip {
  id: string;
  name: string;
  status: TripStatus;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  coverThumbUrl: string | null;
  destinations: OfflineDestination[];
  journal: OfflineJournalEntry[];
  /** How each stop was reached, keyed by the arriving destination id (the
   * transport model: a leg belongs to the stop it arrives at). */
  legs: { destinationId: string; mode: TransportMode }[];
}

export interface OfflineBucketItem {
  id: string;
  type: string;
  label: string;
  countryCode: string | null;
  fulfilled: boolean;
}

export interface OfflineSnapshot {
  version: number;
  /** ISO timestamp of the read that produced this snapshot. */
  savedAt: string;
  userId: string;
  email: string | null;
  /** True for the read-only demo account, so the offline shell hides writes
   * for the same reason the live app does. */
  demo: boolean;
  trips: OfflineTrip[];
  categories: Category[];
  bucket: OfflineBucketItem[];
  /** The globe payload, reused verbatim so the offline map is the same map. */
  map: MapData;
}

/** Every thumbnail URL on one trip, for the per-trip photo warm-up. */
export function tripThumbUrls(trip: OfflineTrip): string[] {
  const urls = new Set<string>();
  if (trip.coverThumbUrl) urls.add(trip.coverThumbUrl);
  for (const destination of trip.destinations) {
    if (destination.coverThumbUrl) urls.add(destination.coverThumbUrl);
    for (const url of destination.thumbUrls) urls.add(url);
  }
  return Array.from(urls);
}

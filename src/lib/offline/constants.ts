// Offline constants shared by the client modules and the service worker's
// companion code. Values with a reason attached, so a future change is a
// decision rather than a tweak.

/** How old a stored snapshot may get before a reconnect refreshes it. Fifteen
 * minutes is short enough that the offline shell rarely shows something the
 * user changed this session, and long enough that opening five pages in a row
 * does not re-fetch the whole account five times. */
export const METADATA_STALE_MS = 15 * 60 * 1000;

/** The route the service worker serves when a navigation fails offline. */
export const OFFLINE_ROUTE = "/offline";

/**
 * Cache name for photo thumbnails warmed by the per-trip "available offline"
 * toggle. It is separate from the shell and tile caches so a user removing a
 * trip's offline copy cannot evict the app itself, and so the activate-time
 * cleanup can keep it across deploys (it holds user content, not build output).
 */
export const PHOTO_CACHE = "batchport-photos-v1";

/**
 * How many thumbnails one trip may warm. A stop's gallery is rarely past a
 * few dozen photos and a thumbnail is around 30KB, so 300 caps a single trip
 * near 10MB: enough for a real trip, small enough that three cached trips do
 * not threaten a phone's storage bucket. Past the cap the toggle still works
 * and says how many it took.
 */
export const MAX_THUMBS_PER_TRIP = 300;

/** Rough bytes per cached thumbnail, for the size estimate shown next to the
 * toggle. Measured against the app's own 400px/0.75-quality thumbnails; it is
 * presented as an approximation and labelled as one. */
export const APPROX_THUMB_BYTES = 30 * 1024;

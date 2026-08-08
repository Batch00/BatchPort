// Curation: which experiences and which photos represent a trip.
//
// Pure and client-safe. Everything here is a comparator or a small predicate,
// so the story, the year recap, and both social cards can share one answer to
// "what should lead" instead of each inventing its own.
//
// THE MODEL, IN THREE SENTENCES
//
//   1. Featuring is a RANK, not a flag. `featured_rank` is null (not featured)
//      or a positive integer, and 1 leads. Every surface that consumes this is
//      a top-N surface, so a boolean would have handed the ordering question
//      straight back to rating, which is the thing curation exists to override.
//   2. A rank belongs to a SLOT, and a slot is a place on a real surface. There
//      are three, and they are what the curation panel is built out of:
//        - TRIP HERO: one photo, the recap's opening frame and the share card's
//          backdrop. Marked with `photos.featured_slot = 'hero'`.
//        - STOP PHOTOS: up to four per destination, the photos that lead that
//          stop's story slides. `photos.featured_slot = 'stop'`, ranked 1..4
//          WITHIN the destination.
//        - HIGHLIGHTS: three experiences, ordered, shown on the share card, the
//          story's closing, the recap's moments, and the trip page's own "best
//          of" block. `experiences.featured_rank`, ranked across the trip.
//      A rank with no slot to sit in is a rank nothing can honour, which is
//      what the first version of this shipped and why nobody could tell what
//      featuring an item had done.
//   3. Nothing featured means nothing changes. Every selector below falls back
//      to what it did before curation existed (rating for experiences, the
//      stored gallery order for photos), so an uncurated trip still looks
//      right with zero effort.
//
// THE CAP
//
// At most MAX_FEATURED_HONORED ranks are honoured in one scope. Past that the
// extras drop back into the normal fallback order rather than pushing the
// surfaces around: a "featured" list of thirty is not curation, and the slides
// have to stay paced. Each slot has its own tighter capacity on top of it
// (SLOT_CAPACITY), which is what the panel enforces on write.

/** How many featured items of one kind a single scope can actually influence. */
export const MAX_FEATURED_HONORED = 6;

/** Which surface a photo's rank is a rank in. */
export type PhotoSlot = "hero" | "stop";

/**
 * How many items each slot holds. These are the numbers the consuming surfaces
 * already render, not a separate policy: one backdrop, a four-photo story
 * tile, a three-line highlights row.
 */
export const SLOT_CAPACITY = {
  hero: 1,
  stopPhotos: 4,
  highlights: 3,
} as const;

/** The shape every curated row shares. Optional because a narrow read (or a
 * database where the migration has not run) simply does not carry it. */
export interface Curated {
  featuredRank?: number | null;
}

/** Normalize whatever came back from PostgREST into a rank or null. */
export function featuredRankOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export function isFeatured(item: Curated): boolean {
  return featuredRankOf(item.featuredRank) !== null;
}

/**
 * The rank to give the next item featured on a trip: one past the highest
 * already in use. Returns null once the cap is reached, which callers surface
 * as a refusal rather than silently storing a rank nothing will honour.
 */
export function nextFeaturedRank(existing: (number | null | undefined)[]): number | null {
  const ranks = existing
    .map(featuredRankOf)
    .filter((rank): rank is number => rank !== null);
  if (ranks.length >= MAX_FEATURED_HONORED) return null;
  return Math.max(0, ...ranks) + 1;
}

/**
 * Featured first, in rank order; everything else keeps whatever order the
 * caller's own comparator gives it. Only the first MAX_FEATURED_HONORED ranks
 * count, so an over-long featured list degrades to the fallback rather than
 * taking over every slide.
 *
 * Stable by construction: it returns 0 for two unfeatured items, so
 * Array.prototype.sort leaves them where the caller put them.
 */
export function compareFeatured(a: Curated, b: Curated): number {
  const ar = honoredRank(a);
  const br = honoredRank(b);
  if (ar === br) return 0;
  if (ar === null) return 1;
  if (br === null) return -1;
  return ar - br;
}

function honoredRank(item: Curated): number | null {
  const rank = featuredRankOf(item.featuredRank);
  return rank !== null && rank <= MAX_FEATURED_HONORED ? rank : null;
}

/**
 * Sort a list featured-first while preserving the incoming order within each
 * group. A plain `.sort(compareFeatured)` would do the same on every engine
 * that implements a stable sort (all of them, since ES2019), but spelling it
 * out keeps the intent visible at every call site.
 */
export function featuredFirst<T extends Curated>(items: T[]): T[] {
  return [...items].sort(compareFeatured);
}

/**
 * The ordering the top-N surfaces use: featured picks in the order the user
 * put them in, then the best-rated of whatever is left, then the name so the
 * same trip always produces the same card.
 */
export function compareCurated(
  a: Curated & { rating?: number | null; name?: string },
  b: Curated & { rating?: number | null; name?: string },
): number {
  const featured = compareFeatured(a, b);
  if (featured !== 0) return featured;
  const ar = a.rating ?? -1;
  const br = b.rating ?? -1;
  if (ar !== br) return br - ar;
  return (a.name ?? "").localeCompare(b.name ?? "");
}

// --- Photo slots ------------------------------------------------------------

/** A photo carrying enough of its row to answer which slot it sits in. */
export interface CuratedPhoto extends Curated {
  featuredSlot?: PhotoSlot | null;
}

/**
 * Which slot a photo occupies, or null for an uncurated one.
 *
 * A photo with a rank and no slot predates the slot column (or a database
 * where its migration has not run) and reads as a stop pick, which is what a
 * rank meant when only one kind existed. That is the whole of the backwards
 * compatibility story: the old flat trip-wide ranks keep leading their stop's
 * story slides exactly as they did.
 */
export function photoSlot(photo: CuratedPhoto): PhotoSlot | null {
  return photoSlotOf(photo.featuredSlot, photo.featuredRank);
}

/** The same answer from a raw (slot, rank) pair, for the data layers mapping
 * a PostgREST row into an app shape. */
export function photoSlotOf(slot: unknown, rank: unknown): PhotoSlot | null {
  if (slot === "hero") return "hero";
  if (slot === "stop") return "stop";
  return featuredRankOf(rank) !== null ? "stop" : null;
}

/** The trip's elected opening frame: the recap's first slide and the share
 * card's backdrop. */
export function isHeroPhoto(photo: CuratedPhoto): boolean {
  return photoSlot(photo) === "hero";
}

/** The rank a photo holds within its stop's slot, or null when it holds none.
 * A hero is deliberately not a stop pick: electing the trip's opening frame
 * says nothing about which four photos should lead one stop's slides. */
export function stopPhotoRank(photo: CuratedPhoto): number | null {
  return photoSlot(photo) === "stop" ? featuredRankOf(photo.featuredRank) : null;
}

/** Stop picks first, in the order they were put in; everything else keeps the
 * order the caller gave it. The photo counterpart of compareFeatured. */
export function compareStopPhotos(a: CuratedPhoto, b: CuratedPhoto): number {
  const ar = honoredStopRank(a);
  const br = honoredStopRank(b);
  if (ar === br) return 0;
  if (ar === null) return 1;
  if (br === null) return -1;
  return ar - br;
}

function honoredStopRank(photo: CuratedPhoto): number | null {
  const rank = stopPhotoRank(photo);
  return rank !== null && rank <= MAX_FEATURED_HONORED ? rank : null;
}

/** Sort photos stop-picks-first while preserving the incoming order within
 * each group. Returns a new array; the input is untouched. */
export function stopPhotosFirst<T extends CuratedPhoto>(photos: T[]): T[] {
  return [...photos].sort(compareStopPhotos);
}

/** The photo elected as a trip's hero, or null. First match wins, so a
 * duplicated slot (two devices, one trip) is a cosmetic question and never an
 * error, exactly as a duplicated rank is. */
export function heroPhoto<T extends CuratedPhoto>(photos: T[]): T | null {
  return photos.find(isHeroPhoto) ?? null;
}

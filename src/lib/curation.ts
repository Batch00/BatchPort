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
//   2. Featuring is scoped to the TRIP. A rank is assigned as "one past the
//      highest rank anywhere on this trip", so the numbers are comparable
//      across its stops. A destination's own featured items are simply the
//      subset that belongs to that stop, which is what lets a story slide
//      surface a stop's picks with no second column and no extra UI.
//   3. Nothing featured means nothing changes. Every selector below falls back
//      to what it did before curation existed (rating for experiences, the
//      stored gallery order for photos), so an uncurated trip still looks
//      right with zero effort.
//
// THE CAP
//
// At most MAX_FEATURED_HONORED items of a kind are honoured per trip. Past
// that the extras drop back into the normal fallback order rather than pushing
// the surfaces around: a "featured" list of thirty is not curation, and the
// slides have to stay paced. The individual surfaces keep their own tighter
// caps on top of this (three highlights on a card, three moments in a recap,
// four photos on a story slide).

/** How many featured items of one kind a single trip can actually influence. */
export const MAX_FEATURED_HONORED = 6;

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

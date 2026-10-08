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
//        - STOP PHOTOS: the photos that lead that stop's story slides, ranked
//          WITHIN the destination and marked `photos.featured_slot = 'stop'`.
//          Its capacity is the stop's own slide capacity (see
//          stopPhotoCapacity), not a flat number.
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
// A slot's capacity is the number of seats it actually has on the surface it
// names, and nothing may be elected past it: a rank the surfaces would not read
// is a choice the panel silently threw away. For the two fixed slots that is a
// constant (SLOT_CAPACITY); for a stop it is derived from the stop's own day
// slides (stopPhotoCapacity), because that is where its photographs are placed.
//
// MAX_FEATURED_HONORED is the ceiling on EXPERIENCE ranks, which are scoped to
// a whole trip and have no per-surface seat count of their own. It deliberately
// does NOT bound a stop's photo ranks: a fortnight in one city has forty seats,
// and a flat eight there would drop picks 9 and up on the floor while the panel
// went on offering them.

/** How many featured experiences one trip can actually influence. */
export const MAX_FEATURED_HONORED = 8;

/** Which surface a photo's rank is a rank in. */
export type PhotoSlot = "hero" | "stop";

/**
 * How many photos one story slide draws before the rest are counted in the
 * corner. It is the mosaic's own capacity (see PhotoBackdrop), and it is the
 * ceiling on what any single DAY can be given.
 */
export const SLIDE_PHOTO_CAP = 4;

/**
 * How many items the two FIXED slots hold. These are the numbers the consuming
 * surfaces already render, not a separate policy: one backdrop and a
 * three-line highlights row.
 *
 * A stop's photo slot is not in here because it has no fixed number: see
 * stopPhotoCapacity.
 */
export const SLOT_CAPACITY = {
  hero: 1,
  highlights: 3,
} as const;

/**
 * How many photographs one stop's slot holds: exactly the seats that stop has.
 *
 * A pick is placed on a DAY SLIDE and a slide draws SLIDE_PHOTO_CAP photos, so
 * a stop with n day slides can seat n * SLIDE_PHOTO_CAP of them and no more.
 * That is the whole derivation, and it is why this replaced a flat 8: eight was
 * a guess at "roughly one a day for the length of stay most people curate",
 * which is two full slides on a two day stop (half of them unplaceable) and a
 * quarter of the seats on a fortnight in one city.
 *
 * A stop with no day slide at all still gets one slide of its own (see
 * buildStorySlides), so the floor is one slide's worth rather than zero.
 */
export function stopPhotoCapacity(daySlides: number): number {
  return Math.max(1, daySlides) * SLIDE_PHOTO_CAP;
}

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

/**
 * Stop picks first, in the order they were put in; everything else keeps the
 * order the caller gave it. The photo counterpart of compareFeatured.
 *
 * Every rank is honoured here, deliberately. A stop's ceiling is its own seat
 * count, which depends on how many day slides it produced, and this comparator
 * is handed one photo at a time with no way to know that. The bound is applied
 * where the number is known: curatedStopPhotos slices to stopPhotoCapacity, and
 * the panel refuses a pick past it. A flat ceiling here would have silently
 * unranked picks the panel had just accepted.
 */
export function compareStopPhotos(a: CuratedPhoto, b: CuratedPhoto): number {
  const ar = stopPhotoRank(a);
  const br = stopPhotoRank(b);
  if (ar === br) return 0;
  if (ar === null) return 1;
  if (br === null) return -1;
  return ar - br;
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

// --- Spreading a stop's picks across its days --------------------------------
//
// THE GAP THIS CLOSES
//
// A story slide is a DAY. A stop's picks are per DESTINATION. Nothing said how
// one maps onto the other, so in practice the mapping was an accident: a dated
// pick led the day it happened to be taken on, and every UNDATED pick piled
// onto the stop's first slide because that is where undated photos ride. Curate
// four photographs of a four day stay and you could easily get all four on day
// one and three days of stop cover after it.
//
// THE RULE
//
//   1. A pick DATED to one of the stop's own day slides is LOCKED to that day.
//      Moving it somewhere else would print a photograph under another day's
//      date, which is a plain untruth and the reason this is not a simple "nth
//      pick leads the nth day".
//   2. A pick with no usable date (undated, or dated outside the days this
//      stay owns) can be given a day explicitly in Curate (`featuredDay`).
//      That is honoured FIRST, ahead of the dated anchors, because it is the
//      one placement somebody asked for by name.
//   3. Every remaining pick is on "Auto": dealt out in rank order across the
//      days that have the fewest, one pass at a time. That is what turns five
//      picks over four days into 2, 1, 1, 1 rather than 5, 0, 0, 0.
//   4. No day takes more than SLIDE_PHOTO_CAP, because that is all one slide
//      draws. A pick whose day (its own, or the one it was given) is full is
//      NOT moved elsewhere: it is reported as unplaced, with the reason, so
//      the panel can say so on the tile instead of silently relocating it.
//   5. Within a day, photos are drawn in RANK order, whichever pass seated
//      them. The passes decide which day; rank decides the order on it.
//
// Rules 2 and 5 both fix observed bugs. Anchors used to be pushed in pass one
// and levelled picks appended in pass two, so a day read "anchors, then the
// rest" whatever the ranks said: the chosen row showed badge 3 before badge 1,
// and an arrow that swapped a dated pick with an undated one on the same day
// changed both ranks and moved nothing. And levelling alone cannot spread
// undated picks across days that dated picks have already filled: on a three
// day stop with dated picks on days two and three, every undated pick landed
// on day one, because day one was always the emptiest. Rule 2 is the explicit
// control for that case; Auto still levels exactly as before.
//
// WHAT A DAY THEN SHOWS
//
// The seats a day is dealt are the photographs it shows, not the front of a
// longer queue. Electing three photographs of a day and getting them plus the
// next three the camera took is a lead, not a choice, and the count is the
// whole of what was asked for. A day with NO pick is untouched: it falls back
// to its own photos, then to the stop cover, exactly as it did before any of
// this existed, which is what keeps an uncurated stop unchanged.

/** The least a caller has to know about a photo to place it. */
export interface DistributablePhoto {
  id: string;
  /** YYYY-MM-DD or a timestamp; only the date part is read. */
  dateTaken: string | null;
  /** An explicit day slide for a pick with no usable date, or null/absent for
   * Auto. Ignored when the pick is dated to one of the stop's own days, and
   * when it names a day that is not one of them (treated as Auto). */
  featuredDay?: string | null;
}

/** What each day slide of one stop leads with: photo ids in the order they
 * should be drawn. Days absent from the map received no pick. */
export type StopPhotoPlan = Map<string, string[]>;

/** How a pick was (or would be) placed, which the panel states on the tile. */
export type PickPlacement =
  /** Dated to one of the stop's days, so locked to it. */
  | { kind: "dated"; day: string }
  /** Given a day explicitly in Curate. */
  | { kind: "chosen"; day: string }
  /** Auto: levelled onto the emptiest day. */
  | { kind: "auto"; day: string }
  /** No seat: its own day (dated) or its chosen day was already full, or Auto
   * ran out of seats. Never relocated; it stays in the gallery. */
  | { kind: "full"; reason: "dated" | "chosen" | "auto"; day: string | null };

export interface StopPhotoDistribution {
  plan: StopPhotoPlan;
  /** One entry per curated photo, keyed by id. */
  placement: Map<string, PickPlacement>;
}

/** The date part of a date or timestamp string. */
function distributionDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

/** The stop day a pick is dated to, or null when it has no usable date: no
 * date at all, or one outside the days this stay owns. Exported because the
 * panel uses the same test to decide between a lock and a day selector. */
export function anchoredDay(
  photo: Pick<DistributablePhoto, "dateTaken">,
  days: string[],
): string | null {
  const date = distributionDay(photo.dateTaken);
  return date !== null && days.includes(date) ? date : null;
}

/**
 * Deal one stop's curated photos out over its day slides, and say how each
 * one was placed.
 *
 * `days` are the stop's day-slide dates in chronological order and `curated`
 * is the elected set in rank order. The story (which draws the plan), the
 * panel's chosen-row grouping, its per-day chips, and its tile cues all call
 * this, so what the picker promises and what the slide renders are the same
 * function and cannot drift.
 */
export function distributeStopPhotosDetailed(
  days: string[],
  curated: DistributablePhoto[],
  cap: number = SLIDE_PHOTO_CAP,
): StopPhotoDistribution {
  const placement = new Map<string, PickPlacement>();
  if (days.length === 0 || curated.length === 0 || cap <= 0) {
    return { plan: new Map(), placement };
  }
  const seats = new Map<string, string[]>(days.map((date) => [date, []]));
  const seat = (date: string, id: string): boolean => {
    const list = seats.get(date);
    if (!list || list.length >= cap) return false;
    list.push(id);
    return true;
  };

  // Pass one: explicit days. Only a pick with no usable date can carry one,
  // and only a day of this stop counts; anything else falls through to Auto.
  const explicitIds = new Set<string>();
  for (const photo of curated) {
    if (anchoredDay(photo, days) !== null) continue;
    const day = distributionDay(photo.featuredDay);
    if (day === null || !seats.has(day)) continue;
    explicitIds.add(photo.id);
    placement.set(
      photo.id,
      seat(day, photo.id)
        ? { kind: "chosen", day }
        : { kind: "full", reason: "chosen", day },
    );
  }

  // Pass two: dated anchors. A pick whose own day is already full is
  // deliberately NOT dealt elsewhere, because printing it under another day's
  // date to fill a seat is the untruth this whole rule avoids.
  const auto: DistributablePhoto[] = [];
  for (const photo of curated) {
    if (explicitIds.has(photo.id)) continue;
    const day = anchoredDay(photo, days);
    if (day === null) {
      auto.push(photo);
      continue;
    }
    placement.set(
      photo.id,
      seat(day, photo.id)
        ? { kind: "dated", day }
        : { kind: "full", reason: "dated", day },
    );
  }

  // Pass three: Auto. Deal the rest onto the emptiest days, in rank order,
  // levelling up one seat at a time. Filling day one to the cap before
  // touching day two is what produced the pile this exists to prevent.
  let index = 0;
  for (let target = 1; target <= cap && index < auto.length; target += 1) {
    for (const date of days) {
      if (index >= auto.length) break;
      const list = seats.get(date);
      if (!list || list.length >= target) continue;
      list.push(auto[index].id);
      placement.set(auto[index].id, { kind: "auto", day: date });
      index += 1;
    }
  }
  for (; index < auto.length; index += 1) {
    placement.set(auto[index].id, { kind: "full", reason: "auto", day: null });
  }

  // Rule 5: within a day, rank order, whichever pass seated the photo.
  const rank = new Map(curated.map((photo, position) => [photo.id, position]));
  const plan: StopPhotoPlan = new Map();
  for (const date of days) {
    const list = seats.get(date) ?? [];
    if (list.length === 0) continue;
    plan.set(
      date,
      [...list].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0)),
    );
  }
  return { plan, placement };
}

/** The plan alone, for the callers that only draw it (the story). */
export function distributeStopPhotos(
  days: string[],
  curated: DistributablePhoto[],
  cap: number = SLIDE_PHOTO_CAP,
): StopPhotoPlan {
  return distributeStopPhotosDetailed(days, curated, cap).plan;
}

// The sentence form of a plan lives in lib/curation-slots.ts
// (describeStopSelection), because it needs the stop's real day slides and
// this module deliberately knows nothing about a StoryTrip.

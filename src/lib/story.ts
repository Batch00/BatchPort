import {
  SLIDE_PHOTO_CAP,
  SLOT_CAPACITY,
  compareCurated,
  distributeStopPhotos,
  featuredFirst,
  heroPhoto,
  stopPhotoRank,
  stopPhotosFirst,
  type PhotoSlot,
} from "@/lib/curation";
import { durationDays } from "@/lib/format";
import { haversineKm } from "@/lib/geo";
import {
  buildStayDays,
  isDatedStay,
  type Stay,
  type StayDays,
} from "@/lib/stays";
// Type only, so nothing from the server-side share data layer is pulled into
// the client bundle that renders the story.
import type { ProfileTrip } from "@/lib/share-data";

// The trip story: everything the app knows about one trip, folded into a
// chronological sequence of full-screen slides.
//
// Pure and client-safe. Nothing here fetches; the trip page and the read-only
// profile both assemble a StoryTrip from rows they already have and hand it
// over, which is what lets the same view serve /trips/[id], /demo, and
// /share/[slug] without a second data layer.
//
// The composition rule, in one sentence: a slide is a DAY, a day belongs to
// the STAY whose own range contains it, and everything dated that day (the
// journal entry, the photos, the experiences) lands on it. Undated things do
// not disappear: they fall back to the stop that owns them, on that stop's
// first slide, or onto a stop slide when the stop produced no days at all.
//
// "Stay" is load-bearing and means one destination ROW. A trip that returns to
// Copenhagen has two Copenhagen stays with nothing in common but a name, and
// each gets its own days, photographs, and curation. lib/stays.ts owns that
// resolution and the rule for a day two stays could both claim.

/**
 * A photo, already resolved to display URLs by the caller.
 *
 * Both urls are carried, and which one a surface uses is not a matter of
 * taste: `url` is the full image and is what anything drawing a photo larger
 * than a grid tile must request, `thumbUrl` is the 400px gallery thumbnail and
 * is a grid tile or a low-quality placeholder and nothing else.
 */
export interface StoryPhoto {
  id: string;
  url: string;
  thumbUrl: string;
  /** YYYY-MM-DD or a timestamp; only the date part is used for grouping. */
  dateTaken: string | null;
  attribution: string | null;
  /** Curation: which slot the photo was elected into, and its position in it.
   * See lib/curation.ts. */
  featuredRank?: number | null;
  featuredSlot?: PhotoSlot | null;
  /** The stop this photo hangs off, directly or through its experience. Null
   * for trip-level photos, which are placed by date instead. */
  destinationId: string | null;
  /**
   * The experience this photo was taken OF, when it is owned by one.
   *
   * Carried separately from destinationId because collapsing the two is a
   * factual claim the data does not support: "a photo from Kyoto" and "a photo
   * of Fushimi Inari" are different statements, and a surface that names one
   * experience and shows a picture of another is simply wrong. The recap's
   * moments are the surface that needs it (see buildMoments).
   */
  experienceId?: string | null;
}

export interface StoryExperience {
  id: string;
  name: string;
  rating: number | null;
  visitedDate: string | null;
  notes: string | null;
  categoryLabel: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  /** Curation order within the trip, or null. See lib/curation.ts. */
  featuredRank?: number | null;
}

export interface StoryDestination {
  id: string;
  name: string;
  countryCode: string | null;
  arrivalDate: string | null;
  departureDate: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Full size: a stop's cover fills a whole slide when the day has no photos. */
  coverUrl: string | null;
  /** The same cover at thumbnail size, as the placeholder behind it. */
  coverThumbUrl?: string | null;
  experiences: StoryExperience[];
}

export interface StoryTrip {
  id: string;
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  /** Full size: the opener slide and the exported share card both use it. */
  coverUrl: string | null;
  /** The same cover at thumbnail size, as the placeholder behind it. */
  coverThumbUrl?: string | null;
  destinations: StoryDestination[];
  photos: StoryPhoto[];
  /** Journal bodies keyed by YYYY-MM-DD. */
  journal: Record<string, string>;
}

export interface StoryOpenerSlide {
  kind: "opener";
  key: string;
  trip: StoryTrip;
  /**
   * Every stop on the trip, in visit order, and never a subset of them.
   *
   * It used to be a string ending in "and 8 more", which on a long trip hid
   * most of the journey the slide was introducing. The view lays it out with
   * the house rule instead (see lib/place-lines.ts): shrink, then wrap between
   * places, and show all of them.
   */
  places: string[];
  countryCodes: string[];
  photos: StoryPhoto[];
}

export interface StoryDaySlide {
  kind: "day";
  key: string;
  /** YYYY-MM-DD. */
  date: string;
  /** 1-based day number within the trip. */
  dayNumber: number | null;
  destination: StoryDestination | null;
  /** True on the first slide of a stop, which is where the stop's name, cover,
   * and observed-weather line belong. */
  opensDestination: boolean;
  journal: string | null;
  photos: StoryPhoto[];
  experiences: StoryExperience[];
}

/** A stop whose stay produced no dated day: undated stays, and stops nobody
 * wrote about or photographed. Carries everything the stop owns. */
export interface StoryStopSlide {
  kind: "stop";
  key: string;
  destination: StoryDestination;
  photos: StoryPhoto[];
  experiences: StoryExperience[];
}

export interface StoryClosingStats {
  days: number | null;
  countries: number;
  destinations: number;
  experiences: number;
  photos: number;
  distanceKm: number | null;
  best: { name: string; rating: number; destinationName: string } | null;
}

export interface StoryClosingSlide {
  kind: "closing";
  key: string;
  trip: StoryTrip;
  stats: StoryClosingStats;
}

export type StorySlide =
  | StoryOpenerSlide
  | StoryDaySlide
  | StoryStopSlide
  | StoryClosingSlide;

// A single stop long enough to blow past this is not a day-by-day story any
// more; its remaining days fold into the days that actually carry something.
const MAX_DAYS_PER_STOP = 60;

/** The date part of a date or timestamp string. */
function dayOf(value: string | null): string | null {
  if (!value) return null;
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

/** The trip's stops as stays, in the order they were given (which every read
 * path already sorts chronologically). Position is the tiebreaker for two
 * stays that arrive on the same day. */
function staysOf(trip: StoryTrip): Stay[] {
  return trip.destinations.map((destination, index) => ({
    id: destination.id,
    arrival: destination.arrivalDate,
    departure: destination.departureDate,
    position: index,
  }));
}

/**
 * Where every piece of a trip actually sits: which stay owns which day, and
 * which stay each photo, experience, and journal entry belongs to.
 *
 * PLACEMENT, IN PRECEDENCE ORDER
 *
 *   1. An item owned by an UNDATED stop stays with that stop. There is no
 *      conflict to resolve, only an absence, and donating it to whoever
 *      happens to hold those dates would empty the stop the user attached it
 *      to.
 *   2. Otherwise the stay that owns the item's DATE takes it, whichever stop
 *      the row hangs off. This is what separates a revisit: a photograph
 *      uploaded onto the first Copenhagen but taken during the second one
 *      belongs to the second one, and no amount of ownership makes it a
 *      picture of the first week.
 *   3. Otherwise (no date, or a date no stay owns) the item stays with its
 *      owner as undated content, and a trip-level item with nowhere to go
 *      opens the story instead. Nothing is ever handed to the nearest stop:
 *      that is exactly how a photograph taken the day before the first
 *      arrival ended up on a slide captioned with the first city.
 *
 * Journal entries have no owner, so they follow rule 2 alone; a date no stay
 * owns is a travel day and gets a slide of its own.
 */
export interface TripPlacement {
  stayDays: StayDays;
  /** Stay id to the photos placed there, in trip order. */
  photosByStay: Map<string, StoryPhoto[]>;
  /** Photos with no stay and no owner: the opener's pool. */
  unplacedPhotos: StoryPhoto[];
  experiencesByStay: Map<string, StoryExperience[]>;
  journalByStay: Map<string, string[]>;
  /** Journal dates no stay owns, in date order. */
  orphanJournalDates: string[];
}

export function placeTripContent(trip: StoryTrip): TripPlacement {
  const stays = staysOf(trip);
  const stayDays = buildStayDays(stays, MAX_DAYS_PER_STOP);
  const datedStay = new Set(
    stays.filter(isDatedStay).map((stay) => stay.id),
  );
  const known = new Set(stays.map((stay) => stay.id));

  /** The stay an owned item belongs to, or null for the opener. */
  const target = (ownerId: string | null, date: string | null): string | null => {
    const owner = ownerId !== null && known.has(ownerId) ? ownerId : null;
    if (owner !== null && !datedStay.has(owner)) return owner;
    const day = dayOf(date);
    const byDate = day !== null ? stayDays.ownerByDay.get(day) ?? null : null;
    return byDate ?? owner;
  };

  const photosByStay = new Map<string, StoryPhoto[]>();
  const unplacedPhotos: StoryPhoto[] = [];
  for (const photo of trip.photos) {
    const stayId = target(photo.destinationId, photo.dateTaken);
    if (stayId === null) unplacedPhotos.push(photo);
    else push(photosByStay, stayId, photo);
  }

  const experiencesByStay = new Map<string, StoryExperience[]>();
  for (const destination of trip.destinations) {
    for (const experience of destination.experiences) {
      const stayId =
        target(destination.id, experience.visitedDate) ?? destination.id;
      push(experiencesByStay, stayId, experience);
    }
  }

  const journalByStay = new Map<string, string[]>();
  const orphanJournalDates: string[] = [];
  for (const date of Object.keys(trip.journal).sort()) {
    const day = dayOf(date);
    const stayId = day !== null ? stayDays.ownerByDay.get(day) ?? null : null;
    if (stayId === null) {
      if (day !== null) orphanJournalDates.push(day);
      continue;
    }
    push(journalByStay, stayId, day as string);
  }

  return {
    stayDays,
    photosByStay,
    unplacedPhotos,
    experiencesByStay,
    journalByStay,
    orphanJournalDates,
  };
}

/** The stops, in visit order. Whole: the layout does the fitting, and there is
 * no count of places at which hiding some of them becomes the right answer. */
function routePlaces(destinations: StoryDestination[]): string[] {
  return destinations.map((destination) => destination.name);
}

/** Straight-line distance along the route, the same measure the trip arcs on
 * the globe draw. Null when fewer than two stops carry coordinates. */
function routeDistanceKm(destinations: StoryDestination[]): number | null {
  const points = destinations
    .filter((d) => d.latitude !== null && d.longitude !== null)
    .map((d) => ({ lat: d.latitude as number, lng: d.longitude as number }));
  if (points.length < 2) return null;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineKm(
      points[i - 1].lat,
      points[i - 1].lng,
      points[i].lat,
      points[i].lng,
    );
  }
  return Math.round(total);
}

/** The scoreboard a trip closes on. Exported because the share card is the
 * same numbers in a different frame, and two derivations of "the best thing on
 * this trip" would eventually disagree. */
export function storyClosingStats(trip: StoryTrip): StoryClosingStats {
  const done = trip.destinations.flatMap((destination) =>
    destination.experiences.map((experience) => ({
      experience,
      destinationName: destination.name,
    })),
  );
  const countries = new Set(
    trip.destinations
      .map((destination) => destination.countryCode)
      .filter((code): code is string => Boolean(code)),
  );
  // "Best of the trip" is the curated pick when there is one, and the highest
  // rating otherwise. A featured item with no rating is still not offered
  // here: the line prints a star beside it, and inventing a rating to fill it
  // would be a claim the data does not make.
  const rated = done
    .filter(({ experience }) => experience.rating !== null)
    .sort((a, b) => compareCurated(a.experience, b.experience));
  const best: StoryClosingStats["best"] = rated[0]
    ? {
        name: rated[0].experience.name,
        rating: rated[0].experience.rating as number,
        destinationName: rated[0].destinationName,
      }
    : null;
  return {
    days: durationDays(trip.startDate, trip.endDate),
    countries: countries.size,
    destinations: trip.destinations.length,
    experiences: done.length,
    photos: trip.photos.length,
    distanceKm: routeDistanceKm(trip.destinations),
    best,
  };
}

/**
 * Which STAY each of a trip's photos belongs to, and the ones that belong to
 * none. See placeTripContent for the precedence; the short version is that the
 * stay owning a photo's date takes it, and a photo with nowhere to be stays
 * with its own stop.
 *
 * Exported because the curation panel offers "this stop's photos" and has to
 * offer exactly the set the story will actually draw from. Two answers to that
 * question would mean electing a photo into a slot it never appears in, which
 * on a trip that visits one city twice is exactly what happened: every
 * photograph of both stays sat in the first stay's slot.
 */
export function photosByStop(trip: StoryTrip): {
  byDestination: Map<string, StoryPhoto[]>;
  unplaced: StoryPhoto[];
} {
  const placement = placeTripContent(trip);
  return {
    byDestination: placement.photosByStay,
    unplaced: placement.unplacedPhotos,
  };
}

/**
 * A stop's elected photos, in slot order and capped at the slot's capacity.
 *
 * Exported because the curation panel has to describe exactly the set the
 * story will place. Two readings of "this stop's picks" would mean the picker
 * promising a spread the slides do not produce.
 */
export function curatedStopPhotos(photos: StoryPhoto[]): StoryPhoto[] {
  return stopPhotosFirst(photos)
    .filter((photo) => stopPhotoRank(photo) !== null)
    .slice(0, SLOT_CAPACITY.stopPhotos);
}

/** The photo elected as this trip's hero: the recap's opening frame and the
 * share card's backdrop. Null when nothing was elected, in which case both
 * surfaces fall back to what they used before (see their own callers). */
export function storyHeroPhoto(trip: StoryTrip): StoryPhoto | null {
  return heroPhoto(trip.photos);
}

/**
 * Fold a trip into its slides: an opener, the days (or stops) in visit order,
 * and a closing scoreboard. Always returns at least the opener and the
 * closing, so the view never has to handle an empty sequence.
 */
export function buildStorySlides(trip: StoryTrip): StorySlide[] {
  // --- Resolve every day to a stay, then bucket everything into it ---------
  const placement = placeTripContent(trip);
  const {
    stayDays,
    photosByStay: photosByDestination,
    unplacedPhotos: openerPhotos,
    experiencesByStay,
    orphanJournalDates,
  } = placement;

  const slides: StorySlide[] = [];
  // Every middle slide with the date it sorts on. A day slide sorts on its own
  // day; an undated stop's slide sorts on the last date emitted before it, so
  // it keeps the place in visit order it was entered at.
  const middle: { key: string; slide: StoryDaySlide | StoryStopSlide }[] = [];

  slides.push({
    kind: "opener",
    key: "opener",
    trip,
    places: routePlaces(trip.destinations),
    countryCodes: Array.from(
      new Set(
        trip.destinations
          .map((destination) => destination.countryCode)
          .filter((code): code is string => Boolean(code)),
      ),
    ),
    photos: stopPhotosFirst(openerPhotos),
  });

  // Day numbering is anchored to the trip's FIRST DAY ON THE GROUND: the
  // earliest day any stay owns. The stored trips.start_date is a fallback for
  // a trip nobody dated a stop on and nothing more, exactly as it is for the
  // trip's range (see lib/trip-dates.ts). Anchoring to the column instead is
  // what produced "Day 1" on a date a day before the first stop had begun.
  const tripStart = stayDays.firstDay ?? dayOf(trip.startDate);
  const dayNumberOf = (date: string): number | null => {
    if (!tripStart) return null;
    const diff =
      (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${tripStart}T00:00:00Z`)) /
      86_400_000;
    return diff >= 0 ? Math.round(diff) + 1 : null;
  };

  // The latest day emitted so far, which is the sort key an undated stop
  // inherits so it lands between the stops it was entered between.
  let lastDate = "";

  for (const destination of trip.destinations) {
    const ownPhotos = photosByDestination.get(destination.id) ?? [];
    // The days this stay owns, and nothing else. Content dated outside them
    // has already been placed with the stay that does own that date, so a
    // foreign date can no longer drag a day slide onto this stop: that is
    // what stretched a four night stay across a whole trip.
    const ownDays = stayDays.daysByStay.get(destination.id) ?? [];
    const ownDaySet = new Set(ownDays);
    const dayOfHere = (value: string | null): string | null => {
      const date = dayOf(value);
      return date !== null && ownDaySet.has(date) ? date : null;
    };

    const photosByDay = new Map<string, StoryPhoto[]>();
    const undatedPhotos: StoryPhoto[] = [];
    for (const photo of ownPhotos) {
      const date = dayOfHere(photo.dateTaken);
      if (date) push(photosByDay, date, photo);
      else undatedPhotos.push(photo);
    }

    const experiencesByDay = new Map<string, StoryExperience[]>();
    const undatedExperiences: StoryExperience[] = [];
    for (const experience of experiencesByStay.get(destination.id) ?? []) {
      const date = dayOfHere(experience.visitedDate);
      if (date) push(experiencesByDay, date, experience);
      else undatedExperiences.push(experience);
    }

    const daySlides: StoryDaySlide[] = [];
    for (const date of ownDays) {
      const journal = trip.journal[date] ?? null;
      const photos = photosByDay.get(date) ?? [];
      const experiences = experiencesByDay.get(date) ?? [];
      // A day nobody wrote about, photographed, or logged anything on is not
      // a slide. Skipping it is what keeps the story a story.
      if (!journal && photos.length === 0 && experiences.length === 0) continue;
      daySlides.push({
        kind: "day",
        key: `${destination.id}:${date}`,
        date,
        dayNumber: dayNumberOf(date),
        destination,
        // Set once every slide is in date order: a stop opens at the first
        // slide of each run of its own days.
        opensDestination: false,
        journal,
        // The fallback order for a day the plan does not reach: picks first,
        // then the day as the camera took it. A day the plan DOES reach has
        // its whole photo list replaced below.
        photos: stopPhotosFirst(photos),
        experiences: featuredFirst(experiences),
      });
    }

    // This stop's elected photos. With nothing elected every line that reads
    // it is a no-op, which is what keeps an uncurated trip byte-for-byte what
    // it was.
    const curated = curatedStopPhotos(ownPhotos);

    if (daySlides.length === 0) {
      // Nothing dated: one stop slide carrying everything this stop owns. A
      // curated stop shows its picks and nothing else here too; there is only
      // one slide to spread them over, so it takes what a slide draws.
      if (
        undatedPhotos.length > 0 ||
        undatedExperiences.length > 0 ||
        destination.coverUrl ||
        destination.experiences.length > 0
      ) {
        middle.push({
          key: lastDate,
          slide: {
            kind: "stop",
            key: `stop:${destination.id}`,
            destination,
            photos:
              curated.length > 0
                ? curated.slice(0, SLIDE_PHOTO_CAP)
                : stopPhotosFirst(undatedPhotos),
            experiences: featuredFirst(undatedExperiences),
          },
        });
      }
      continue;
    }

    // Spread this stop's picks across its days (see distributeStopPhotos).
    const plan = distributeStopPhotos(
      daySlides.map((slide) => slide.date),
      curated,
      SLIDE_PHOTO_CAP,
    );
    let leftovers = undatedPhotos;
    // A day that was dealt picks shows THOSE PHOTOGRAPHS AND NO OTHERS.
    // Electing three photographs of a day and getting them plus the next
    // three the camera happened to take is not a choice, it is a lead, and
    // the count is the whole of what the traveller asked for. Days the plan
    // left empty are untouched and fall back exactly as an uncurated stop
    // does: their own photos, then the stop cover.
    let openerTakesLeftovers = true;
    if (plan.size > 0) {
      const byId = new Map(curated.map((photo) => [photo.id, photo]));
      const placed = new Set<string>();
      for (const ids of plan.values()) {
        for (const id of ids) placed.add(id);
      }
      for (const slide of daySlides) {
        const lead = (plan.get(slide.date) ?? [])
          .map((id) => byId.get(id))
          .filter((photo): photo is StoryPhoto => photo !== undefined);
        // A pick placed on another day is removed from an uncurated one too,
        // or the stop would show the same photograph twice on its way through
        // the week.
        slide.photos =
          lead.length > 0
            ? lead
            : slide.photos.filter((photo) => !placed.has(photo.id));
      }
      leftovers = undatedPhotos.filter((photo) => !placed.has(photo.id));
      openerTakesLeftovers = (plan.get(daySlides[0].date) ?? []).length === 0;
    }

    // Undated leftovers ride on the stop's first slide rather than vanishing,
    // unless that slide is one the traveller curated: adding to it would put
    // back the fillers the count above just removed.
    if (openerTakesLeftovers) {
      daySlides[0].photos =
        plan.size > 0
          ? [...daySlides[0].photos, ...leftovers]
          : stopPhotosFirst([...daySlides[0].photos, ...leftovers]);
    }
    daySlides[0].experiences = featuredFirst([
      ...daySlides[0].experiences,
      ...undatedExperiences,
    ]);
    for (const slide of daySlides) middle.push({ key: slide.date, slide });
    lastDate = daySlides[daySlides.length - 1].date;
  }

  // Journal written on a day no stay owns: a travel day between two stops, or
  // writing from the flight home. It gets a slide with no stop on it rather
  // than being handed to whichever stop is nearest, which would print a
  // paragraph under a place the traveller had already left.
  for (const date of orphanJournalDates) {
    middle.push({
      key: date,
      slide: {
        kind: "day",
        key: `orphan:${date}`,
        date,
        dayNumber: dayNumberOf(date),
        destination: null,
        opensDestination: false,
        journal: trip.journal[date] ?? null,
        photos: [],
        experiences: [],
      },
    });
  }

  // One chronological run. Every day belongs to exactly one stay, so no two
  // day slides can share a date and the sort is total; it is what interleaves
  // a travel day, and a stop nested inside another stop's range, into the
  // order they happened. On the ordinary trip, whose stays do not overlap,
  // this is the order the loop above already produced. The sort is stable, so
  // an undated stop stays where its visit order put it.
  middle.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  let previousStay: string | null = null;
  for (const entry of middle) {
    if (entry.slide.kind === "day") {
      const stayId = entry.slide.destination?.id ?? null;
      // A stop opens where its run of days begins, which on a trip that
      // returns to the same city gives each stay its own header and its own
      // weather line, and on a stay split by a side trip says so on the way
      // back.
      entry.slide.opensDestination = stayId !== null && stayId !== previousStay;
      previousStay = stayId;
    } else {
      previousStay = entry.slide.destination.id;
    }
    slides.push(entry.slide);
  }

  slides.push({
    kind: "closing",
    key: "closing",
    trip,
    stats: storyClosingStats(trip),
  });

  return slides;
}

/**
 * Adapt the read-only profile shape (demo, /share/[slug], and the dashboard's
 * trip list) into a StoryTrip. Planned ideas are dropped: the story is a
 * record of what happened, and the trip page's planner is where the ideas
 * belong. Requires getProfileTrips to have been called with { story: true },
 * otherwise journal and photos are simply empty and the story falls back to
 * covers and experiences.
 */
export function storyTripFromProfile(trip: ProfileTrip): StoryTrip {
  const journal: Record<string, string> = {};
  for (const entry of trip.journal) {
    journal[entry.entry_date.slice(0, 10)] = entry.body;
  }
  return {
    id: trip.id,
    name: trip.name,
    status: trip.status,
    startDate: trip.start_date,
    endDate: trip.end_date,
    notes: trip.notes,
    // The FULL cover, not the card thumbnail: this feeds full-screen slides
    // and a 2160px exported card.
    coverUrl: trip.coverFullUrl ?? trip.coverUrl,
    coverThumbUrl: trip.coverUrl,
    photos: trip.photos,
    journal,
    destinations: trip.destinations.map((destination) => ({
      id: destination.id,
      name: destination.name,
      countryCode: destination.country_code,
      arrivalDate: destination.arrival_date,
      departureDate: destination.departure_date,
      latitude: destination.latitude,
      longitude: destination.longitude,
      coverUrl: destination.coverFullUrl ?? destination.coverUrl,
      coverThumbUrl: destination.coverUrl,
      experiences: destination.experiences
        .filter((experience) => experience.status !== "planned")
        .map((experience) => ({
          id: experience.id,
          name: experience.name,
          rating: experience.rating,
          visitedDate: experience.visited_date,
          notes: experience.notes,
          categoryLabel: experience.category?.label ?? null,
          categoryIcon: experience.category?.icon ?? null,
          categoryColor: experience.category?.color ?? null,
          featuredRank: experience.featured_rank,
        })),
    })),
  };
}

/** Whether a trip has enough behind it to be worth reading as a story. A
 * planned trip has not happened yet; a trip with no stops has nothing to
 * show. Callers hide the entry point rather than opening an empty story. */
export function hasStory(trip: {
  status: string;
  destinations: unknown[];
}): boolean {
  return trip.status !== "planned" && trip.destinations.length > 0;
}

/** The images a slide would render, in order. The view preloads the next
 * slide's first image from this. */
export function slideImageUrls(slide: StorySlide): string[] {
  switch (slide.kind) {
    case "opener":
      return [
        ...(slide.trip.coverUrl ? [slide.trip.coverUrl] : []),
        ...slide.photos.map((photo) => photo.url),
      ];
    case "day":
      return [
        ...slide.photos.map((photo) => photo.url),
        ...(slide.destination?.coverUrl ? [slide.destination.coverUrl] : []),
      ];
    case "stop":
      return [
        ...slide.photos.map((photo) => photo.url),
        ...(slide.destination.coverUrl ? [slide.destination.coverUrl] : []),
      ];
    case "closing":
      // The closing scoreboard sits over the trip cover, so the warm-up has to
      // name it too. It is the same file the opener already fetched, so this
      // costs nothing and simply keeps the rule true.
      return slide.trip.coverUrl ? [slide.trip.coverUrl] : [];
    default:
      return [];
  }
}

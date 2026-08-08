import { compareCurated, featuredFirst } from "@/lib/curation";
import { durationDays } from "@/lib/format";
import { haversineKm } from "@/lib/geo";
import { dateRange, destinationForDate } from "@/lib/journal";
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
// the stop whose stay contains it, and everything dated that day (the journal
// entry, the photos, the experiences) lands on it. Undated things do not
// disappear: they fall back to the stop that owns them, on that stop's first
// slide, or onto a stop slide when the stop produced no days at all.

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
  /** Curation order within the trip, or null. See lib/curation.ts. */
  featuredRank?: number | null;
  /** The stop this photo hangs off, directly or through its experience. Null
   * for trip-level photos, which are placed by date instead. */
  destinationId: string | null;
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
  /** "Tokyo, Kyoto, Osaka", trimmed with an ellipsis when it runs long. */
  route: string;
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

const MAX_ROUTE_STOPS = 4;

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

/** The stop a dated, unowned item belongs to: the stay containing it, else the
 * stop whose arrival is nearest. Null only when no stop is dated at all. */
function nearestDestination(
  destinations: StoryDestination[],
  date: string,
): StoryDestination | null {
  const containing = destinationForDate(
    destinations.map((destination) => ({
      id: destination.id,
      name: destination.name,
      arrival_date: destination.arrivalDate,
      departure_date: destination.departureDate,
    })),
    date,
  );
  if (containing) {
    return destinations.find((d) => d.id === containing.id) ?? null;
  }
  let best: StoryDestination | null = null;
  let bestGap = Infinity;
  for (const destination of destinations) {
    const anchor = destination.arrivalDate ?? destination.departureDate;
    if (!anchor) continue;
    const gap = Math.abs(Date.parse(`${anchor}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`));
    if (gap < bestGap) {
      bestGap = gap;
      best = destination;
    }
  }
  return best;
}

function routeSummary(destinations: StoryDestination[]): string {
  const names = destinations.map((destination) => destination.name);
  if (names.length <= MAX_ROUTE_STOPS) return names.join(", ");
  return `${names.slice(0, MAX_ROUTE_STOPS).join(", ")} and ${
    names.length - MAX_ROUTE_STOPS
  } more`;
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
 * Fold a trip into its slides: an opener, the days (or stops) in visit order,
 * and a closing scoreboard. Always returns at least the opener and the
 * closing, so the view never has to handle an empty sequence.
 */
export function buildStorySlides(trip: StoryTrip): StorySlide[] {
  // --- Bucket everything by the stop that owns it, then by day -------------
  const photosByDestination = new Map<string, StoryPhoto[]>();
  const openerPhotos: StoryPhoto[] = [];
  for (const photo of trip.photos) {
    if (photo.destinationId) {
      push(photosByDestination, photo.destinationId, photo);
      continue;
    }
    // A trip-level photo has no stop of its own, so its date places it. With
    // no date and nothing to place it against, it opens the story instead.
    const date = dayOf(photo.dateTaken);
    const destination = date ? nearestDestination(trip.destinations, date) : null;
    if (destination) push(photosByDestination, destination.id, photo);
    else openerPhotos.push(photo);
  }

  const journalDates = Object.keys(trip.journal).sort();
  const journalByDestination = new Map<string, string[]>();
  const orphanJournalDates: string[] = [];
  for (const date of journalDates) {
    const destination = nearestDestination(trip.destinations, date);
    if (destination) push(journalByDestination, destination.id, date);
    else orphanJournalDates.push(date);
  }

  const slides: StorySlide[] = [];

  slides.push({
    kind: "opener",
    key: "opener",
    trip,
    route: routeSummary(trip.destinations),
    countryCodes: Array.from(
      new Set(
        trip.destinations
          .map((destination) => destination.countryCode)
          .filter((code): code is string => Boolean(code)),
      ),
    ),
    photos: featuredFirst(openerPhotos),
  });

  // Day numbering runs off the trip's own first day when it has one, so
  // "Day 5" means the same thing across every stop.
  const tripStart =
    dayOf(trip.startDate) ??
    dayOf(trip.destinations.find((d) => d.arrivalDate)?.arrivalDate ?? null);
  const dayNumberOf = (date: string): number | null => {
    if (!tripStart) return null;
    const diff =
      (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${tripStart}T00:00:00Z`)) /
      86_400_000;
    return diff >= 0 ? Math.round(diff) + 1 : null;
  };

  for (const destination of trip.destinations) {
    const ownPhotos = photosByDestination.get(destination.id) ?? [];
    const photosByDay = new Map<string, StoryPhoto[]>();
    const undatedPhotos: StoryPhoto[] = [];
    for (const photo of ownPhotos) {
      const date = dayOf(photo.dateTaken);
      if (date) push(photosByDay, date, photo);
      else undatedPhotos.push(photo);
    }

    const experiencesByDay = new Map<string, StoryExperience[]>();
    const undatedExperiences: StoryExperience[] = [];
    for (const experience of destination.experiences) {
      const date = dayOf(experience.visitedDate);
      if (date) push(experiencesByDay, date, experience);
      else undatedExperiences.push(experience);
    }

    const journalDatesHere = journalByDestination.get(destination.id) ?? [];

    // Candidate days: the stay itself, plus any dated content that landed on
    // this stop from outside it (a photo taken on the travel day in, say).
    const candidates = new Set<string>();
    const arrival = dayOf(destination.arrivalDate);
    if (arrival) {
      const departure = dayOf(destination.departureDate) ?? arrival;
      for (const date of dateRange(arrival, departure, MAX_DAYS_PER_STOP)) {
        candidates.add(date);
      }
    }
    for (const date of photosByDay.keys()) candidates.add(date);
    for (const date of experiencesByDay.keys()) candidates.add(date);
    for (const date of journalDatesHere) candidates.add(date);

    const dates = Array.from(candidates).sort();
    const daySlides: StoryDaySlide[] = [];
    for (const date of dates) {
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
        opensDestination: daySlides.length === 0,
        journal,
        // Curated picks lead their slide. A slide shows at most four photos
        // with the rest counted, so on a heavily photographed day this is the
        // difference between the four the traveller chose and the first four
        // the camera happened to take.
        photos: featuredFirst(photos),
        experiences: featuredFirst(experiences),
      });
    }

    if (daySlides.length === 0) {
      // Nothing dated: one stop slide carrying everything this stop owns.
      if (
        undatedPhotos.length > 0 ||
        undatedExperiences.length > 0 ||
        destination.coverUrl ||
        destination.experiences.length > 0
      ) {
        slides.push({
          kind: "stop",
          key: `stop:${destination.id}`,
          destination,
          photos: featuredFirst(undatedPhotos),
          experiences: featuredFirst(undatedExperiences),
        });
      }
      continue;
    }

    // Undated leftovers ride on the stop's first slide rather than vanishing,
    // and are re-sorted with it so a featured undated photo still leads.
    daySlides[0].photos = featuredFirst([
      ...daySlides[0].photos,
      ...undatedPhotos,
    ]);
    daySlides[0].experiences = featuredFirst([
      ...daySlides[0].experiences,
      ...undatedExperiences,
    ]);
    slides.push(...daySlides);
  }

  // Journal written on a day no stop could claim (a trip with undated stops,
  // or writing from the flight home). Placed by date at the end of the day
  // run, since there is no stop to sit under.
  for (const date of orphanJournalDates) {
    slides.push({
      kind: "day",
      key: `orphan:${date}`,
      date,
      dayNumber: dayNumberOf(date),
      destination: null,
      opensDestination: false,
      journal: trip.journal[date] ?? null,
      photos: [],
      experiences: [],
    });
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
    default:
      return [];
  }
}

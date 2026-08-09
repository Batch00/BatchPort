// Year in Travel: one year of a travel log, folded into a paced recap.
//
// Pure and client-safe, exactly like lib/story.ts and for the same reason: the
// authenticated app, /demo, and /share/[slug] all already assemble StoryTrips
// from rows they hold, so the recap costs no query anywhere and the read-only
// surfaces can offer it without a second data layer.
//
// Three rules shape everything below.
//
//   1. A YEAR IS A SLICE, NOT A BUCKET. A trip that crosses new year belongs
//      to both years, and each year counts only the part that fell in it: its
//      days are clipped to the year, and a stop, an experience, or a photo
//      lands in the year its own date puts it in. A trip is never counted
//      whole in a year it only touched.
//   2. PLANNED IS NOT HISTORY. Planned trips and planned experiences are
//      excluded here as they are everywhere else, and a year that is still in
//      the future is never offered. The one place planned data appears is the
//      closing slide, which is explicitly about what is next.
//   3. NOTHING IS PADDED. Every slide past the opening has a condition, and a
//      thin year simply produces fewer slides. There are no empty scoreboards,
//      no "no highlights this year" cards, and no insight invented to fill a
//      category that the data does not support.

import { compareCurated, heroPhoto, stopPhotosFirst } from "@/lib/curation";
import { countryName, daysUntil, durationDays, formatDate } from "@/lib/format";
import { haversineKm } from "@/lib/geo";
import type { ReplayInputStop } from "@/lib/replay";
import type {
  StoryDestination,
  StoryExperience,
  StoryPhoto,
  StoryTrip,
} from "@/lib/story";
import { funDistanceComparison } from "@/lib/stats-format";
import type { TransportMode } from "@/lib/transport";

// --- Input ------------------------------------------------------------------

export interface YearRecapInput {
  /**
   * Every trip the profile holds, all years, planned included. The whole
   * history is needed rather than one year's worth: "countries you had never
   * been to before" is a question about the years before this one.
   */
  trips: StoryTrip[];
  /** Recorded transport mode per destination id, so the animated map draws the
   * same three arc families the globe does. Absent entries draw as air. */
  transportModes?: Record<string, TransportMode>;
  bucket?: { total: number; fulfilled: number } | null;
  /**
   * The bucket list itself, in the order the bucket page ranks it. The closing
   * slide names places rather than counting them: "0 of 7" is a scoreboard,
   * and the interesting part of a bucket list is which places are on it.
   * Optional, so a surface that has only the totals still renders the bar.
   */
  bucketItems?: YearBucketItem[];
  /** Today as YYYY-MM-DD. Passed in rather than read from the clock so the
   * "so far" year and the countdowns are deterministic and testable. */
  today: string;
}

// --- Output -----------------------------------------------------------------

export interface YearStats {
  trips: number;
  stops: number;
  countries: number;
  countryCodes: string[];
  /** Countries reached for the first time ever in this year. */
  newCountryCodes: string[];
  /** Days on the road, clipped to the year. */
  days: number;
  distanceKm: number;
  experiences: number;
  photos: number;
  journalEntries: number;
}

export interface YearMoment {
  id: string;
  name: string;
  /** Raw smallint 1-10, as everywhere else. */
  rating: number;
  destinationName: string;
  tripName: string;
  categoryIcon: string | null;
  categoryColor: string | null;
  /** Full size. The moments slide renders an 80px tile, but the same url is
   * what a future larger treatment would reach for, and the tile below has a
   * thumb of its own. */
  photoUrl: string | null;
  /** Thumbnail, for the moments slide's small square tile. */
  photoThumbUrl: string | null;
  /**
   * What the photograph is actually of.
   *
   * "experience" means a photo owned by this experience: it can be shown
   * plainly, because it is a picture of the thing being named. "place" means
   * the best the stop could offer, and the slide must render it as the place
   * rather than letting it pass for the thing. Null when there is no image at
   * all and the tile falls back to the category icon.
   */
  photoOf: "experience" | "place" | null;
}

export type YearInsightId =
  | "new-countries"
  | "busiest-month"
  | "most-explored"
  | "longest-trip";

export interface YearInsight {
  id: YearInsightId;
  /** The eyebrow: what question this answers. */
  label: string;
  /** The headline answer, on its own line and large. */
  value: string;
  /** One supporting sentence. */
  caption: string;
  /** Flags to render beside the value, when the insight is about places. */
  countryCodes: string[];
}

export interface YearTripSummary {
  id: string;
  name: string;
  /** Full size: a trip slide is the cover across the whole screen. */
  coverUrl: string | null;
  /** Thumbnail: the combined "year in trips" slide is a grid of small tiles,
   * and the placeholder behind the full-screen one. */
  coverThumbUrl: string | null;
  dateLabel: string;
  /** "Tokyo, Kyoto and 2 more", from the stops that fell in this year. */
  route: string;
  countryCodes: string[];
  stops: number;
  /** Days of this trip that fell inside the year. */
  days: number;
  experiences: number;
  best: { name: string; rating: number } | null;
}

export interface YearOpenerSlide {
  kind: "opener";
  key: string;
  year: number;
  label: string;
  inProgress: boolean;
  /** Full size: the opener is one photograph filling the screen. */
  heroUrl: string | null;
  /** The same image at thumbnail size, as its placeholder. */
  heroThumbUrl: string | null;
  subtitle: string;
}

export interface YearScaleSlide {
  kind: "scale";
  key: string;
  distanceKm: number;
  /** The same playful framing the stats page uses. */
  comparison: string;
  days: number;
  countries: number;
  countryCodes: string[];
}

export interface YearMapSlide {
  kind: "map";
  key: string;
  year: number;
  label: string;
  /** The year's stops, ready for buildReplayTimeline. */
  stops: ReplayInputStop[];
  countryCodes: string[];
}

export interface YearTripSlide {
  kind: "trip";
  key: string;
  position: number;
  total: number;
  trip: YearTripSummary;
}

export interface YearTripsSlide {
  kind: "trips";
  key: string;
  trips: YearTripSummary[];
}

export interface YearMomentsSlide {
  kind: "moments";
  key: string;
  moments: YearMoment[];
}

export interface YearInsightSlide {
  kind: "insight";
  key: string;
  insight: YearInsight;
}

/** One of the one or two numbers the scoreboard leads on, at real scale. */
export interface YearScoreLead {
  id: string;
  label: string;
  /** The number itself, for the count-up. */
  value: number;
  /** Rendered small beside it, e.g. "km". */
  unit: string | null;
  /** One line under it, e.g. the fun distance comparison. */
  caption: string | null;
}

/** Everything else, grouped small under the leads. */
export interface YearScoreStat {
  label: string;
  value: string;
  numeric: number | null;
}

/**
 * The year in numbers.
 *
 * Eight identical tiles is a report footer, not the payoff of a recap, so the
 * numbers are ranked rather than listed: the one or two that carry the year
 * get real scale and a line of framing, the rest are a quiet strip underneath,
 * and the year's own photograph is behind all of it. Nothing is padded, as
 * everywhere else here: a thin year simply has one lead and a short strip.
 */
export interface YearScoreboardSlide {
  kind: "scoreboard";
  key: string;
  label: string;
  leads: YearScoreLead[];
  stats: YearScoreStat[];
  countryCodes: string[];
  /** Full size: the backdrop is one photograph across the whole slide. */
  heroUrl: string | null;
  /** The same image at thumbnail size, as its placeholder. */
  heroThumbUrl: string | null;
  /** The sentence the year ends on. Null when there is nothing true to say. */
  closingLine: string | null;
}

export interface YearUpcoming {
  id: string;
  name: string;
  startDate: string | null;
  dateLabel: string;
  daysAway: number | null;
  countryCodes: string[];
}

/**
 * One bucket list entry, in the shape the recap needs it. Declared here rather
 * than imported from lib/bucket-list, which is a server module: the recap is
 * pure and client-safe, and the launchers already hold the rows.
 */
export interface YearBucketItem {
  id: string;
  type: "country" | "place";
  /** Already resolved for display: the country name, or the place name. */
  name: string;
  /** For the flag, and for the country hero lookup. */
  countryCode: string | null;
  /** Set on place items, and what their hero lookup is keyed on. */
  placeName: string | null;
  /** ISO timestamp, or null while it is still on the list. */
  fulfilledAt: string | null;
  fulfilledTripName: string | null;
}

export interface YearBucket {
  total: number;
  fulfilled: number;
  pct: number;
  /** Ticked off during THIS year. Completing one is the better story, so these
   * lead the block when there are any. */
  completed: YearBucketItem[];
  /** The highest-ranked places still to go, in the order the bucket page puts
   * them. Empty on a list with nothing left, which is its own good ending. */
  upNext: YearBucketItem[];
}

export interface YearClosingSlide {
  kind: "closing";
  key: string;
  year: number;
  label: string;
  bucket: YearBucket | null;
  upcoming: YearUpcoming[];
}

export type YearSlide =
  | YearOpenerSlide
  | YearScaleSlide
  | YearMapSlide
  | YearTripSlide
  | YearTripsSlide
  | YearMomentsSlide
  | YearInsightSlide
  | YearScoreboardSlide
  | YearClosingSlide;

export interface YearRecap {
  year: number;
  /** "2024", or "2026 so far" while the year is still running. */
  label: string;
  inProgress: boolean;
  stats: YearStats;
  moments: YearMoment[];
  insights: YearInsight[];
  trips: YearTripSummary[];
  /**
   * The year's route, as the animated map and the year card both draw it.
   * Exposed on the recap rather than only on the map slide because the card
   * still wants a map on a year too thin to earn an animated one.
   */
  mapStops: ReplayInputStop[];
  slides: YearSlide[];
}

// --- Tuning -----------------------------------------------------------------

/** Past this many trips the year gets one combined slide instead of one each:
 * eleven near-identical slides is a list, not a story. */
const MAX_TRIP_SLIDES = 5;
/** The combined slide's cover grid, and the cap on what it names. */
const MAX_COMBINED_TRIPS = 9;
const MAX_MOMENTS = 3;
const MAX_INSIGHTS = 2;
const MAX_UPCOMING = 3;
const MAX_ROUTE_STOPS = 3;
/** Three tiles fill a row and stay a glance. A bucket list of forty is not
 * more interesting at forty than at three; it is just a list. */
const MAX_BUCKET_UP_NEXT = 3;
/** Ticking one off is the better story, so it gets room, but a year that
 * cleared eight of them still closes on a slide rather than an inventory. */
const MAX_BUCKET_COMPLETED = 3;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// --- Date helpers -----------------------------------------------------------

/** The date part of a date or timestamp string, or null when it is neither. */
function dayOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function yearOf(date: string | null): number | null {
  return date ? Number(date.slice(0, 4)) : null;
}

interface DateRange {
  start: string;
  end: string;
}

/**
 * The span a trip covers. The stored columns are already the derived range on
 * anything that came through getProfileTrips, but the stops are consulted too
 * so a StoryTrip assembled anywhere else still resolves.
 */
function tripRange(trip: StoryTrip): DateRange | null {
  const dates: string[] = [];
  const start = dayOf(trip.startDate);
  const end = dayOf(trip.endDate);
  if (start) dates.push(start);
  if (end) dates.push(end);
  for (const destination of trip.destinations) {
    const arrival = dayOf(destination.arrivalDate);
    const departure = dayOf(destination.departureDate);
    if (arrival) dates.push(arrival);
    if (departure) dates.push(departure);
  }
  if (dates.length === 0) return null;
  dates.sort();
  return { start: dates[0], end: dates[dates.length - 1] };
}

/** The part of a range that falls inside a calendar year, or null. YYYY-MM-DD
 * sorts lexicographically, so plain string comparison is the whole of it. */
function clipToYear(range: DateRange, year: number): DateRange | null {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const start = range.start > yearStart ? range.start : yearStart;
  const end = range.end < yearEnd ? range.end : yearEnd;
  return start <= end ? { start, end } : null;
}

/** Every YYYY-MM-DD in an inclusive range. Bounded by construction: callers
 * only ever pass a range already clipped to one year. */
function eachDay(range: DateRange): string[] {
  const days: string[] = [];
  let cursor = Date.parse(`${range.start}T00:00:00Z`);
  const last = Date.parse(`${range.end}T00:00:00Z`);
  if (Number.isNaN(cursor) || Number.isNaN(last)) return days;
  while (cursor <= last) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += 86_400_000;
  }
  return days;
}

/** "Mar 4 to Mar 19", or a single date when a trip lasted a day. */
function rangeLabel(range: DateRange): string {
  if (range.start === range.end) return formatDate(range.start);
  return `${formatDate(range.start)} to ${formatDate(range.end)}`;
}

// --- Slicing ----------------------------------------------------------------

/**
 * The year a stop belongs to: its own date when it has one, otherwise the
 * year its trip started. An undated stop on a trip that crossed new year lands
 * in the trip's first year, which is the only answer available and is why the
 * fallback is stated rather than hidden.
 */
function stopYear(stop: StoryDestination, tripYear: number | null): number | null {
  return yearOf(dayOf(stop.arrivalDate) ?? dayOf(stop.departureDate)) ?? tripYear;
}

interface YearTrip {
  trip: StoryTrip;
  range: DateRange;
  /** The part of the trip that fell in the year. */
  yearRange: DateRange;
  /** The stops whose own dates put them in the year, in visit order. */
  stops: StoryDestination[];
  experiences: { experience: StoryExperience; destination: StoryDestination }[];
  photos: StoryPhoto[];
  journalDates: string[];
  days: number;
  distanceKm: number;
}

function isHistory(trip: StoryTrip): boolean {
  return trip.status !== "planned";
}

/**
 * Distance flown or driven in the year, as consecutive-stop great circles.
 * A leg counts toward the year its ARRIVING stop falls in, which is the same
 * rule transport legs already use, so a hop over new year is counted once and
 * on the right side.
 */
function yearDistanceKm(
  destinations: StoryDestination[],
  yearOfStop: (stop: StoryDestination) => number | null,
  year: number,
): number {
  const located = destinations.filter(
    (stop) => stop.latitude !== null && stop.longitude !== null,
  );
  let total = 0;
  for (let i = 1; i < located.length; i += 1) {
    if (yearOfStop(located[i]) !== year) continue;
    total += haversineKm(
      located[i - 1].latitude as number,
      located[i - 1].longitude as number,
      located[i].latitude as number,
      located[i].longitude as number,
    );
  }
  return total;
}

function sliceYear(trips: StoryTrip[], year: number): YearTrip[] {
  const sliced: YearTrip[] = [];
  for (const trip of trips) {
    if (!isHistory(trip)) continue;
    const range = tripRange(trip);
    if (!range) continue;
    const yearRange = clipToYear(range, year);
    if (!yearRange) continue;

    const tripYear = yearOf(range.start);
    const yearOfStop = (stop: StoryDestination) => stopYear(stop, tripYear);
    const stops = trip.destinations.filter(
      (stop) => yearOfStop(stop) === year,
    );
    const stopById = new Map(
      trip.destinations.map((stop) => [stop.id, stop] as const),
    );

    const experiences: YearTrip["experiences"] = [];
    for (const destination of trip.destinations) {
      for (const experience of destination.experiences) {
        const own = yearOf(dayOf(experience.visitedDate));
        const resolved = own ?? yearOfStop(destination);
        if (resolved === year) experiences.push({ experience, destination });
      }
    }

    const photos = trip.photos.filter((photo) => {
      const own = yearOf(dayOf(photo.dateTaken));
      if (own !== null) return own === year;
      const stop = photo.destinationId
        ? stopById.get(photo.destinationId)
        : undefined;
      return (stop ? yearOfStop(stop) : tripYear) === year;
    });

    const journalDates = Object.keys(trip.journal).filter(
      (date) => yearOf(dayOf(date)) === year,
    );

    sliced.push({
      trip,
      range,
      yearRange,
      stops,
      experiences,
      photos,
      journalDates,
      days: durationDays(yearRange.start, yearRange.end) ?? 0,
      distanceKm: yearDistanceKm(trip.destinations, yearOfStop, year),
    });
  }
  // Chronological, because a recap reads forward through the year.
  sliced.sort((a, b) => a.yearRange.start.localeCompare(b.yearRange.start));
  return sliced;
}

/** Every country reached before a given year, for the first-visit insight. */
function countriesBefore(trips: StoryTrip[], year: number): Set<string> {
  const codes = new Set<string>();
  for (const trip of trips) {
    if (!isHistory(trip)) continue;
    const range = tripRange(trip);
    if (!range) continue;
    const tripYear = yearOf(range.start);
    for (const stop of trip.destinations) {
      if (!stop.countryCode) continue;
      const resolved = stopYear(stop, tripYear);
      if (resolved !== null && resolved < year) codes.add(stop.countryCode);
    }
  }
  return codes;
}

// --- Year list --------------------------------------------------------------

/**
 * The years worth replaying, most recent first: every year touched by a trip
 * that actually happened. A year with nothing in it is never offered, and
 * neither is one that has not arrived yet, so the selector can never lead to
 * an empty recap.
 */
export function recapYears(trips: StoryTrip[], today: string): number[] {
  const currentYear = Number(today.slice(0, 4));
  if (!Number.isFinite(currentYear)) return [];
  const years = new Set<number>();
  for (const trip of trips) {
    if (!isHistory(trip)) continue;
    const range = tripRange(trip);
    if (!range) continue;
    const first = Number(range.start.slice(0, 4));
    const last = Number(range.end.slice(0, 4));
    for (let year = first; year <= Math.min(last, currentYear); year += 1) {
      years.add(year);
    }
  }
  return Array.from(years).sort((a, b) => b - a);
}

/** The year a recap should open on: the most recent one with anything in it. */
export function defaultRecapYear(
  trips: StoryTrip[],
  today: string,
): number | null {
  return recapYears(trips, today)[0] ?? null;
}

// --- Insights ---------------------------------------------------------------

interface InsightCandidate {
  insight: YearInsight;
  /** Higher wins. Only the strongest few reach a slide. */
  score: number;
}

/**
 * Scoring is banded, not free-form: each kind of insight has a base that fixes
 * its rank against the others, and a bounded bonus that only breaks ties within
 * its own band. Letting the bonuses grow without limit meant a wide margin on
 * the weakest question ("your busiest month") could outrank the strongest one,
 * which is how a recap ends up leading on a fact nobody asked for.
 *
 * The order is deliberate. Somewhere you had never been beats where you spent
 * the most time, which beats how long the longest trip was, which beats which
 * month it happened in.
 */
const INSIGHT_BASE = {
  newCountries: 100,
  mostExplored: 70,
  longestTrip: 55,
  busiestMonth: 40,
};
const INSIGHT_BONUS_CAP = 10;

function bonus(value: number): number {
  return Math.min(INSIGHT_BONUS_CAP, Math.max(0, value));
}

function busiestMonth(
  yearTrips: YearTrip[],
): { month: number; days: number; trips: number; runnerUp: number } | null {
  const days = new Array(12).fill(0) as number[];
  const trips = new Array(12).fill(0) as number[];
  for (const entry of yearTrips) {
    const seen = new Set<number>();
    for (const date of eachDay(entry.yearRange)) {
      const month = Number(date.slice(5, 7)) - 1;
      if (month < 0 || month > 11) continue;
      days[month] += 1;
      seen.add(month);
    }
    for (const month of seen) trips[month] += 1;
  }
  let best = -1;
  for (let month = 0; month < 12; month += 1) {
    if (best === -1 || days[month] > days[best]) best = month;
  }
  if (best === -1 || days[best] === 0) return null;
  const runnerUp = days
    .filter((_, month) => month !== best)
    .reduce((max, value) => Math.max(max, value), 0);
  return { month: best, days: days[best], trips: trips[best], runnerUp };
}

function buildInsights(
  yearTrips: YearTrip[],
  stats: YearStats,
): YearInsight[] {
  const candidates: InsightCandidate[] = [];

  // Somewhere new. The strongest thing a year can say, and the only one that
  // needs the years before it, which is why the whole history is an input.
  if (stats.newCountryCodes.length > 0) {
    const names = stats.newCountryCodes.map(countryName);
    candidates.push({
      score: INSIGHT_BASE.newCountries + bonus(stats.newCountryCodes.length),
      insight: {
        id: "new-countries",
        label: "Somewhere new",
        value:
          names.length === 1
            ? names[0]
            : `${names.length} countries for the first time`,
        caption:
          names.length === 1
            ? "The first time you had set foot there."
            : names.join(", "),
        countryCodes: stats.newCountryCodes,
      },
    });
  }

  // The country the year kept returning to. Meaningless when the year only
  // went to one country, and not a pattern on a single stop.
  const stopsByCountry = new Map<string, number>();
  for (const entry of yearTrips) {
    for (const stop of entry.stops) {
      if (!stop.countryCode) continue;
      stopsByCountry.set(
        stop.countryCode,
        (stopsByCountry.get(stop.countryCode) ?? 0) + 1,
      );
    }
  }
  let topCountry: { code: string; stops: number } | null = null;
  let runnerUpStops = 0;
  for (const [code, count] of stopsByCountry) {
    if (!topCountry || count > topCountry.stops) {
      if (topCountry) runnerUpStops = Math.max(runnerUpStops, topCountry.stops);
      topCountry = { code, stops: count };
    } else {
      runnerUpStops = Math.max(runnerUpStops, count);
    }
  }
  // A strict winner or nothing. Two countries tied at three stops each is not
  // "where you went deepest", and the caption would be a plain untruth.
  if (
    topCountry &&
    topCountry.stops >= 2 &&
    stopsByCountry.size >= 2 &&
    topCountry.stops > runnerUpStops
  ) {
    candidates.push({
      score: INSIGHT_BASE.mostExplored + bonus(topCountry.stops),
      insight: {
        id: "most-explored",
        label: "Where you went deepest",
        value: countryName(topCountry.code),
        caption: `${topCountry.stops} stops there, more than anywhere else this year.`,
        countryCodes: [topCountry.code],
      },
    });
  }

  // The month the year happened in. Only when there is a clear winner: two
  // months tied at four days each is not a finding.
  const month = busiestMonth(yearTrips);
  if (month && stats.trips >= 2 && month.days > month.runnerUp) {
    candidates.push({
      score: INSIGHT_BASE.busiestMonth + bonus(month.days - month.runnerUp),
      insight: {
        id: "busiest-month",
        label: "Your busiest month",
        value: MONTHS[month.month],
        caption: `${month.days} ${month.days === 1 ? "day" : "days"} away across ${
          month.trips
        } ${month.trips === 1 ? "trip" : "trips"}.`,
        countryCodes: [],
      },
    });
  }

  // The longest single trip. Nothing to compare against with one trip, and the
  // trip slide has already said how long it was.
  if (yearTrips.length >= 2) {
    let longest: YearTrip | null = null;
    let longestDays = 0;
    for (const entry of yearTrips) {
      const days = durationDays(entry.range.start, entry.range.end) ?? 0;
      if (days > longestDays) {
        longest = entry;
        longestDays = days;
      }
    }
    if (longest && longestDays > 1) {
      const codes = Array.from(
        new Set(
          longest.stops
            .map((stop) => stop.countryCode)
            .filter((code): code is string => Boolean(code)),
        ),
      );
      candidates.push({
        score: INSIGHT_BASE.longestTrip + bonus(longestDays),
        insight: {
          id: "longest-trip",
          label: "Your longest run",
          value: longest.trip.name,
          caption: `${longestDays} days, ${longest.stops.length} ${
            longest.stops.length === 1 ? "stop" : "stops"
          }.`,
          countryCodes: codes,
        },
      });
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_INSIGHTS)
    .map((candidate) => candidate.insight);
}

// --- Assembly ---------------------------------------------------------------

function routeSummary(stops: StoryDestination[]): string {
  const names = stops.map((stop) => stop.name);
  if (names.length === 0) return "";
  if (names.length <= MAX_ROUTE_STOPS) return names.join(", ");
  return `${names.slice(0, MAX_ROUTE_STOPS).join(", ")} and ${
    names.length - MAX_ROUTE_STOPS
  } more`;
}

function tripSummary(entry: YearTrip): YearTripSummary {
  const rated = entry.experiences
    .map(({ experience }) => experience)
    .filter(
      (experience): experience is StoryExperience & { rating: number } =>
        experience.rating !== null,
    )
    .sort(compareCurated);
  return {
    id: entry.trip.id,
    name: entry.trip.name,
    coverUrl: entry.trip.coverUrl,
    coverThumbUrl: entry.trip.coverThumbUrl ?? entry.trip.coverUrl,
    dateLabel: rangeLabel(entry.yearRange),
    route: routeSummary(entry.stops),
    countryCodes: Array.from(
      new Set(
        entry.stops
          .map((stop) => stop.countryCode)
          .filter((code): code is string => Boolean(code)),
      ),
    ),
    stops: entry.stops.length,
    days: entry.days,
    experiences: entry.experiences.length,
    best: rated[0] ? { name: rated[0].name, rating: rated[0].rating } : null,
  };
}

/**
 * The year's moments: the experiences the traveller featured, then the
 * best-rated of the rest, each carrying a photograph. Ties break on the name,
 * so the same year always produces the same recap.
 *
 * THE PHOTOGRAPH MUST BE OF THE THING NAMED, OR SAY THAT IT IS NOT.
 *
 * This used to take the first photo at the experience's STOP, which on any
 * stop with more than one photograph meant the slide captioned somebody's
 * lunch with the name of a cathedral. A photo owned by the experience is the
 * only image that is genuinely of it; the stop's cover is a picture of the
 * place, offered as such (see photoOf) and rendered differently by the slide.
 */
function buildMoments(yearTrips: YearTrip[]): YearMoment[] {
  const rated: { entry: YearTrip; item: YearTrip["experiences"][number] }[] = [];
  for (const entry of yearTrips) {
    for (const item of entry.experiences) {
      if (item.experience.rating === null) continue;
      rated.push({ entry, item });
    }
  }
  rated.sort((a, b) => compareCurated(a.item.experience, b.item.experience));
  return rated.slice(0, MAX_MOMENTS).map(({ entry, item }) => {
    // A photo elected into a slot beats an arbitrary one, for the same reason
    // a featured experience beats a merely well-rated one. The filter is on
    // the EXPERIENCE, which is the whole of the fix.
    const own = stopPhotosFirst(
      entry.photos.filter(
        (candidate) => candidate.experienceId === item.experience.id,
      ),
    )[0];
    const placeUrl = item.destination.coverUrl ?? null;
    const placeThumbUrl =
      item.destination.coverThumbUrl ?? item.destination.coverUrl ?? null;
    const photoUrl = own?.url ?? placeUrl;
    return {
      id: item.experience.id,
      name: item.experience.name,
      rating: item.experience.rating as number,
      destinationName: item.destination.name,
      tripName: entry.trip.name,
      categoryIcon: item.experience.categoryIcon,
      categoryColor: item.experience.categoryColor,
      photoUrl,
      photoThumbUrl: own?.thumbUrl ?? placeThumbUrl,
      photoOf: own ? "experience" : photoUrl ? "place" : null,
    };
  });
}

/**
 * The image the recap opens on. A photograph elected into a trip's HERO slot
 * comes first, because that is the one question this picture asks and the hero
 * slot is the only direct answer to it. A year can hold several trips and so
 * several heroes; the earliest trip's wins, which is where the year started.
 * Otherwise a real photograph from the year, taken as early in it as one is
 * dated; otherwise the cover of its longest trip, which is an image somebody
 * (or Wikimedia) already chose as representative.
 *
 * A stop pick is deliberately not a candidate: electing four photos to lead
 * one stop's story slides says nothing about which frame should open a year.
 */
function heroImage(yearTrips: YearTrip[]): {
  url: string | null;
  thumbUrl: string | null;
} {
  for (const entry of yearTrips) {
    const hero = heroPhoto(entry.photos);
    if (hero) return { url: hero.url, thumbUrl: hero.thumbUrl };
  }
  const photos = yearTrips.flatMap((entry) => entry.photos);
  const dated = photos
    .filter((photo) => dayOf(photo.dateTaken) !== null)
    .sort((a, b) =>
      (dayOf(a.dateTaken) ?? "").localeCompare(dayOf(b.dateTaken) ?? ""),
    );
  const chosen =
    dated[0] ?? photos.find((photo) => dayOf(photo.dateTaken) === null);
  if (chosen) return { url: chosen.url, thumbUrl: chosen.thumbUrl };
  let longest: YearTrip | null = null;
  for (const entry of yearTrips) {
    if (!entry.trip.coverUrl) continue;
    if (!longest || entry.days > longest.days) longest = entry;
  }
  return {
    url: longest?.trip.coverUrl ?? null,
    thumbUrl: longest?.trip.coverThumbUrl ?? longest?.trip.coverUrl ?? null,
  };
}

function replayStops(
  yearTrips: YearTrip[],
  transportModes: Record<string, TransportMode>,
): ReplayInputStop[] {
  const stops: ReplayInputStop[] = [];
  for (const entry of yearTrips) {
    // The map animates the route as it was walked, so it uses every stop on a
    // trip that touched the year, not only the ones dated inside it. Cutting a
    // route in half at midnight on new year would draw a journey nobody made.
    entry.trip.destinations.forEach((stop, index) => {
      if (stop.latitude === null || stop.longitude === null) return;
      stops.push({
        tripId: entry.trip.id,
        tripName: entry.trip.name,
        tripStartDate: entry.trip.startDate,
        tripEndDate: entry.trip.endDate,
        orderIndex: index,
        name: stop.name,
        countryCode: stop.countryCode,
        lat: stop.latitude,
        lng: stop.longitude,
        arrivalDate: stop.arrivalDate,
        planned: false,
        transportMode: transportModes[stop.id] ?? null,
      });
    });
  }
  return stops;
}

/**
 * The bucket block on the closing slide. The bar alone said "0 of 7", which is
 * a scoreboard for a thing that is not a game: what a bucket list is actually
 * about is the places on it, so the block names them.
 *
 * Two halves, and the order between them is deliberate. What was ticked off
 * THIS year comes first, because that is the year's own achievement and the
 * recap is about the year. What is still to go follows, in the order the
 * bucket page ranks it, because the slide is also the one that looks forward.
 */
function yearBucket(
  totals: { total: number; fulfilled: number } | null | undefined,
  items: YearBucketItem[],
  year: number,
): YearBucket | null {
  // The totals come from the SQL view and are the authority on the count; the
  // items are what the block draws. Either alone is enough to render nothing
  // useful, so a list with neither is simply absent.
  const total = totals?.total ?? items.length;
  if (total === 0) return null;
  const fulfilled =
    totals?.fulfilled ?? items.filter((item) => item.fulfilledAt).length;
  const completed = items
    .filter((item) => yearOf(dayOf(item.fulfilledAt)) === year)
    .slice(0, MAX_BUCKET_COMPLETED);
  const upNext = items
    .filter((item) => !item.fulfilledAt)
    .slice(0, MAX_BUCKET_UP_NEXT);
  return {
    total,
    fulfilled,
    pct: Math.round((fulfilled / total) * 100),
    completed,
    upNext,
  };
}

/**
 * The scoreboard: which numbers lead, which support, and the line it ends on.
 *
 * The lead order is fixed rather than scored, for the same reason the insight
 * bands are: distance and countries are what a year of travel is, and letting
 * a big photo count outrank them is how the payoff slide ends up leading on
 * "1,412 photos". At most two lead; everything else that is non-zero drops
 * into the strip in the same order it always had.
 */
function buildScoreboard(
  stats: YearStats,
  label: string,
  hero: { url: string | null; thumbUrl: string | null },
): YearScoreboardSlide | null {
  const candidates: YearScoreLead[] = [];
  if (stats.distanceKm > 0) {
    candidates.push({
      id: "distance",
      label: "Kilometres",
      value: stats.distanceKm,
      unit: "km",
      caption: funDistanceComparison(stats.distanceKm),
    });
  }
  if (stats.countries > 0) {
    candidates.push({
      id: "countries",
      label: stats.countries === 1 ? "Country" : "Countries",
      value: stats.countries,
      unit: null,
      caption:
        stats.newCountryCodes.length > 0
          ? `${stats.newCountryCodes.length} of them for the first time`
          : null,
    });
  }
  if (stats.days > 0) {
    candidates.push({
      id: "days",
      label: "Days away",
      value: stats.days,
      unit: null,
      caption: null,
    });
  }
  if (stats.trips > 0) {
    candidates.push({
      id: "trips",
      label: stats.trips === 1 ? "Trip" : "Trips",
      value: stats.trips,
      unit: null,
      caption: null,
    });
  }

  const leads = candidates.slice(0, 2);
  const led = new Set(leads.map((lead) => lead.id));

  const stats_: YearScoreStat[] = [];
  const stat = (statLabel: string, value: string, numeric: number | null) =>
    stats_.push({ label: statLabel, value, numeric });
  if (stats.countries > 0 && !led.has("countries")) {
    stat(
      stats.countries === 1 ? "Country" : "Countries",
      String(stats.countries),
      stats.countries,
    );
  }
  if (stats.trips > 0 && !led.has("trips")) {
    stat(stats.trips === 1 ? "Trip" : "Trips", String(stats.trips), stats.trips);
  }
  if (stats.stops > 0) {
    stat(stats.stops === 1 ? "Stop" : "Stops", String(stats.stops), stats.stops);
  }
  if (stats.days > 0 && !led.has("days")) {
    stat("Days away", String(stats.days), stats.days);
  }
  if (stats.distanceKm > 0 && !led.has("distance")) {
    stat("Kilometres", stats.distanceKm.toLocaleString("en-US"), stats.distanceKm);
  }
  if (stats.experiences > 0) {
    stat("Experiences", String(stats.experiences), stats.experiences);
  }
  if (stats.photos > 0) stat("Photos", String(stats.photos), stats.photos);
  if (stats.journalEntries > 0) {
    stat("Journal days", String(stats.journalEntries), stats.journalEntries);
  }

  if (leads.length === 0 && stats_.length === 0) return null;

  return {
    kind: "scoreboard",
    key: "scoreboard",
    label,
    leads,
    stats: stats_,
    countryCodes: stats.countryCodes,
    heroUrl: hero.url,
    heroThumbUrl: hero.thumbUrl,
    closingLine: closingLine(stats),
  };
}

/**
 * The sentence the year ends on. A ladder rather than a template, because the
 * strongest true thing about a year differs: somewhere new beats time away
 * beats sheer volume. Null when none of them is true, and the slide simply
 * stops after the numbers rather than reaching for something to say.
 */
function closingLine(stats: YearStats): string | null {
  const count = stats.newCountryCodes.length;
  if (count > 0) {
    return count === 1
      ? `And one country you had never set foot in before.`
      : `And ${count} countries you had never set foot in before.`;
  }
  if (stats.days > 0 && stats.trips > 1) {
    return `${stats.days} ${stats.days === 1 ? "day" : "days"} away, across ${
      stats.trips
    } trips.`;
  }
  if (stats.days > 0) {
    return `${stats.days} ${
      stats.days === 1 ? "day" : "days"
    } of the year spent somewhere else.`;
  }
  if (stats.photos > 0) {
    return `${stats.photos.toLocaleString("en-US")} ${
      stats.photos === 1 ? "photograph" : "photographs"
    } to prove it.`;
  }
  return null;
}

function upcomingTrips(
  trips: StoryTrip[],
  today: string,
): YearUpcoming[] {
  const ahead: YearUpcoming[] = [];
  for (const trip of trips) {
    if (trip.status !== "planned") continue;
    const range = tripRange(trip);
    // A planned trip with no dates has nothing to count down to, but it is
    // still something to look forward to, so it rides at the back of the list.
    const start = range?.start ?? null;
    if (start && start < today) continue;
    ahead.push({
      id: trip.id,
      name: trip.name,
      startDate: start,
      dateLabel: range ? rangeLabel(range) : "Dates to be decided",
      daysAway: start ? daysUntil(start) : null,
      countryCodes: Array.from(
        new Set(
          trip.destinations
            .map((stop) => stop.countryCode)
            .filter((code): code is string => Boolean(code)),
        ),
      ),
    });
  }
  ahead.sort((a, b) => {
    if (a.startDate && b.startDate) return a.startDate.localeCompare(b.startDate);
    if (a.startDate) return -1;
    if (b.startDate) return 1;
    return a.name.localeCompare(b.name);
  });
  return ahead.slice(0, MAX_UPCOMING);
}

/**
 * Fold one year into its recap. Always returns at least an opener, a
 * scoreboard, and a closing, so the view never has to handle an empty
 * sequence; everything between them is conditional on there being something
 * to say.
 */
export function buildYearRecap(
  input: YearRecapInput,
  year: number,
): YearRecap {
  const transportModes = input.transportModes ?? {};
  const currentYear = Number(input.today.slice(0, 4));
  const inProgress = year === currentYear;
  const label = inProgress ? `${year} so far` : String(year);

  const yearTrips = sliceYear(input.trips, year);
  const prior = countriesBefore(input.trips, year);

  const countryCodes: string[] = [];
  const seenCountries = new Set<string>();
  for (const entry of yearTrips) {
    for (const stop of entry.stops) {
      if (!stop.countryCode || seenCountries.has(stop.countryCode)) continue;
      seenCountries.add(stop.countryCode);
      countryCodes.push(stop.countryCode);
    }
  }

  const stats: YearStats = {
    trips: yearTrips.length,
    stops: yearTrips.reduce((total, entry) => total + entry.stops.length, 0),
    countries: countryCodes.length,
    countryCodes,
    newCountryCodes: countryCodes.filter((code) => !prior.has(code)),
    days: yearTrips.reduce((total, entry) => total + entry.days, 0),
    distanceKm: Math.round(
      yearTrips.reduce((total, entry) => total + entry.distanceKm, 0),
    ),
    experiences: yearTrips.reduce(
      (total, entry) => total + entry.experiences.length,
      0,
    ),
    photos: yearTrips.reduce((total, entry) => total + entry.photos.length, 0),
    journalEntries: yearTrips.reduce(
      (total, entry) => total + entry.journalDates.length,
      0,
    ),
  };

  const trips = yearTrips.map(tripSummary);
  const moments = buildMoments(yearTrips);
  const insights = buildInsights(yearTrips, stats);
  const upcoming = upcomingTrips(input.trips, input.today);

  const slides: YearSlide[] = [];

  const hero = heroImage(yearTrips);
  slides.push({
    kind: "opener",
    key: "opener",
    year,
    label,
    inProgress,
    heroUrl: hero.url,
    heroThumbUrl: hero.thumbUrl,
    subtitle: inProgress ? "Your year in travel, so far" : "Your year in travel",
  });

  // The scale of it. Absent when the year has neither distance nor days to
  // quote, which only happens on a year of undated single stops.
  if (stats.distanceKm > 0 || stats.days > 0) {
    slides.push({
      kind: "scale",
      key: "scale",
      distanceKm: stats.distanceKm,
      comparison: funDistanceComparison(stats.distanceKm),
      days: stats.days,
      countries: stats.countries,
      countryCodes: stats.countryCodes,
    });
  }

  // The map. Two stops is the minimum for a route worth drawing; a single
  // located stop is a dot, and the country fill on the scale slide said it.
  const stops = replayStops(yearTrips, transportModes);
  if (stops.length >= 2) {
    slides.push({
      kind: "map",
      key: "map",
      year,
      label,
      stops,
      countryCodes: stats.countryCodes,
    });
  }

  if (trips.length > 0 && trips.length <= MAX_TRIP_SLIDES) {
    trips.forEach((trip, index) => {
      slides.push({
        kind: "trip",
        key: `trip:${trip.id}`,
        position: index + 1,
        total: trips.length,
        trip,
      });
    });
  } else if (trips.length > MAX_TRIP_SLIDES) {
    slides.push({
      kind: "trips",
      key: "trips",
      trips: trips.slice(0, MAX_COMBINED_TRIPS),
    });
  }

  if (moments.length > 0) {
    slides.push({ kind: "moments", key: "moments", moments });
  }

  for (const insight of insights) {
    slides.push({ kind: "insight", key: `insight:${insight.id}`, insight });
  }

  const scoreboard = buildScoreboard(stats, label, hero);
  if (scoreboard) slides.push(scoreboard);

  slides.push({
    kind: "closing",
    key: "closing",
    year,
    label,
    bucket: yearBucket(input.bucket, input.bucketItems ?? [], year),
    upcoming,
  });

  return {
    year,
    label,
    inProgress,
    stats,
    moments,
    insights,
    trips,
    mapStops: stops,
    slides,
  };
}

/**
 * Today, as the recap's input wants it. The one impure function in this file,
 * kept here so every surface resolves it the same way: on the server, before
 * the launcher renders, so the offered years and the "so far" label cannot
 * differ across hydration.
 */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Whether a recap is worth offering at all: at least one trip that happened
 * and is dated. Callers hide the affordance rather than opening nothing. */
export function hasRecap(trips: StoryTrip[], today: string): boolean {
  return recapYears(trips, today).length > 0;
}

// Travel journal: freeform daily writing on a trip, distinct from the notes
// hanging off an individual experience. An experience note answers "what was
// this place like"; a journal entry answers "what was this day like".
//
// Pure and client-safe. The server read lives in journal-data.ts and the
// mutation in actions/journal.ts, mirroring the nearby / nearby-data split.
//
// The one structural decision worth knowing: an entry is keyed by a DATE, not
// by a destination. Which stop a day belongs to is already decided by the
// destination arrival/departure ranges, so it is derived here rather than
// stored (see the schema comment in scripts/sql/2026-08-02-journal.sql).

/** One saved day. `body` is never blank: clearing the text deletes the row. */
export interface JournalEntry {
  entry_date: string;
  body: string;
}

/** A day of a trip, with the stop it falls in when one claims it. */
export interface JournalDay {
  /** YYYY-MM-DD. */
  date: string;
  /** The stop whose stay contains this date, or null on a travel/gap day. */
  destinationId: string | null;
  destinationName: string | null;
  /** 1-based position within the trip, for the "Day 3" label. */
  index: number;
  /** The saved entry text, or null when nothing has been written yet. */
  body: string | null;
}

// A trip long enough to blow past this is not a day-by-day journal any more,
// and rendering 200 rows would bury the days that actually have writing in
// them. Past the cap the trip page falls back to listing only the days that
// already carry an entry.
export const MAX_JOURNAL_DAYS = 90;

/** A minimal stop shape, so both the trip page's full rows and the read-only
 * profile shape can feed the same helpers. */
export interface JournalDestination {
  id: string;
  name: string;
  arrival_date: string | null;
  departure_date: string | null;
}

function addDays(date: string, days: number): string {
  const time = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(value: string | null | undefined): value is string {
  return typeof value === "string" && ISO_DATE.test(value);
}

/** Whole days from `start` to `end`. Both are UTC-anchored, so no daylight
 * saving shift can land this on a fraction. */
function daysBetween(start: string, end: string): number {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
      86_400_000,
  );
}

/** Every date from `start` to `end` inclusive, capped at `limit` days. */
export function dateRange(start: string, end: string, limit: number): string[] {
  const dates: string[] = [];
  let cursor = start;
  while (cursor <= end && dates.length < limit) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

/**
 * The stop a date belongs to: the first destination (in visit order) whose
 * stay contains it. Undated stops claim nothing, and a date between two stays
 * belongs to neither, which is exactly right for a travel day.
 */
export function destinationForDate<T extends JournalDestination>(
  destinations: T[],
  date: string,
): T | null {
  for (const destination of destinations) {
    const arrival = destination.arrival_date;
    if (!isDate(arrival)) continue;
    const departure = isDate(destination.departure_date)
      ? destination.departure_date
      : arrival;
    if (arrival <= date && date <= departure) return destination;
  }
  return null;
}

/** The trip's first and last day, from the trip's own dates when it has them,
 * otherwise from the span its stops cover. Null when nothing is dated. */
export function tripWindow(
  trip: { start_date: string | null; end_date: string | null },
  destinations: JournalDestination[],
): { start: string; end: string } | null {
  const dates: string[] = [];
  if (isDate(trip.start_date)) dates.push(trip.start_date);
  if (isDate(trip.end_date)) dates.push(trip.end_date);
  for (const destination of destinations) {
    if (isDate(destination.arrival_date)) dates.push(destination.arrival_date);
    if (isDate(destination.departure_date)) {
      dates.push(destination.departure_date);
    }
  }
  if (dates.length === 0) return null;
  dates.sort();
  return { start: dates[0], end: dates[dates.length - 1] };
}

/**
 * The day rows the trip page's journal section renders: one per calendar day
 * of the trip, each carrying the stop it falls in and any text already saved.
 *
 * A trip past MAX_JOURNAL_DAYS collapses to just the days that already have an
 * entry, so a six month trip still shows its writing without a 180-row list.
 * Returns an empty array when the trip has no dates at all (there is no day
 * structure to hang writing on, and inventing one would be worse than absent).
 */
export function journalDays(
  trip: { start_date: string | null; end_date: string | null },
  destinations: JournalDestination[],
  entries: JournalEntry[],
): JournalDay[] {
  const window = tripWindow(trip, destinations);
  if (!window) return [];

  const bodyByDate = new Map(
    entries.map((entry) => [entry.entry_date.slice(0, 10), entry.body]),
  );

  const all = dateRange(window.start, window.end, MAX_JOURNAL_DAYS + 1);
  const overLimit = all.length > MAX_JOURNAL_DAYS;
  const dates = overLimit
    ? all.filter((date) => bodyByDate.has(date))
    : all;

  return dates.map((date, position) => {
    const destination = destinationForDate(destinations, date);
    return {
      date,
      destinationId: destination?.id ?? null,
      destinationName: destination?.name ?? null,
      // Over the cap the visible rows are a subset, so the index counts from
      // the real trip start rather than from the filtered list.
      index: overLimit ? daysBetween(window.start, date) + 1 : position + 1,
      body: bodyByDate.get(date) ?? null,
    };
  });
}

/** "Tue, Apr 14" for a day header. The explicit midnight keeps the rendered
 * day stable regardless of the reader's timezone. */
export function journalDayLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** First line of an entry, trimmed for a collapsed row preview. */
export function journalPreview(body: string, max = 90): string {
  const firstLine = body.trim().split("\n")[0] ?? "";
  if (firstLine.length <= max) return firstLine;
  return `${firstLine.slice(0, max - 1).trimEnd()}...`;
}

/** Journaling makes sense once there is something to look back on. A planned
 * trip has not happened yet, so its days carry no writing surface: the trip
 * page shows the planner there instead. */
export function journalingApplies(status: string): boolean {
  return status === "completed" || status === "ongoing";
}

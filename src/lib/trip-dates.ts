// Where a trip's dates come from, and what order its stops are in.
//
// Pure and client-safe. The server-side write that keeps the stored columns
// matching this lives in trip-schedule.ts, mirroring the journal and transport
// splits.
//
// Two rules, and everything else here is their consequence:
//
//   1. A DATED TRIP'S RANGE IS ITS STOPS. If any destination carries a date,
//      the trip runs from the earliest arrival to the latest departure. The
//      stored trips.start_date / end_date columns are a fallback for the trip
//      nobody has dated a stop on, never a second opinion about a trip that
//      has been. Every read path resolves through resolveTripDates, and every
//      destination write re-syncs the columns (see trip-schedule.ts), so the
//      SQL views that read the columns directly see the same answer the UI
//      does.
//
//   2. STOPS ARE IN DATE ORDER. order_index is still the stored sequence and
//      still the manual order for an undated trip, but a dated stop belongs
//      where its date puts it regardless of when it was typed in. Reads sort
//      through chronologicalOrder and writes renumber order_index to match, so
//      everything downstream of the sequence (the globe's arcs, replay, the
//      story, the transport legs that hang off "the stop before this one")
//      keeps working off order_index alone.

/** The scheduling facts an ordering decision needs, however the caller's row
 * happens to spell them. */
export interface StopSchedule {
  arrival: string | null;
  departure: string | null;
  /** The stored sequence, which breaks every tie. */
  order: number;
}

/** Reader for the snake_case destination row shape, which is most of them. */
export function stopScheduleOf(row: {
  arrival_date: string | null;
  departure_date: string | null;
  order_index: number;
}): StopSchedule {
  return {
    arrival: row.arrival_date,
    departure: row.departure_date,
    order: row.order_index,
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asDate(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const date = value.slice(0, 10);
  return ISO_DATE.test(date) ? date : null;
}

/** The day a stop is anchored to: its arrival, or its departure when only that
 * was filled in. Null when the stop carries no usable date at all. */
function anchorOf(schedule: StopSchedule): string | null {
  return asDate(schedule.arrival) ?? asDate(schedule.departure);
}

/**
 * A trip's stops in the order they were actually visited: by arrival date,
 * falling back to order_index for undated stops and for ties.
 *
 * An undated stop does NOT sink to the end. It inherits the anchor of the last
 * dated stop before it in the stored order (or the first one after it, when it
 * sits ahead of everything dated), so it keeps its place next to the neighbours
 * it was entered against. That matters because half-dated trips are the common
 * case: dating one stop of three should move that stop, not exile the other
 * two. A trip with no dates anywhere resolves to pure order_index, unchanged.
 */
export function chronologicalOrder<T>(
  stops: T[],
  read: (stop: T) => StopSchedule,
): T[] {
  if (stops.length < 2) return [...stops];

  const stored = [...stops].sort((a, b) => read(a).order - read(b).order);
  const anchors = stored.map((stop) => anchorOf(read(stop)));

  // Inherit backwards, then forwards, so every stop ends up with a key unless
  // the whole trip is undated.
  const keys: (string | null)[] = new Array(stored.length).fill(null);
  let carried: string | null = null;
  for (let i = 0; i < stored.length; i += 1) {
    if (anchors[i] !== null) carried = anchors[i];
    keys[i] = carried;
  }
  carried = null;
  for (let i = stored.length - 1; i >= 0; i -= 1) {
    if (anchors[i] !== null) carried = anchors[i];
    if (keys[i] === null) keys[i] = carried;
  }

  const indexed = stored.map((stop, index) => ({ stop, index }));
  indexed.sort((a, b) => {
    const aKey = keys[a.index];
    const bKey = keys[b.index];
    if (aKey !== bKey) {
      if (aKey === null) return 1;
      if (bKey === null) return -1;
      return aKey < bKey ? -1 : 1;
    }
    return read(a.stop).order - read(b.stop).order;
  });
  return indexed.map((entry) => entry.stop);
}

/** Convenience wrapper for the snake_case destination row shape. */
export function chronologicalDestinations<
  T extends {
    arrival_date: string | null;
    departure_date: string | null;
    order_index: number;
  },
>(stops: T[]): T[] {
  return chronologicalOrder(stops, stopScheduleOf);
}

export interface TripWindow {
  start: string;
  end: string;
}

/**
 * The range a trip's own stops describe: earliest arrival to latest departure.
 * A stop dated on only one side counts on both, so a single-day stop still
 * bounds the trip. Null when no stop carries a date, which is the signal to
 * fall back to whatever was typed on the trip itself.
 */
export function derivedTripWindow(
  stops: { arrival_date: string | null; departure_date: string | null }[],
): TripWindow | null {
  let start: string | null = null;
  let end: string | null = null;
  for (const stop of stops) {
    const arrival = asDate(stop.arrival_date);
    const departure = asDate(stop.departure_date);
    const low = arrival ?? departure;
    const high = departure ?? arrival;
    if (low !== null && (start === null || low < start)) start = low;
    if (high !== null && (end === null || high > end)) end = high;
  }
  return start !== null && end !== null ? { start, end } : null;
}

export interface ResolvedTripDates {
  start_date: string | null;
  end_date: string | null;
  /** True when the range came from the stops rather than the trip's columns.
   * The trip form uses this to show the range read-only instead of inviting a
   * manual entry that would immediately be overwritten. */
  derived: boolean;
}

/** The dates a trip should display, everywhere. Stops win when they have any;
 * otherwise the manually entered columns stand, and a trip with neither still
 * reads as undated. */
export function resolveTripDates(
  trip: { start_date: string | null; end_date: string | null },
  stops: { arrival_date: string | null; departure_date: string | null }[],
): ResolvedTripDates {
  const window = derivedTripWindow(stops);
  if (window) {
    return { start_date: window.start, end_date: window.end, derived: true };
  }
  return {
    start_date: trip.start_date,
    end_date: trip.end_date,
    derived: false,
  };
}

/** Apply the resolved range onto a trip-shaped object. Keeps the read paths to
 * a single call instead of spreading the same three lines everywhere. */
export function withResolvedTripDates<
  T extends { start_date: string | null; end_date: string | null },
>(
  trip: T,
  stops: { arrival_date: string | null; departure_date: string | null }[],
): T {
  const resolved = resolveTripDates(trip, stops);
  return {
    ...trip,
    start_date: resolved.start_date,
    end_date: resolved.end_date,
  };
}

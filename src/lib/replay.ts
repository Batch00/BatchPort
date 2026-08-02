// Timeline model for the globe's replay mode. Pure functions with no MapLibre
// or React dependencies: buildReplayTimeline turns the destinations the globe
// already renders into a compressed playback timeline, and replayStateAt
// resolves the complete globe state for any moment on it. Because the state is
// a pure function of playback time, scrubbing to an arbitrary point (including
// mid-leg) reconstructs the exact fills, pins, and partial arc for that moment.

import { boundsOfPoints, greatCirclePoints } from "./geo";
import { arcFamily, type ArcFamily, type TransportMode } from "./transport";
import { chronologicalOrder } from "./trip-dates";

/** The subset of a globe destination the replay needs. Planned stops are dropped. */
export interface ReplayInputStop {
  tripId: string;
  tripName: string;
  tripStartDate?: string | null;
  tripEndDate?: string | null;
  orderIndex?: number;
  name: string;
  countryCode: string | null;
  lat: number;
  lng: number;
  arrivalDate?: string | null;
  categoryColor?: string | null;
  planned?: boolean;
  /** How the traveller reached this stop. A leg belongs to the stop it arrives
   * at, so the hop INTO a stop is styled by the stop's own mode. */
  transportMode?: TransportMode | null;
}

export interface ReplayStop {
  name: string;
  countryCode: string | null;
  lng: number;
  lat: number;
  color: string | null;
  /** Resolved arrival timestamp (real or interpolated), for the date readout. */
  arrivalMs: number;
  /** The mode recorded on the leg into this stop, or null. */
  mode: TransportMode | null;
}

export interface ReplayTrip {
  name: string;
  startMs: number;
  endMs: number;
  stops: ReplayStop[];
  bounds: [number, number, number, number];
}

/** A great-circle leg with its densified coordinates, ready to slice. */
export interface ReplayLeg {
  coords: [number, number][];
  tripIndex: number;
  /** Which arc styling this leg draws in, so the animation tells the same
   * story the static map does: air solid blue, ground violet dashed, sea cyan
   * dotted. An unrecorded hop is "air", which is the styling every replay arc
   * had before modes existed. */
  family: ArcFamily;
}

export interface ReplaySegment {
  kind: "dwell" | "leg" | "gap";
  /** Playback seconds. */
  start: number;
  end: number;
  /** Real-world dates the segment sweeps through (ms epoch). */
  dateStart: number;
  dateEnd: number;
  /** For gaps this is the upcoming trip, so the camera can drift there early. */
  tripIndex: number;
  /** Index into the legs array, or -1 for dwell and gap segments. */
  legIndex: number;
}

export interface ReplayPinEvent {
  stop: ReplayStop;
  time: number;
}

export interface ReplayCountryEvent {
  code: string;
  time: number;
}

export interface ReplayTimeline {
  trips: ReplayTrip[];
  legs: ReplayLeg[];
  segments: ReplaySegment[];
  /** Sorted by time, so the visible set at any moment is a prefix. */
  pinEvents: ReplayPinEvent[];
  countryEvents: ReplayCountryEvent[];
  /** Total playback length in seconds. */
  duration: number;
  endDateMs: number;
}

export interface ReplayFrameState {
  t: number;
  dateMs: number;
  revealedCodes: string[];
  visiblePinCount: number;
  completedLegs: number[];
  activeLeg: { legIndex: number; progress: number } | null;
  tripIndex: number;
  /** Null during inter-trip gaps, so the overlay label can fade out. */
  tripName: string | null;
  ended: boolean;
}

const DAY_MS = 86_400_000;
// Playback pacing: roughly 11s of travel per trip, clamped so a two-trip
// history runs 20-25s and a long history never exceeds ~90s total.
const TRIP_SECONDS_BASE = 11;
const TRAVEL_BUDGET_MIN = 18;
const TRAVEL_BUDGET_MAX = 72;
const TOTAL_CAP_SECONDS = 90;
const GAP_SECONDS = 1.4;
const TRIP_MIN_SECONDS = 3.5;
const SINGLE_STOP_TRIP_SECONDS = 2.4;
const DWELL_MAX_SECONDS = 1.0;
const LEG_MIN_SECONDS = 0.9;
// Denser than the static arcs (48) so the growing line reads smoothly.
const LEG_SEGMENTS = 64;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function parseDateMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isNaN(ms)) return ms;
  const loose = Date.parse(value);
  return Number.isNaN(loose) ? null : loose;
}

interface DraftTrip {
  name: string;
  stops: ReplayInputStop[];
  tripStartMs: number | null;
  tripEndMs: number | null;
  arrivals: (number | null)[];
}

interface ResolvedTrip {
  name: string;
  stops: ReplayInputStop[];
  startMs: number;
  endMs: number;
  arrivals: number[];
}

// Resolve every stop to a monotonic arrival timestamp. Real arrival dates win;
// missing ones interpolate evenly across the trip's date range; a trip with no
// usable dates is handled by the caller (synthetic placement after dated trips).
function resolveArrivals(
  draft: DraftTrip,
  anchor: number,
): { startMs: number; endMs: number; arrivals: number[] } {
  const n = draft.stops.length;
  const known = draft.arrivals.filter((a): a is number => a !== null);
  let end = draft.tripEndMs;
  if (end === null || end < anchor) {
    end = anchor + Math.max(1, n - 1) * DAY_MS;
  }
  if (known.length > 0) end = Math.max(end, ...known);

  const arrivals: number[] = [];
  let prev = anchor;
  for (let i = 0; i < n; i += 1) {
    const interpolated =
      n === 1 ? anchor : anchor + (i / (n - 1)) * (end - anchor);
    let arrival = draft.arrivals[i] ?? interpolated;
    if (arrival < prev) arrival = prev;
    arrivals.push(arrival);
    prev = arrival;
  }
  return {
    startMs: Math.min(anchor, arrivals[0]),
    endMs: Math.max(end, arrivals[n - 1]),
    arrivals,
  };
}

/**
 * Build the playback timeline, or null when there is nothing to replay.
 * Time model: segment-based, so gaps between trips compress to a fixed beat
 * while playback time inside each trip is allocated proportional to its real
 * travel days (and, within a trip, each leg proportional to the days between
 * its stops). Every segment carries the real date range it sweeps, which is
 * how the date readout fast-forwards through gaps.
 */
export function buildReplayTimeline(
  stops: ReplayInputStop[],
): ReplayTimeline | null {
  const eligible = stops.filter(
    (s) => !s.planned && Number.isFinite(s.lat) && Number.isFinite(s.lng),
  );
  if (eligible.length === 0) return null;

  // Group by trip. Stops go in visit order: arrival date first, orderIndex for
  // the undated ones and for ties (see lib/trip-dates.ts). The globe already
  // hands over a chronological orderIndex, but the timeline is also built from
  // the landing hero's static payload, so it does the ordering itself rather
  // than trusting the caller.
  const grouped = new Map<string, ReplayInputStop[]>();
  for (const stop of eligible) {
    const list = grouped.get(stop.tripId) ?? [];
    list.push(stop);
    grouped.set(stop.tripId, list);
  }

  const dated: ResolvedTrip[] = [];
  const undated: DraftTrip[] = [];
  for (const list of grouped.values()) {
    const ordered = chronologicalOrder(list, (stop) => ({
      arrival: stop.arrivalDate ?? null,
      departure: null,
      order: stop.orderIndex ?? 0,
    }));
    const draft: DraftTrip = {
      name: ordered[0].tripName,
      stops: ordered,
      tripStartMs: parseDateMs(ordered[0].tripStartDate),
      tripEndMs: parseDateMs(ordered[0].tripEndDate),
      arrivals: ordered.map((s) => parseDateMs(s.arrivalDate)),
    };
    const known = draft.arrivals.filter((a): a is number => a !== null);
    const anchor =
      draft.tripStartMs ?? (known.length > 0 ? Math.min(...known) : null);
    if (anchor === null) {
      undated.push(draft);
    } else {
      dated.push({ name: draft.name, stops: ordered, ...resolveArrivals(draft, anchor) });
    }
  }

  // Fully undated trips sort after everything dated, with a synthetic short
  // duration so the date readout still moves.
  const latestDated =
    dated.length > 0 ? Math.max(...dated.map((t) => t.endMs)) : Date.now();
  const resolved = [...dated];
  undated.forEach((draft, k) => {
    const anchor = latestDated + (k + 1) * 30 * DAY_MS;
    resolved.push({
      name: draft.name,
      stops: draft.stops,
      ...resolveArrivals(draft, anchor),
    });
  });
  resolved.sort((a, b) => a.startMs - b.startMs);

  // Allocate playback time: total travel budget split across trips by real
  // duration, with a floor so quick trips still read.
  const tripCount = resolved.length;
  const travelBudget = clamp(
    TRIP_SECONDS_BASE * tripCount,
    TRAVEL_BUDGET_MIN,
    TRAVEL_BUDGET_MAX,
  );
  const gapTotal = GAP_SECONDS * (tripCount - 1);
  const tripDays = resolved.map((t) =>
    Math.max(1, (t.endMs - t.startMs) / DAY_MS),
  );
  const sumDays = tripDays.reduce((sum, d) => sum + d, 0);
  let tripTimes = resolved.map((trip, i) =>
    Math.max(
      trip.stops.length === 1 ? SINGLE_STOP_TRIP_SECONDS : TRIP_MIN_SECONDS,
      travelBudget * (tripDays[i] / sumDays),
    ),
  );
  const rawTotal = tripTimes.reduce((sum, x) => sum + x, 0) + gapTotal;
  if (rawTotal > TOTAL_CAP_SECONDS) {
    const scale = (TOTAL_CAP_SECONDS - gapTotal) / (rawTotal - gapTotal);
    tripTimes = tripTimes.map((x) => x * scale);
  }

  const trips: ReplayTrip[] = resolved.map((trip) => ({
    name: trip.name,
    startMs: trip.startMs,
    endMs: trip.endMs,
    stops: trip.stops.map((s, i) => ({
      name: s.name,
      countryCode: s.countryCode,
      lng: s.lng,
      lat: s.lat,
      color: s.categoryColor ?? null,
      arrivalMs: trip.arrivals[i],
      mode: s.transportMode ?? null,
    })),
    bounds: boundsOfPoints(
      trip.stops.map((s) => [s.lng, s.lat] as [number, number]),
    ) ?? [0, 0, 0, 0],
  }));

  const legs: ReplayLeg[] = [];
  const segments: ReplaySegment[] = [];
  const pinEvents: ReplayPinEvent[] = [];
  const countryEvents: ReplayCountryEvent[] = [];
  const seenCountries = new Set<string>();
  let cursor = 0;

  const addPin = (stop: ReplayStop, time: number) => {
    pinEvents.push({ stop, time });
    if (stop.countryCode && !seenCountries.has(stop.countryCode)) {
      seenCountries.add(stop.countryCode);
      countryEvents.push({ code: stop.countryCode, time });
    }
  };

  trips.forEach((trip, tripIndex) => {
    if (tripIndex > 0) {
      const prevEnd = trips[tripIndex - 1].endMs;
      segments.push({
        kind: "gap",
        start: cursor,
        end: cursor + GAP_SECONDS,
        dateStart: prevEnd,
        dateEnd: Math.max(prevEnd, trip.startMs),
        tripIndex,
        legIndex: -1,
      });
      cursor += GAP_SECONDS;
    }

    const n = trip.stops.length;
    const tripTime = tripTimes[tripIndex];
    const dwell = n === 1 ? tripTime : Math.min(DWELL_MAX_SECONDS, tripTime * 0.15);
    segments.push({
      kind: "dwell",
      start: cursor,
      end: cursor + dwell,
      dateStart: trip.startMs,
      dateEnd: trip.stops[0].arrivalMs,
      tripIndex,
      legIndex: -1,
    });
    addPin(trip.stops[0], cursor);
    cursor += dwell;

    if (n > 1) {
      const legBudget = tripTime - dwell;
      const weights = trip.stops
        .slice(0, -1)
        .map((stop, j) =>
          Math.max(0.5 * DAY_MS, trip.stops[j + 1].arrivalMs - stop.arrivalMs),
        );
      const sumWeights = weights.reduce((sum, w) => sum + w, 0);
      for (let j = 0; j < n - 1; j += 1) {
        const source = trip.stops[j];
        const target = trip.stops[j + 1];
        const time = Math.max(
          LEG_MIN_SECONDS,
          legBudget * (weights[j] / sumWeights),
        );
        legs.push({
          coords: greatCirclePoints(
            [source.lng, source.lat],
            [target.lng, target.lat],
            LEG_SEGMENTS,
          ),
          tripIndex,
          // The leg belongs to the stop it arrives at, so the hop's family
          // comes from the target's mode.
          family: arcFamily(target.mode),
        });
        segments.push({
          kind: "leg",
          start: cursor,
          end: cursor + time,
          dateStart: source.arrivalMs,
          dateEnd: target.arrivalMs,
          tripIndex,
          legIndex: legs.length - 1,
        });
        cursor += time;
        addPin(target, cursor);
      }
    }
  });

  return {
    trips,
    legs,
    segments,
    pinEvents,
    countryEvents,
    duration: cursor,
    endDateMs: trips[trips.length - 1].endMs,
  };
}

/** Resolve the full globe state for playback time t (seconds). */
export function replayStateAt(
  timeline: ReplayTimeline,
  t: number,
): ReplayFrameState {
  const clamped = clamp(t, 0, timeline.duration);

  let segment = timeline.segments[timeline.segments.length - 1];
  for (const candidate of timeline.segments) {
    if (clamped < candidate.end) {
      segment = candidate;
      break;
    }
  }
  const span = segment.end - segment.start;
  const f = span > 0 ? clamp((clamped - segment.start) / span, 0, 1) : 1;
  const dateMs = segment.dateStart + (segment.dateEnd - segment.dateStart) * f;

  const revealedCodes: string[] = [];
  for (const event of timeline.countryEvents) {
    if (event.time > clamped) break;
    revealedCodes.push(event.code);
  }

  let visiblePinCount = 0;
  for (const event of timeline.pinEvents) {
    if (event.time > clamped) break;
    visiblePinCount += 1;
  }

  const completedLegs: number[] = [];
  let activeLeg: ReplayFrameState["activeLeg"] = null;
  for (const candidate of timeline.segments) {
    if (candidate.kind !== "leg") continue;
    if (candidate.end <= clamped) {
      completedLegs.push(candidate.legIndex);
    } else if (candidate.start <= clamped) {
      const legSpan = candidate.end - candidate.start;
      activeLeg = {
        legIndex: candidate.legIndex,
        progress: legSpan > 0 ? (clamped - candidate.start) / legSpan : 1,
      };
      break;
    } else {
      break;
    }
  }

  return {
    t: clamped,
    dateMs,
    revealedCodes,
    visiblePinCount,
    completedLegs,
    activeLeg,
    tripIndex: segment.tripIndex,
    tripName:
      segment.kind === "gap" ? null : timeline.trips[segment.tripIndex].name,
    ended: clamped >= timeline.duration,
  };
}

/**
 * The leading portion of a leg's coordinates for a 0..1 progress value, with
 * the tip linearly interpolated between densified points so growth is smooth.
 */
export function sliceLeg(
  coords: [number, number][],
  progress: number,
): [number, number][] {
  if (progress >= 1) return coords;
  const maxIndex = coords.length - 1;
  const position = clamp(progress, 0, 1) * maxIndex;
  const index = Math.floor(position);
  const frac = position - index;
  const sliced = coords.slice(0, index + 1);
  if (frac > 0 && index < maxIndex) {
    const [ax, ay] = coords[index];
    const [bx, by] = coords[index + 1];
    sliced.push([ax + (bx - ax) * frac, ay + (by - ay) * frac]);
  }
  if (sliced.length < 2) return [coords[0], coords[0]];
  return sliced;
}

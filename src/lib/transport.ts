// Transport legs: how the traveller got from one stop to the next.
//
// Pure and client-safe. The server reads live in transport-data.ts and the
// mutations in actions/transport.ts, mirroring the journal and nearby splits.
//
// The structural decision, kept here because everything downstream assumes it:
// a leg belongs to the ARRIVING stop, one per destination. Order within a trip
// already comes from destinations.order_index, so "the leg into stop N" needs
// no origin id (see the schema comment in
// scripts/sql/2026-08-03-transport-legs.sql). The leg on the first stop is the
// journey out from home; the journey back after the last stop is deliberately
// not modelled.

export type TransportMode =
  | "flight"
  | "train"
  | "bus"
  | "car"
  | "ferry"
  | "bike"
  | "walk"
  | "other";

/**
 * How an arc reads on the globe. Three families, because three is what the eye
 * can tell apart at two pixels wide on a dark sphere:
 *
 *  - "air": the existing look, a solid brand-blue great circle with a glow.
 *    Flights get it, and so does every leg with no recorded mode, which is why
 *    turning the feature on changes nothing about a map nobody has annotated.
 *  - "ground": violet and dashed, thinner, no glow. Dashes read as "this line
 *    is a simplification of a road or a railway", which it is: the geometry is
 *    still the great circle, and nothing here pretends to know the route.
 *  - "sea": cyan and dotted. Distinct again, and rare enough that it never
 *    competes with the other two for attention.
 */
export type ArcFamily = "air" | "ground" | "sea";

export interface TransportModeInfo {
  mode: TransportMode;
  label: string;
  family: ArcFamily;
  /**
   * Grams of CO2 equivalent per passenger-kilometre, from the widely published
   * national inventory factors (UK DEFRA / EEA order of magnitude). These are
   * averages across vehicle types, load factors, and trip lengths, so they are
   * good for "flying dominates this" and useless for anything finer, which is
   * exactly how the UI presents them. Null means "no defensible single number"
   * ("other" could be anything) and drops the leg out of the estimate.
   */
  gramsCo2PerKm: number | null;
}

// Ordered as the picker offers them: the modes that move people between cities
// first, the short-hop ones after.
export const TRANSPORT_MODES: TransportModeInfo[] = [
  { mode: "flight", label: "Flight", family: "air", gramsCo2PerKm: 190 },
  { mode: "train", label: "Train", family: "ground", gramsCo2PerKm: 35 },
  { mode: "bus", label: "Bus", family: "ground", gramsCo2PerKm: 27 },
  { mode: "car", label: "Car", family: "ground", gramsCo2PerKm: 110 },
  { mode: "ferry", label: "Ferry", family: "sea", gramsCo2PerKm: 115 },
  { mode: "bike", label: "Bike", family: "ground", gramsCo2PerKm: 0 },
  { mode: "walk", label: "Walk", family: "ground", gramsCo2PerKm: 0 },
  { mode: "other", label: "Other", family: "ground", gramsCo2PerKm: null },
];

const MODE_INFO = new Map<TransportMode, TransportModeInfo>(
  TRANSPORT_MODES.map((info) => [info.mode, info]),
);

/** The arc colours, kept next to the families they belong to. Air reuses the
 * brand colour the globe already resolves from CSS, so it is not listed. */
export const GROUND_ARC_COLOR = "#a78bfa";
export const SEA_ARC_COLOR = "#22d3ee";

/** Narrow an untrusted string (a database row, a form field) to a mode. */
export function toTransportMode(value: unknown): TransportMode | null {
  return typeof value === "string" && MODE_INFO.has(value as TransportMode)
    ? (value as TransportMode)
    : null;
}

export function transportModeInfo(
  mode: TransportMode | null,
): TransportModeInfo | null {
  return mode ? (MODE_INFO.get(mode) ?? null) : null;
}

export function transportModeLabel(mode: TransportMode | null): string {
  return transportModeInfo(mode)?.label ?? "Travel";
}

/** The arc family a leg draws as. An unrecorded mode draws as air, which is
 * the styling every arc had before this feature existed. */
export function arcFamily(mode: TransportMode | null): ArcFamily {
  return transportModeInfo(mode)?.family ?? "air";
}

/** The colour a mode's arc is drawn in, given the resolved brand hex. */
export function arcColor(mode: TransportMode | null, brandHex: string): string {
  const family = arcFamily(mode);
  if (family === "ground") return GROUND_ARC_COLOR;
  if (family === "sea") return SEA_ARC_COLOR;
  return brandHex;
}

/** One transport leg, as every surface reads it. */
export interface TransportLeg {
  id: string;
  /** The stop this leg arrives at. The key: one leg per destination. */
  destination_id: string;
  mode: TransportMode;
  carrier: string | null;
  duration_minutes: number | null;
  distance_km: number | null;
  notes: string | null;
}

/** What the entry sheet sends. Only the mode is required. */
export interface TransportLegInput {
  mode: TransportMode;
  carrier: string | null;
  duration_minutes: number | null;
  distance_km: number | null;
  notes: string | null;
}

/** "2h 20m", "45m", "3h". Null in, null out: the row just omits it. */
export function formatLegDuration(minutes: number | null): string | null {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return null;
  const whole = Math.round(minutes);
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** The one-line summary a set leg shows: "Train · Eurostar · 2h 20m". Only the
 * parts that exist, so a mode-only leg reads as just its mode. */
export function legSummary(leg: TransportLeg): string {
  const parts = [transportModeLabel(leg.mode)];
  if (leg.carrier) parts.push(leg.carrier);
  const duration = formatLegDuration(leg.duration_minutes);
  if (duration) parts.push(duration);
  return parts.join(" · ");
}

// --- Distance and emissions --------------------------------------------------

/** Kilometres travelled per mode, plus the distance on legs nobody has
 * annotated. Totals are great-circle, never adjusted upward by mode: a guessed
 * road multiplier would be a number the app invented. */
export interface TransportBreakdown {
  /** Per mode, highest distance first. Modes with no legs are absent. */
  byMode: { mode: TransportMode; km: number; legs: number }[];
  /** Distance on legs with a recorded mode. */
  recordedKm: number;
  /** Distance between consecutive stops with no leg recorded at all. */
  unrecordedKm: number;
  /**
   * Estimated kilograms of CO2 equivalent across the legs whose mode carries a
   * published factor. Null when nothing qualifies, so the line is absent rather
   * than reading "0 kg".
   */
  estimatedCo2Kg: number | null;
}

export function emptyTransportBreakdown(): TransportBreakdown {
  return {
    byMode: [],
    recordedKm: 0,
    unrecordedKm: 0,
    estimatedCo2Kg: null,
  };
}

export function hasTransportBreakdown(
  breakdown: TransportBreakdown | null,
): breakdown is TransportBreakdown {
  return Boolean(breakdown && breakdown.byMode.length > 0);
}

/** Fold measured legs into the breakdown. Each entry is one hop between two
 * consecutive stops, carrying the mode recorded on the arriving stop (or null
 * when none was). */
export function buildTransportBreakdown(
  legs: { mode: TransportMode | null; km: number }[],
): TransportBreakdown {
  const byMode = new Map<TransportMode, { km: number; legs: number }>();
  let recordedKm = 0;
  let unrecordedKm = 0;
  let co2Grams = 0;
  let co2Counted = false;

  for (const leg of legs) {
    if (!Number.isFinite(leg.km) || leg.km <= 0) continue;
    if (!leg.mode) {
      unrecordedKm += leg.km;
      continue;
    }
    recordedKm += leg.km;
    const current = byMode.get(leg.mode) ?? { km: 0, legs: 0 };
    current.km += leg.km;
    current.legs += 1;
    byMode.set(leg.mode, current);

    const factor = transportModeInfo(leg.mode)?.gramsCo2PerKm ?? null;
    if (factor !== null) {
      co2Grams += factor * leg.km;
      co2Counted = true;
    }
  }

  return {
    byMode: Array.from(byMode.entries())
      .map(([mode, value]) => ({ mode, km: value.km, legs: value.legs }))
      .sort((a, b) => b.km - a.km),
    recordedKm,
    unrecordedKm,
    estimatedCo2Kg: co2Counted ? co2Grams / 1000 : null,
  };
}

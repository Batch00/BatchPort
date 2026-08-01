import { createAdminClient } from "@/utils/supabase/admin";

// Observed weather for the days a user was actually somewhere, from the same
// Open-Meteo ERA5 archive the climate line already uses. Climate answers "what
// is Kyoto like in November"; this answers "what was it like the week you were
// there". Server only: the cache reads and writes use the admin client, which
// is not schema-scoped, so every chain names batchport explicitly.

const WEATHER_PROVIDER = "weather_visit";

// Observations of a past window never change, so a hit stays good for a year.
// A window whose tail was still inside the archive lag when it was cached is
// keyed by the truncated end date, so the next day's request simply misses and
// refetches the longer window.
const CACHE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

// ERA5 lands in the archive several days behind real time. Asking for those
// days returns nulls, so the window is truncated to the last day the archive
// can plausibly answer and the caller shows what exists.
const ARCHIVE_LAG_DAYS = 6;

// A single stay long enough to blow past this is not a "while you were here"
// line any more. Longer ranges are truncated rather than rejected.
const MAX_WINDOW_DAYS = 92;

// Same threshold the climate line calls a wet day.
const WET_DAY_MM = 1;

const USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ??
  "BatchPort/1.0 (+https://batchport.batch-apps.com)";

/** One observed day in the window. */
export interface VisitWeatherDay {
  /** YYYY-MM-DD, local to the location. */
  date: string;
  /** Daily maximum in whole °C. */
  high: number;
  /** Daily minimum in whole °C. */
  low: number;
  /** Precipitation total in mm, one decimal. */
  precipMm: number;
}

/** Observed conditions across a stay. Only ever describes days the archive
 * actually carried: `days` is the source of truth and the summary numbers are
 * derived from it. */
export interface VisitWeather {
  /** First and last day covered, which may be shorter than what was asked. */
  start: string;
  end: string;
  days: VisitWeatherDay[];
  /** Warmest daily high across the covered days. */
  high: number;
  /** Coldest daily low across the covered days. */
  low: number;
  /** Days that saw at least 1mm of precipitation. */
  wetDays: number;
  /** True when the requested window ran past what the archive can answer, so
   * the stay is only partly described (an ongoing trip, or one that ended in
   * the last few days). */
  partial: boolean;
}

interface CacheRow {
  result: unknown;
  cached_at: string;
}

async function readCache(queryNorm: string): Promise<unknown | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema("batchport")
    .from("geocode_cache")
    .select("result, cached_at")
    .eq("provider", WEATHER_PROVIDER)
    .eq("query_norm", queryNorm)
    .order("cached_at", { ascending: false })
    .limit(1)
    .maybeSingle<CacheRow>();

  if (error || !data) return null;
  const age = Date.now() - new Date(data.cached_at).getTime();
  if (age > CACHE_TTL_MS) return null;
  return data.result;
}

async function writeCache(queryNorm: string, result: unknown): Promise<void> {
  const admin = createAdminClient();
  await admin
    .schema("batchport")
    .from("geocode_cache")
    .delete()
    .eq("provider", WEATHER_PROVIDER)
    .eq("query_norm", queryNorm);
  await admin
    .schema("batchport")
    .from("geocode_cache")
    .insert({
      provider: WEATHER_PROVIDER,
      query_norm: queryNorm,
      result,
      cached_at: new Date().toISOString(),
    });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a well-formed YYYY-MM-DD that names a real calendar day. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(time)) return false;
  return new Date(time).toISOString().slice(0, 10) === value;
}

function addDays(date: string, days: number): string {
  const time = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}

function minDate(a: string, b: string): string {
  return a < b ? a : b;
}

/** The last day the ERA5 archive can plausibly answer for today. */
function archiveCutoff(): string {
  return addDays(new Date().toISOString().slice(0, 10), -ARCHIVE_LAG_DAYS);
}

// Coordinates are rounded to the cache key's precision before the fetch, so
// every lookup sharing a key is backed by identical upstream data. Two decimals
// is roughly a kilometre, well inside the resolution of a reanalysis grid.
function roundCoord(value: number): number {
  return Number(value.toFixed(2));
}

function weatherKey(
  lat: number,
  lng: number,
  start: string,
  end: string,
): string {
  return `${roundCoord(lat)},${roundCoord(lng)}|${start}|${end}`;
}

/**
 * Observed daily weather for a stay, or null when there is nothing to say:
 * bad input, a window entirely inside the archive lag, or an upstream failure.
 * Never throws; callers treat null as "omit the line".
 */
export async function getVisitWeather(
  lat: number,
  lng: number,
  start: string,
  end: string,
): Promise<VisitWeather | null> {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  if (!isIsoDate(start) || !isIsoDate(end) || end < start) return null;

  // Truncate at both ends: the archive lag caps how recent the window can be,
  // and MAX_WINDOW_DAYS caps how long it can run.
  const capped = minDate(end, addDays(start, MAX_WINDOW_DAYS - 1));
  const effectiveEnd = minDate(capped, archiveCutoff());
  if (effectiveEnd < start) return null;
  const partial = effectiveEnd < end;

  const key = weatherKey(lat, lng, start, effectiveEnd);
  const cached = await readCache(key);
  if (cached) {
    const row = cached as VisitWeather;
    // `partial` depends on today, not on the cached window, so it is recomputed
    // rather than trusted from the payload.
    if (Array.isArray(row.days)) return { ...row, partial };
  }

  let daily: {
    time?: string[];
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
    precipitation_sum?: (number | null)[];
  };
  try {
    const url = new URL("https://archive-api.open-meteo.com/v1/archive");
    url.searchParams.set("latitude", roundCoord(lat).toString());
    url.searchParams.set("longitude", roundCoord(lng).toString());
    url.searchParams.set("start_date", start);
    url.searchParams.set("end_date", effectiveEnd);
    url.searchParams.set(
      "daily",
      "temperature_2m_max,temperature_2m_min,precipitation_sum",
    );
    // Local-time day buckets, so "the day you were there" means the same thing
    // to the archive as it does to the arrival and departure dates.
    url.searchParams.set("timezone", "auto");
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { daily?: typeof daily };
    daily = payload.daily ?? {};
  } catch {
    return null;
  }

  const time = daily.time ?? [];
  const highs = daily.temperature_2m_max ?? [];
  const lows = daily.temperature_2m_min ?? [];
  const precip = daily.precipitation_sum ?? [];

  const days: VisitWeatherDay[] = [];
  for (let i = 0; i < time.length; i += 1) {
    const date = time[i];
    const high = highs[i];
    const low = lows[i];
    // A day the archive has not filled in yet comes back null; drop it rather
    // than inventing a zero.
    if (!date || high == null || low == null) continue;
    days.push({
      date,
      high: Math.round(high),
      low: Math.round(low),
      precipMm: Math.round((precip[i] ?? 0) * 10) / 10,
    });
  }
  if (days.length === 0) return null;

  const result: VisitWeather = {
    start: days[0].date,
    end: days[days.length - 1].date,
    days,
    high: Math.max(...days.map((day) => day.high)),
    low: Math.min(...days.map((day) => day.low)),
    wetDays: days.filter((day) => day.precipMm >= WET_DAY_MM).length,
    partial,
  };

  try {
    await writeCache(key, result);
  } catch {
    // A cache write failure just means the next request refetches.
  }

  return result;
}

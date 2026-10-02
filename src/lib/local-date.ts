// "Today" is the VIEWER'S calendar date, never the server's.
//
// The server runs in UTC, so a bare `new Date()` there answers with tomorrow
// from 7 PM Central onward: On this day showed the next day's memories, the
// countdown dropped a day early, and a manual bucket fulfillment was stamped
// with tomorrow's date. Every "what is today" question in the app goes
// through this module instead.
//
// How the viewer's zone reaches the server: the browser reports its IANA zone
// (Intl, so it follows the device while traveling, never a hardcoded zone)
// into the TZ_COOKIE cookie, and lib/viewer-date.ts reads it in server code.
// The first request a browser ever makes arrives before the cookie exists;
// that one render falls back to FALLBACK_TIME_ZONE, and TodayProvider sets
// the cookie and refreshes, so it corrects itself within the same visit.
//
// Pure and client-safe. Everything here answers with a YYYY-MM-DD string, and
// all arithmetic on those strings stays UTC-anchored and timezone-free: the
// zone matters for exactly one thing, which calendar day it is right now.

export const TZ_COOKIE = "bp_tz";

/** Only for a request that arrives before the browser has reported its zone.
 * The owner's home zone, which is the right guess for the one account that
 * edits anything; every other viewer is corrected on their first load. */
export const FALLBACK_TIME_ZONE = "America/Chicago";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a zone this runtime's Intl understands (cookies are user input). */
export function isValidTimeZone(zone: string | null | undefined): zone is string {
  if (!zone || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date at `now` in `zone`, as YYYY-MM-DD. */
export function todayInZone(zone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: isValidTimeZone(zone) ? zone : FALLBACK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** The device's own zone. Browser only in practice; on the server it would
 * answer UTC, which is the bug this module exists to avoid. */
export function browserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(zone) ? zone : FALLBACK_TIME_ZONE;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

/** Today on this device. For browser code outside React render (event
 * handlers, the offline queue); components read useToday() instead. */
export function localToday(now: Date = new Date()): string {
  return todayInZone(browserTimeZone(), now);
}

export function isIsoDate(value: string | null | undefined): value is string {
  return typeof value === "string" && ISO_DATE.test(value);
}

/** Whole days from `from` to `to`, both YYYY-MM-DD. UTC-anchored, so the
 * answer is the same in every zone. NaN on malformed input. */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}

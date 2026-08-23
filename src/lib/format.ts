import type { TripStatus } from "@/lib/types";

// Turn a 2-letter ISO country code into its flag emoji (regional indicator
// symbols). Returns an empty string for missing or malformed codes.
export function flagEmoji(code?: string | null): string {
  if (!code || code.length !== 2) return "";
  const upper = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return "";
  const base = 0x1f1e6;
  return String.fromCodePoint(
    base + (upper.charCodeAt(0) - 65),
    base + (upper.charCodeAt(1) - 65),
  );
}

let regionNames: Intl.DisplayNames | null = null;

// "DK" -> "Denmark", from the platform rather than from a table the app would
// have to ship and keep current. Falls back to the code when Intl cannot
// resolve it. Lives here rather than next to CountryFlag because the share
// card renderer needs it and must not import a React component.
export function countryName(code: string): string {
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

// Format a YYYY-MM-DD date as "Jun 10, 2023". The explicit midnight suffix
// keeps the displayed day stable regardless of the viewer's timezone.
export function formatDate(value?: string | null): string {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateRange(
  start?: string | null,
  end?: string | null,
): string {
  if (!start && !end) return "Dates to be decided";
  if (start && !end) return formatDate(start);
  if (!start && end) return formatDate(end);
  return `${formatDate(start)} to ${formatDate(end)}`;
}

// Inclusive day count for a YYYY-MM-DD range: Jun 10 to Jun 12 is 3 days.
// Returns null when either date is missing, malformed, or out of order.
/**
 * A date range for somewhere tight, e.g. a per-stop row.
 *
 * "Sep 28 to Oct 9" rather than "Sep 28, 2025 to Oct 9, 2025". The year is
 * dropped only when BOTH ends share it, because a stay that crosses new year
 * is exactly the case where the year is the interesting part. It is the same
 * abbreviation a person writes by hand, and it is what stops the range being
 * the thing that truncates in a row whose whole point is the range.
 */
export function formatDateRangeShort(
  start?: string | null,
  end?: string | null,
): string {
  if (!start && !end) return "Dates to be decided";
  const one = (value: string, withYear: boolean): string => {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(withYear ? { year: "numeric" } : {}),
    });
  };
  if (start && !end) return one(start, true);
  if (!start && end) return one(end, true);
  const sameYear = (start as string).slice(0, 4) === (end as string).slice(0, 4);
  return `${one(start as string, !sameYear)} to ${one(end as string, !sameYear)}`;
}

export function durationDays(
  start?: string | null,
  end?: string | null,
): number | null {
  if (!start || !end) return null;
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }
  const days =
    Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
  return days >= 1 ? days : null;
}

export function formatDuration(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

// Whole days from today (local) until a future YYYY-MM-DD date. Returns null
// for past dates, today, or missing/malformed input. Used for the "in N days"
// hint on upcoming planned trips.
export function daysUntil(date?: string | null): number | null {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);
  return days > 0 ? days : null;
}

const STATUS_LABELS: Record<TripStatus, string> = {
  completed: "Completed",
  ongoing: "Ongoing",
  planned: "Planned",
};

export function statusLabel(status: TripStatus): string {
  return STATUS_LABELS[status] ?? status;
}

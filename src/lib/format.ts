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

const STATUS_LABELS: Record<TripStatus, string> = {
  completed: "Completed",
  ongoing: "Ongoing",
  planned: "Planned",
};

export function statusLabel(status: TripStatus): string {
  return STATUS_LABELS[status] ?? status;
}

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

const STATUS_LABELS: Record<TripStatus, string> = {
  completed: "Completed",
  ongoing: "Ongoing",
  planned: "Planned",
};

export function statusLabel(status: TripStatus): string {
  return STATUS_LABELS[status] ?? status;
}

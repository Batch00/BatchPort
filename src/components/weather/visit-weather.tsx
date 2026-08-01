"use client";

import { useEffect, useState } from "react";
import { ChevronDownIcon, CloudRainIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { VisitWeather, VisitWeatherDay } from "@/lib/weather";

// "While you were here: 12 to 19°C, rain on 2 of 4 days." One quiet line under
// a dated stop, with an optional per-day expander.
//
// Fetched client-side from the cached weather route rather than awaited in the
// page, for the same reason the climate line is: a cache miss goes out to
// Open-Meteo, and no destination page should block its render on that. The line
// renders nothing at all until it resolves and stays absent when the archive
// has nothing (no dates, no coordinates, a stay still inside the archive lag),
// so it is never an empty state or a layout hole.

function toF(celsius: number): number {
  return Math.round((celsius * 9) / 5 + 32);
}

/** "rain on 2 of 4 days", "rain both days", "dry the whole time". */
function precipPhrase(wetDays: number, totalDays: number): string {
  if (wetDays === 0) {
    return totalDays === 1 ? "no rain" : "dry the whole time";
  }
  if (wetDays === totalDays) {
    if (totalDays === 1) return "rain that day";
    if (totalDays === 2) return "rain both days";
    return `rain every day`;
  }
  return `rain on ${wetDays} of ${totalDays} days`;
}

/** "Mon 14 Apr" for a per-day row. */
function dayLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

// Both units per row, matching the summary line above the expander. The
// Fahrenheit pair is dimmer and wraps to its own line when the row runs out of
// width, so a narrow phone never clips the reading it came for.
function DayRow({ day }: { day: VisitWeatherDay }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 py-1 text-xs">
      <span className="text-foreground/60">{dayLabel(day.date)}</span>
      <span className="flex flex-wrap items-center justify-end gap-x-2 tabular-nums text-foreground/70">
        <span>
          {day.low}° to {day.high}°C
          <span className="text-foreground/40">
            {" "}
            ({toF(day.low)} to {toF(day.high)}°F)
          </span>
        </span>
        {day.precipMm >= 1 ? (
          <span className="flex items-center gap-1 text-brand">
            <CloudRainIcon className="size-3" aria-hidden />
            {day.precipMm}mm
          </span>
        ) : null}
      </span>
    </li>
  );
}

export function VisitWeatherLine({
  lat,
  lng,
  start,
  end,
  className,
}: {
  lat: number | null;
  lng: number | null;
  /** Arrival date, YYYY-MM-DD. */
  start: string | null;
  /** Departure date, YYYY-MM-DD. Falls back to the arrival date for a
   * single-day stop. */
  end: string | null;
  className?: string;
}) {
  const [weather, setWeather] = useState<VisitWeather | null>(null);
  const [expanded, setExpanded] = useState(false);

  const from = start;
  const to = end ?? start;
  const hasInput = lat !== null && lng !== null && Boolean(from) && Boolean(to);

  // Render-phase reset: pointing the component at a different stop drops the
  // previous answer immediately, rather than flashing one place's weather under
  // another's name while the new fetch is in flight.
  const inputKey = hasInput ? `${lat},${lng}|${from}|${to}` : "";
  const [prevKey, setPrevKey] = useState(inputKey);
  if (prevKey !== inputKey) {
    setPrevKey(inputKey);
    setWeather(null);
    setExpanded(false);
  }

  useEffect(() => {
    if (!hasInput) return;
    const controller = new AbortController();
    const query = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
      start: from as string,
      end: to as string,
    });
    fetch(`/api/weather/visit?${query.toString()}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok && response.status !== 204 ? response.json() : null))
      .then((data: VisitWeather | null) => {
        setWeather(data && Array.isArray(data.days) ? data : null);
      })
      .catch(() => {
        // Aborted or failed: the line simply does not appear.
      });
    return () => controller.abort();
  }, [hasInput, lat, lng, from, to]);

  if (!weather || weather.days.length === 0) return null;

  const total = weather.days.length;
  const summary = `${weather.low} to ${weather.high}°C (${toF(
    weather.low,
  )} to ${toF(weather.high)}°F), ${precipPhrase(weather.wetDays, total)}`;

  return (
    <div className={cn("text-xs text-foreground/50", className)}>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span>
          <span className="text-foreground/40">While you were here: </span>
          {summary}
          {weather.partial ? (
            <span className="text-foreground/40"> (so far)</span>
          ) : null}
        </span>
        {total > 1 ? (
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-foreground/40 transition-colors hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/60"
          >
            {expanded ? "Hide days" : "By day"}
            <ChevronDownIcon
              className={cn(
                "size-3 transition-transform",
                expanded && "rotate-180",
              )}
              aria-hidden
            />
          </button>
        ) : null}
      </div>
      {expanded ? (
        <ul className="mt-1.5 w-full max-w-sm divide-y divide-white/5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1">
          {weather.days.map((day) => (
            <DayRow key={day.date} day={day} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

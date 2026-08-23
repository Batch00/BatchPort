"use client";

import { useEffect, useState } from "react";
import { ChevronDownIcon, ThermometerSunIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { DiscoverClimate } from "@/lib/discover";

// Typical conditions for a location, with a compact month selector so the
// climate can be explored without a planned trip ("what is Kyoto like in
// November"). Fetched from the cached climate route, which warms every month
// on the first hit, so switching months after the first is instant. Renders
// nothing until the first month resolves and stays silent on any failure:
// climate is a nicety, never a layout hole or an orphaned control.

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function currentMonth(): number {
  return new Date().getMonth() + 1;
}

function toF(celsius: number): number {
  return Math.round((celsius * 9) / 5 + 32);
}

// Wet-day buckets over a ~30 day month: 12+ reads as a rainy month, 6+ as
// regular showers, 2+ as the odd shower, below that as dry.
function precipPhrase(wetDays: number): string {
  if (wetDays >= 12) return "often rainy";
  if (wetDays >= 6) return "occasional rain";
  if (wetDays >= 2) return "a little rain";
  return "mostly dry";
}

export function ClimateSection({
  lat,
  lng,
  defaultMonth,
  className,
}: {
  lat: number;
  lng: number;
  /** Calendar month 1-12 to open on (a planned trip's month). Defaults to the
   * current month. */
  defaultMonth?: number | null;
  className?: string;
}) {
  const [month, setMonth] = useState(() => defaultMonth ?? currentMonth());
  const [climate, setClimate] = useState<DiscoverClimate | null>(null);
  // Tracks whether the very first fetch resolved with data. Until it does the
  // whole block (selector included) stays hidden, so ocean points and failures
  // never leave an orphaned month picker behind.
  const [everLoaded, setEverLoaded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
      month: String(month),
    });
    fetch(`/api/discover/climate?${query.toString()}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: DiscoverClimate | null) => {
        setClimate(data);
        if (data) setEverLoaded(true);
      })
      .catch(() => {
        // Silent: the line simply does not update.
      });
    return () => controller.abort();
  }, [lat, lng, month]);

  if (!everLoaded) return null;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="relative inline-flex w-fit items-center">
        <ThermometerSunIcon className="pointer-events-none absolute left-2 size-3 text-brand/80" />
        <select
          value={month}
          onChange={(event) => setMonth(Number(event.target.value))}
          aria-label="Climate month"
          className="cursor-pointer appearance-none rounded-full border border-white/10 bg-white/5 py-1 pl-6 pr-6 text-xs text-foreground/70 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        >
          {MONTH_NAMES.map((label, index) => (
            <option key={label} value={index + 1}>
              {label}
            </option>
          ))}
        </select>
        <ChevronDownIcon className="pointer-events-none absolute right-2 size-3 text-foreground/40" />
      </div>
      {climate ? (
        <p className="text-xs leading-relaxed text-foreground/50">
          Typically {climate.low} to {climate.high}°C ({toF(climate.low)} to{" "}
          {toF(climate.high)}°F), {precipPhrase(climate.wetDays)} in{" "}
          {MONTH_NAMES[climate.month - 1]}
        </p>
      ) : (
        <p className="text-xs text-foreground/40">
          No climate data for {MONTH_NAMES[month - 1]}.
        </p>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { ThermometerSunIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { DiscoverClimate } from "@/lib/discover";

// One compact line of typical conditions for a month at a location, fetched
// from the cached climate route. Renders nothing until data arrives and stays
// silent on any failure: climate is a nicety, never a layout hole.

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

export function ClimateLine({
  lat,
  lng,
  month,
  className,
}: {
  lat: number;
  lng: number;
  /** Calendar month 1-12. */
  month: number;
  className?: string;
}) {
  const [climate, setClimate] = useState<DiscoverClimate | null>(null);

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
      .then((data: DiscoverClimate | null) => setClimate(data))
      .catch(() => {
        // Silent: the line simply does not render.
      });
    return () => controller.abort();
  }, [lat, lng, month]);

  if (!climate) return null;

  return (
    <p
      className={cn(
        "flex items-center gap-1.5 text-xs text-foreground/50",
        className,
      )}
    >
      <ThermometerSunIcon className="size-3 shrink-0 text-brand/80" />
      <span>
        Typically {climate.low} to {climate.high}°C ({toF(climate.low)} to{" "}
        {toF(climate.high)}°F), {precipPhrase(climate.wetDays)} in{" "}
        {MONTH_NAMES[climate.month - 1]}
      </span>
    </p>
  );
}

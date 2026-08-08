"use client";

import { useMemo, useState } from "react";
import { SparklesIcon } from "lucide-react";

import { YearRecapView } from "@/components/year/year-recap";
import { bucketItemName } from "@/lib/bucket-format";
import { formatKm } from "@/lib/stats-format";
import { storyTripFromProfile } from "@/lib/story";
import { cn } from "@/lib/utils";
import type { BucketItem } from "@/lib/bucket-list";
import type { ProfileTrip } from "@/lib/share-data";
import type { TransportMode } from "@/lib/transport";
import {
  buildYearRecap,
  recapYears,
  type YearRecapInput,
} from "@/lib/year-recap";

// The way into the Year in Travel recap.
//
// It takes the trip rows the surface already fetched and folds them here
// rather than on the server, so nothing new crosses the boundary: the recap is
// a different reading of the same payload the trip cards are drawn from. That
// is also why /demo and /share/[slug] can offer it, since building it reads
// nothing and writes nothing.
//
// Absent when there is nothing to recap. A year with no trip that actually
// happened is never offered (see recapYears), so the affordance is hidden
// rather than opening an empty year.

export type YearRecapVariant = "banner" | "button";

export function YearRecapLauncher({
  trips,
  bucket,
  bucketItems,
  today,
  variant = "banner",
  className,
}: {
  trips: ProfileTrip[];
  bucket?: { total: number; fulfilled: number } | null;
  /** The list itself, so the closing slide can name places rather than count
   * them. Optional: a surface that has only the totals still shows the bar. */
  bucketItems?: BucketItem[];
  /** YYYY-MM-DD, resolved on the server so the offered years and the "so far"
   * label are the same on both sides of hydration. */
  today: string;
  variant?: YearRecapVariant;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const input = useMemo<YearRecapInput>(() => {
    const transportModes: Record<string, TransportMode> = {};
    for (const trip of trips) {
      for (const leg of trip.transport) {
        transportModes[leg.destination_id] = leg.mode;
      }
    }
    return {
      trips: trips.map(storyTripFromProfile),
      transportModes,
      bucket: bucket ?? null,
      // Mapped here rather than crossing the boundary in the recap's own
      // shape, for the same reason the trips are: the recap is pure and the
      // surfaces already hold these rows.
      bucketItems: (bucketItems ?? []).map((item) => ({
        id: item.id,
        type: item.type,
        name: bucketItemName(item),
        countryCode: item.country_code,
        placeName: item.place_name,
        fulfilledAt: item.fulfilled_at,
        fulfilledTripName: item.fulfilled_trip_name,
      })),
      today,
    };
  }, [trips, bucket, bucketItems, today]);

  const years = useMemo(
    () => recapYears(input.trips, today),
    [input.trips, today],
  );
  const latest = years[0] ?? null;

  // The headline numbers for the newest year, so the affordance says what is
  // behind it instead of being a button with a promise on it.
  const preview = useMemo(
    () => (latest === null ? null : buildYearRecap(input, latest)),
    [input, latest],
  );

  if (latest === null || !preview) return null;

  const line = [
    preview.stats.countries > 0
      ? `${preview.stats.countries} ${
          preview.stats.countries === 1 ? "country" : "countries"
        }`
      : null,
    preview.stats.trips > 0
      ? `${preview.stats.trips} ${preview.stats.trips === 1 ? "trip" : "trips"}`
      : null,
    preview.stats.distanceKm > 0 ? formatKm(preview.stats.distanceKm) : null,
  ]
    .filter((part): part is string => part !== null)
    .join("  ·  ");

  return (
    <>
      {variant === "button" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border border-brand/40 bg-brand/10 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-brand/20",
            className,
          )}
        >
          <SparklesIcon className="size-4 text-brand" />
          {preview.label} in travel
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "group relative isolate flex w-full items-center justify-between gap-4 overflow-hidden rounded-2xl border border-brand/25 bg-brand/[0.07] px-5 py-4 text-left transition-colors hover:bg-brand/[0.12]",
            className,
          )}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-16 -z-10 size-48 rounded-full bg-brand/20 blur-3xl"
          />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-brand">
              <SparklesIcon className="size-3.5" />
              Year in travel
            </span>
            <span className="mt-1.5 block text-xl font-semibold tracking-tight text-foreground">
              {preview.label}
            </span>
            {line ? (
              <span className="mt-0.5 block truncate text-sm text-foreground/55">
                {line}
              </span>
            ) : null}
          </span>
          <span className="shrink-0 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1.5 text-sm font-medium text-foreground/90 transition-colors group-hover:bg-white/[0.12]">
            Play
          </span>
        </button>
      )}

      {open ? (
        <YearRecapView
          input={input}
          years={years}
          initialYear={latest}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

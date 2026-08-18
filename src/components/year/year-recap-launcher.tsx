"use client";

import { useMemo, useState } from "react";
import { ChevronDownIcon, SparklesIcon } from "lucide-react";

import { YearRecapView } from "@/components/year/year-recap";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
//
// EVERY YEAR IS ON THE WAY IN, NOT ONLY BEHIND THE RECAP'S OWN PICKER.
//
// The picker inside the recap has always existed, and nothing outside said so:
// the entry point opened the newest year and a traveller with seven years of
// history had no reason to believe the other six were watchable. So the years
// are named here, where the decision to watch one is made. The newest is still
// one tap (it is the button, at full size, with its numbers on it) and the rest
// sit beside it as chips, so entering is no slower and the shape of the archive
// is visible without hunting.

export type YearRecapVariant = "banner" | "button";

/** Every year gets a chip. There is no count at which hiding a year becomes
 * the right answer: they are two-inch buttons and the whole point is that the
 * archive is visible, so a long history wraps onto another line. */
function YearChips({
  years,
  onSelect,
  className,
}: {
  years: number[];
  onSelect: (year: number) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {years.map((year) => (
        <button
          key={year}
          type="button"
          onClick={() => onSelect(year)}
          className="rounded-full border border-white/12 bg-white/[0.04] px-2.5 py-1 text-xs tabular-nums text-foreground/70 transition-colors hover:border-brand/40 hover:bg-brand/10 hover:text-foreground"
        >
          {year}
        </button>
      ))}
    </div>
  );
}

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
  // Which year the recap opens on, and null when it is shut. One piece of
  // state rather than two, so a chip cannot open the recap on last year's
  // number while the view is still mounted on this one.
  const [openYear, setOpenYear] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

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

  const others = years.filter((year) => year !== latest);

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

  function play(year: number) {
    setMenuOpen(false);
    setOpenYear(year);
  }

  return (
    <>
      {variant === "button" ? (
        // The compact entry, on a page header with other actions on it. A row
        // of chips would crowd that line, so the other years sit one tap away
        // behind a caret that says they exist. The newest year is still the
        // button itself and still one tap.
        <div className={cn("inline-flex items-stretch", className)}>
          <button
            type="button"
            onClick={() => play(latest)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border border-brand/40 bg-brand/10 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-brand/20",
              others.length > 0 && "rounded-r-none border-r-0",
            )}
          >
            <SparklesIcon className="size-4 text-brand" />
            {preview.label} in travel
          </button>
          {others.length > 0 ? (
            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger
                aria-label={`Pick another year (${others.length} more)`}
                className="inline-flex items-center rounded-md rounded-l-none border border-l border-brand/40 border-l-brand/25 bg-brand/10 px-2 text-foreground transition-colors hover:bg-brand/20"
              >
                <ChevronDownIcon className="size-4 text-brand" />
              </PopoverTrigger>
              <PopoverContent align="end" className="w-40 p-1.5">
                <p className="px-2 py-1 text-[0.68rem] uppercase tracking-wide text-foreground/35">
                  Watch a year
                </p>
                {years.map((year) => (
                  <button
                    key={year}
                    type="button"
                    onClick={() => play(year)}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm tabular-nums text-foreground/80 transition-colors hover:bg-white/[0.07] hover:text-foreground"
                  >
                    {year}
                    {year === latest ? (
                      <span className="text-[0.68rem] text-foreground/35">
                        newest
                      </span>
                    ) : null}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
      ) : (
        <div
          className={cn(
            "relative isolate overflow-hidden rounded-2xl border border-brand/25 bg-brand/[0.07]",
            className,
          )}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-16 -z-10 size-48 rounded-full bg-brand/20 blur-3xl"
          />
          {/* The newest year, at full size. The chips below are separate
              buttons, which is also why this is a div with a button in it
              rather than one button: a button inside a button is invalid and
              the year chips have to be independently tappable. */}
          <button
            type="button"
            onClick={() => play(latest)}
            className="group flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-brand/[0.06]"
          >
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

          {others.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-brand/15 px-5 py-3">
              <span className="text-[11px] uppercase tracking-wide text-foreground/35">
                Or watch
              </span>
              <YearChips years={others} onSelect={play} />
            </div>
          ) : null}
        </div>
      )}

      {openYear !== null ? (
        <YearRecapView
          input={input}
          years={years}
          initialYear={openYear}
          onClose={() => setOpenYear(null)}
        />
      ) : null}
    </>
  );
}

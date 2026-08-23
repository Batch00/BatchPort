"use client";

import { useState } from "react";

import { CountryFlag } from "@/components/country-flag";
import { formatUsd, type DestinationSpend } from "@/lib/expenses";
import { formatDateRangeShort } from "@/lib/format";
import { cn } from "@/lib/utils";

// What each stop cost per day.
//
// ON-GROUND IS THE HEADLINE, all-in behind a toggle, and the real data argued
// it better than the design did:
//
//   - Sorrento reads 226/day all-in and 176 on-ground, a 250 gap made of the
//     Naples and Capri ferries. All-in calls Sorrento the trip's most
//     expensive stop. It was not; Rome was. Sorrento was the longest stay with
//     the most day trips out of it.
//   - The second London reads 142 all-in and 77 on-ground, the largest
//     proportional gap, because the outbound flight lands on its arrival day.
//     Only on-ground says those last three days were cheap.
//
// So the default answers "what did being there cost", and the toggle answers
// "what did this leg of the trip cost", which is a different question rather
// than a more honest version of the same one.
//
// A STOP IS A ROW, NOT A PLACE NAME. A trip that begins and ends in London has
// two London rows with their own days and their own costs. They are never
// merged, and the ordering is visit order rather than a leaderboard so they
// read as the beginning and the end.

export function DestinationCosts({ stops }: { stops: DestinationSpend[] }) {
  const [allIn, setAllIn] = useState(false);
  if (stops.length === 0) return null;

  const perDay = (stop: DestinationSpend) =>
    allIn ? stop.usdPerDay : stop.onGroundUsdPerDay;
  const total = (stop: DestinationSpend) =>
    allIn ? stop.totalUsd : stop.onGroundUsd;

  const peak = Math.max(
    ...stops.map((stop) => perDay(stop) ?? 0),
    0,
  );

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-foreground/80">Cost per day, by stop</h2>
          <p className="text-xs text-foreground/45">
            {allIn
              ? "Everything attributed to the stop, including getting there."
              : "Being there: transport between stops is left out, lodging is in."}
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="Which costs to include"
          className="flex shrink-0 overflow-hidden rounded-lg border border-input text-xs"
        >
          <ToggleButton active={!allIn} onClick={() => setAllIn(false)}>
            On the ground
          </ToggleButton>
          <ToggleButton active={allIn} onClick={() => setAllIn(true)}>
            All in
          </ToggleButton>
        </div>
      </div>

      <ul className="flex flex-col gap-1.5">
        {stops.map((stop) => {
          const value = perDay(stop);
          const width = peak > 0 && value !== null ? (value / peak) * 100 : 0;
          const gap = stop.usdPerDay !== null && stop.onGroundUsdPerDay !== null
            ? stop.usdPerDay - stop.onGroundUsdPerDay
            : 0;
          return (
            // Stacked on a phone, three columns from sm up. At 375px the old
            // three-column row left the bar about fifty pixels wide and clipped
            // the date range, which is the one thing in the row that has to be
            // readable: it is what a per-day figure is per.
            <li
              key={stop.destinationId}
              className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3"
            >
              <div className="min-w-0 sm:w-44 sm:shrink-0">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="flex min-w-0 items-center gap-1.5 text-sm text-foreground">
                    {stop.countryCode ? (
                      <CountryFlag code={stop.countryCode} />
                    ) : null}
                    {/* The NAME may still truncate: it can be arbitrarily long
                        and its first word is enough to recognise a stop. */}
                    <span className="truncate">{stop.destinationName}</span>
                  </p>
                  {/* On a phone the figures ride up beside the name and dates
                      so the bar below can have the full width. From sm up they
                      live in their own column on the right instead. */}
                  <p className="shrink-0 text-sm tabular-nums text-foreground sm:hidden">
                    {value === null ? "-" : `${formatUsd(value)}/day`}
                  </p>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  {/* NOT truncated. With the short format it fits, and if a
                      long name ever squeezes it, wrapping to a second line is
                      the right failure. A tooltip would not be: the range is
                      what a per-day figure is per, and there is no hover on a
                      phone. */}
                  <p className="text-[0.7rem] text-foreground/40">
                    {stop.daysOwned} {stop.daysOwned === 1 ? "day" : "days"}
                    {stop.arrivalDate ? (
                      <>
                        {" · "}
                        {formatDateRangeShort(
                          stop.arrivalDate,
                          stop.departureDate,
                        )}
                      </>
                    ) : null}
                  </p>
                  <p className="shrink-0 text-[0.7rem] tabular-nums text-foreground/40 sm:hidden">
                    {formatUsd(total(stop))}
                    {!allIn && gap > 0 ? (
                      <span className="text-foreground/30"> +{formatUsd(gap)}</span>
                    ) : null}
                  </p>
                </div>
              </div>

              <div className="h-2 min-w-0 flex-1 rounded bg-white/[0.03] sm:h-6">
                <div
                  className="h-full rounded bg-brand/50"
                  style={{ width: `${Math.max(width, value ? 2 : 0)}%` }}
                />
              </div>

              <div className="hidden w-28 shrink-0 text-right sm:block">
                <p className="text-sm tabular-nums text-foreground">
                  {value === null ? "-" : `${formatUsd(value)}/day`}
                </p>
                <p className="text-[0.7rem] tabular-nums text-foreground/40">
                  {formatUsd(total(stop))}
                  {!allIn && gap > 0 ? (
                    <span className="text-foreground/30"> +{formatUsd(gap)}</span>
                  ) : null}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "px-2.5 py-1 transition-colors",
        active
          ? "bg-brand/15 text-brand"
          : "text-foreground/50 hover:bg-white/5 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

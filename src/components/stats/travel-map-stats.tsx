import { CompassIcon, HouseIcon } from "lucide-react";

import { ChartCard } from "./chart-card";
import { formatKm, formatLatitude, formatLongitude } from "@/lib/stats-format";
import { extremesInsight } from "@/lib/stats-insights";
import type {
  ExtremeEntry,
  FurthestFromHome,
  TravelExtremes,
} from "@/lib/stats-data";

function ExtremeTile({
  direction,
  letter,
  entry,
  coordinate,
}: {
  direction: string;
  letter: string;
  entry: ExtremeEntry;
  coordinate: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-white/[0.02] p-4 ring-1 ring-foreground/10">
      {/* Watermark compass letter, purely decorative. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-1 -top-3 select-none text-6xl font-bold tracking-tight text-brand/[0.08]"
      >
        {letter}
      </span>
      <p className="text-xs font-medium uppercase tracking-wide text-foreground/45">
        {direction}
      </p>
      <p className="mt-1 break-words text-sm font-medium text-foreground">
        {entry.name ?? "Unknown"}
      </p>
      <p className="text-xs tabular-nums text-brand/80">{coordinate}</p>
    </div>
  );
}

// The compass of your furthest points: the four travel extremes as quadrant
// tiles around a compass motif. Coordinate values come from v_travel_extremes;
// the destination names are resolved server-side.
export function TravelMapStats({
  extremes,
  furthestFromHome,
}: {
  extremes: TravelExtremes;
  /** Null until the user sets a home city in Settings. The tile is then
   * simply absent: no prompt, no placeholder. */
  furthestFromHome?: FurthestFromHome | null;
}) {
  return (
    <ChartCard
      title="Travel extremes"
      description={extremesInsight(extremes) ?? "The corners of your map so far"}
    >
      {/* The compass motif only works over a 2x2 grid, so the home tile is a
          sibling below rather than a fifth quadrant. */}
      <div className="relative grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ExtremeTile
          direction="Northernmost"
          letter="N"
          entry={extremes.north}
          coordinate={formatLatitude(extremes.north.value)}
        />
        <ExtremeTile
          direction="Easternmost"
          letter="E"
          entry={extremes.east}
          coordinate={formatLongitude(extremes.east.value)}
        />
        <ExtremeTile
          direction="Westernmost"
          letter="W"
          entry={extremes.west}
          coordinate={formatLongitude(extremes.west.value)}
        />
        <ExtremeTile
          direction="Southernmost"
          letter="S"
          entry={extremes.south}
          coordinate={formatLatitude(extremes.south.value)}
        />
        {/* Center compass, only when the quadrants form a 2x2 grid. */}
        <span className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-brand/30 bg-[#0a0a0a] p-2 text-brand sm:flex">
          <CompassIcon className="size-5" />
        </span>
      </div>

      {furthestFromHome ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl bg-white/[0.02] p-4 ring-1 ring-foreground/10">
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-foreground/45">
              <HouseIcon className="size-3 text-brand/70" />
              Furthest from home
            </span>
            <span className="mt-1 block break-words text-sm font-medium text-foreground">
              {furthestFromHome.name}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-sm font-medium tabular-nums text-brand/90">
              {formatKm(furthestFromHome.distanceKm)}
            </span>
            {furthestFromHome.homeLabel ? (
              <span className="block text-xs text-foreground/40">
                from {furthestFromHome.homeLabel}
              </span>
            ) : null}
          </span>
        </div>
      ) : null}
    </ChartCard>
  );
}

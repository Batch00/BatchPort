import { CompassIcon } from "lucide-react";

import { ChartCard } from "./chart-card";
import { formatLatitude, formatLongitude } from "@/lib/stats-format";
import { extremesInsight } from "@/lib/stats-insights";
import type { ExtremeEntry, TravelExtremes } from "@/lib/stats-data";

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
export function TravelMapStats({ extremes }: { extremes: TravelExtremes }) {
  return (
    <ChartCard
      title="Travel extremes"
      description={extremesInsight(extremes) ?? "The corners of your map so far"}
    >
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
    </ChartCard>
  );
}

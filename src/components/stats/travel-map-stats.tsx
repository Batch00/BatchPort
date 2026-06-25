import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { ChartCard } from "./chart-card";
import { formatLatitude, formatLongitude } from "@/lib/stats-format";
import type { ExtremeEntry, TravelExtremes } from "@/lib/stats-data";

function ExtremeTile({
  icon: Icon,
  direction,
  entry,
  coordinate,
}: {
  icon: LucideIcon;
  direction: string;
  entry: ExtremeEntry;
  coordinate: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-white/[0.02] p-4 ring-1 ring-foreground/10">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-foreground/45">
          {direction}
        </p>
        <p className="truncate text-sm font-medium text-foreground">
          {entry.name ?? "Unknown"}
        </p>
        <p className="text-xs tabular-nums text-foreground/50">{coordinate}</p>
      </div>
    </div>
  );
}

// A compact 2x2 compass of the four travel extremes. Coordinate values come
// from v_travel_extremes; the destination names are resolved server-side.
export function TravelMapStats({ extremes }: { extremes: TravelExtremes }) {
  return (
    <ChartCard
      title="Travel extremes"
      description="The corners of your map so far"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ExtremeTile
          icon={ArrowUpIcon}
          direction="Northernmost"
          entry={extremes.north}
          coordinate={formatLatitude(extremes.north.value)}
        />
        <ExtremeTile
          icon={ArrowDownIcon}
          direction="Southernmost"
          entry={extremes.south}
          coordinate={formatLatitude(extremes.south.value)}
        />
        <ExtremeTile
          icon={ArrowRightIcon}
          direction="Easternmost"
          entry={extremes.east}
          coordinate={formatLongitude(extremes.east.value)}
        />
        <ExtremeTile
          icon={ArrowLeftIcon}
          direction="Westernmost"
          entry={extremes.west}
          coordinate={formatLongitude(extremes.west.value)}
        />
      </div>
    </ChartCard>
  );
}

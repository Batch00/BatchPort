import {
  CalendarIcon,
  GlobeIcon,
  LayersIcon,
  MapIcon,
  MapPinIcon,
  RouteIcon,
  SparklesIcon,
} from "lucide-react";

import { StatCard } from "@/components/stats/stat-card";
import { formatKm, funDistanceComparison } from "@/lib/stats-format";
import type { TravelSummary } from "@/lib/stats-data";

interface StatsGridProps {
  summary: TravelSummary | null;
  distanceKm: number;
}

// The summary metrics at the top of the stats page. All values come straight
// from v_user_travel_summary and f_distance_traveled.
export function StatsGrid({ summary, distanceKm }: StatsGridProps) {
  if (!summary) {
    return (
      <p className="rounded-xl border border-dashed border-white/10 px-6 py-12 text-center text-sm text-foreground/60">
        No travel data yet. Add a trip to see your stats.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Countries"
        value={summary.countries_visited}
        icon={GlobeIcon}
        subtext={`${summary.world_pct}% of the world`}
      />
      <StatCard
        label="Continents"
        value={`${summary.continents_visited} / 7`}
        icon={MapIcon}
      />
      <StatCard label="Trips" value={summary.total_trips} icon={RouteIcon} />
      <StatCard
        label="Destinations"
        value={summary.total_destinations}
        icon={MapPinIcon}
      />
      <StatCard
        label="Experiences"
        value={summary.total_experiences}
        icon={SparklesIcon}
      />
      <StatCard
        label="Days traveling"
        value={summary.days_traveling}
        icon={CalendarIcon}
      />
      <StatCard
        label="Distance traveled"
        value={formatKm(distanceKm)}
        icon={LayersIcon}
        subtext={funDistanceComparison(distanceKm)}
      />
    </div>
  );
}

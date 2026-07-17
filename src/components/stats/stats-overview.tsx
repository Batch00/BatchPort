"use client";

import { useState } from "react";
import {
  CalendarIcon,
  GlobeIcon,
  MapPinIcon,
  RouteIcon,
  SendIcon,
  SparklesIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { AnimatedNumber, CountUpGroup } from "@/components/stats/count-up";
import { CountryFlag } from "@/components/country-flag";
import { funDistanceComparison, lapProgress } from "@/lib/stats-format";
import { cn } from "@/lib/utils";
import type { TravelSummary } from "@/lib/stats-data";

// The summary stats treatment shared by the dashboard Overview, the detailed
// stats page hero, and the public share/demo profile. Two feature cards
// (countries and distance) carry the expressive treatment; four supporting
// tiles stay compact. All values come straight from v_user_travel_summary and
// f_distance_traveled; the flag strip is the visited country codes the caller
// already has (globe data or the country frequency view), never a new query.

const MAX_FLAGS = 8;
const CONTINENTS_TOTAL = 7;

interface StatsOverviewProps {
  summary: TravelSummary | null;
  distanceKm: number;
  /** Visited country codes for the flag strip; order decides which show. */
  flagCodes?: string[];
}

function FeatureCard({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div className="col-span-2 flex flex-col gap-3 rounded-2xl bg-gradient-to-br from-brand/[0.12] via-card to-card p-5 ring-1 ring-brand/20 sm:p-6">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-foreground/50">
          {label}
        </span>
        <Icon className="size-4 text-brand/60" />
      </div>
      {children}
    </div>
  );
}

// The visited-country flag strip: SVG flags (emoji flags do not render on
// Windows), capped by default with a "+N" chip that expands to the full list.
// When the caller has fewer codes than the visited count (the stats page only
// has the top-10 rows), the remainder stays as a static count.
function FlagStrip({
  codes,
  countriesVisited,
}: {
  codes: string[];
  countriesVisited: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (codes.length === 0) return null;

  const shown = expanded ? codes : codes.slice(0, MAX_FLAGS);
  const hidden = Math.max(0, countriesVisited - shown.length);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((code) => (
        <CountryFlag key={code} code={code} />
      ))}
      {!expanded && codes.length > MAX_FLAGS ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label={`Show all ${codes.length} flags`}
          className="rounded bg-white/5 px-1.5 py-0.5 text-xs font-medium text-foreground/60 transition-colors hover:bg-white/10 hover:text-foreground"
        >
          +{hidden}
        </button>
      ) : hidden > 0 ? (
        <span className="text-xs font-medium text-foreground/50">
          +{hidden}
        </span>
      ) : null}
      {expanded && codes.length > MAX_FLAGS ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-xs font-medium text-foreground/50 transition-colors hover:text-foreground"
        >
          Show fewer
        </button>
      ) : null}
    </div>
  );
}

// A slim progress sliver under a feature number.
function Sliver({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className="h-full rounded-full bg-brand"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function SupportTile({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground/50">{label}</span>
        <Icon className="size-4 text-foreground/30" />
      </div>
      <AnimatedNumber
        value={value}
        className="text-2xl font-semibold tracking-tight tabular-nums text-foreground sm:text-3xl"
      />
    </div>
  );
}

export function StatsOverview({
  summary,
  distanceKm,
  flagCodes = [],
}: StatsOverviewProps) {
  if (!summary) {
    return (
      <p className="rounded-xl border border-dashed border-white/10 px-6 py-12 text-center text-sm text-foreground/60">
        No travel data yet. Add a trip to see your stats.
      </p>
    );
  }

  const validFlagCodes = flagCodes.filter((code) =>
    /^[A-Za-z]{2}$/.test(code),
  );
  const continents = Math.max(
    0,
    Math.min(CONTINENTS_TOTAL, summary.continents_visited),
  );

  return (
    <CountUpGroup className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <FeatureCard label="Countries visited" icon={GlobeIcon}>
        <div className="flex items-baseline gap-2">
          <AnimatedNumber
            value={summary.countries_visited}
            className="text-4xl font-semibold tracking-tight tabular-nums text-foreground sm:text-5xl"
          />
          <span className="text-sm text-brand">
            {summary.world_pct}% of the world
          </span>
        </div>
        <Sliver pct={summary.world_pct} />
        <FlagStrip
          codes={validFlagCodes}
          countriesVisited={summary.countries_visited}
        />
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            {Array.from({ length: CONTINENTS_TOTAL }, (_, index) => (
              <span
                key={index}
                className={cn(
                  "size-1.5 rounded-full",
                  index < continents ? "bg-brand" : "bg-white/15",
                )}
              />
            ))}
          </div>
          <span className="text-xs text-foreground/50">
            {continents} of {CONTINENTS_TOTAL} continents
          </span>
        </div>
      </FeatureCard>

      <FeatureCard label="Distance traveled" icon={SendIcon}>
        <div className="flex items-baseline gap-1.5">
          <AnimatedNumber
            value={Math.round(distanceKm)}
            className="text-4xl font-semibold tracking-tight tabular-nums text-foreground sm:text-5xl"
          />
          <span className="text-sm text-foreground/50">km</span>
        </div>
        <Sliver pct={lapProgress(distanceKm) * 100} />
        <p className="text-sm text-brand">{funDistanceComparison(distanceKm)}</p>
      </FeatureCard>

      <SupportTile label="Trips" value={summary.total_trips} icon={RouteIcon} />
      <SupportTile
        label="Destinations"
        value={summary.total_destinations}
        icon={MapPinIcon}
      />
      <SupportTile
        label="Experiences"
        value={summary.total_experiences}
        icon={SparklesIcon}
      />
      <SupportTile
        label="Days traveling"
        value={summary.days_traveling}
        icon={CalendarIcon}
      />
    </CountUpGroup>
  );
}

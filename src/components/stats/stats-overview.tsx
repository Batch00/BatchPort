"use client";

import { useState } from "react";
import {
  CalendarIcon,
  GlobeIcon,
  MapPinIcon,
  MapPinnedIcon,
  RouteIcon,
  SendIcon,
  SparklesIcon,
  WaypointsIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { AnimatedNumber, CountUpGroup } from "@/components/stats/count-up";
import { CountryFlag, countryName } from "@/components/country-flag";
import { InfoTip } from "@/components/ui/info-tip";
import { funDistanceComparison, lapProgress } from "@/lib/stats-format";
import { cn } from "@/lib/utils";
import type { TravelSummary } from "@/lib/stats-data";
import type { DashboardPlacesSummary } from "@/lib/places-dashboard-data";

// The summary stats treatment shared by the dashboard Overview, the detailed
// stats page hero, and the public share/demo profile. Two feature cards
// (countries and distance) carry the expressive treatment; four supporting
// tiles stay compact. All values come straight from v_user_travel_summary and
// f_distance_traveled; the flag strip is the visited country codes the caller
// already has (globe data or the country frequency view), never a new query.
//
// The dashboard alone appends two places tiles (states and places) from
// v_places_summary, which stays a separate view from v_user_travel_summary.
// Like every tile in the row they are not links: the "Detailed stats" link
// above the row already goes to the detail. Every other caller leaves
// `places` unset and renders exactly the row it always did.

const MAX_FLAGS = 8;
const CONTINENTS_TOTAL = 7;

interface StatsOverviewProps {
  summary: TravelSummary | null;
  distanceKm: number;
  /** Visited country codes for the flag strip; order decides which show. */
  flagCodes?: string[];
  /** The dashboard's two places tiles. Absent everywhere else, including the
   * read-only surfaces, which is the gate. */
  places?: DashboardPlacesSummary | null;
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
      {/* The only flag row with no country name beside it, so each flag carries
          a tip. Tappable on touch, where a native title showed nothing. */}
      {shown.map((code) => (
        <InfoTip
          key={code}
          tip={countryName(code)}
          label={countryName(code)}
          className="inline-flex items-center"
        >
          <CountryFlag code={code} />
        </InfoTip>
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

// A compact tile. `unit` rides beside the number ("of 50") and `subtext` is a
// one-line fun caption under it in the brand colour the feature cards use for
// theirs. Both are optional, so the original four tiles render exactly as
// they did.
function SupportTile({
  label,
  value,
  icon: Icon,
  unit,
  subtext,
  className,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  unit?: string;
  subtext?: string | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-xl bg-card p-4 ring-1 ring-foreground/10",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground/50">{label}</span>
        <Icon className="size-4 text-foreground/30" />
      </div>
      <div className="flex items-baseline gap-1.5">
        <AnimatedNumber
          value={value}
          className="text-2xl font-semibold tracking-tight tabular-nums text-foreground sm:text-3xl"
        />
        {unit ? (
          <span className="text-sm text-foreground/50">{unit}</span>
        ) : null}
      </div>
      {subtext ? (
        <p className="truncate text-xs text-brand">{subtext}</p>
      ) : null}
    </div>
  );
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

// The states caption, a true statement at every count. DC is on the map and
// not in the 50, so it is named rather than silently dropped.
function statesSubtext(places: DashboardPlacesSummary): string {
  const togo = Math.max(0, places.statesTotal - places.statesVisited);
  if (places.statesVisited === 0) {
    return places.dcVisited ? "DC so far" : "Your first state is out there";
  }
  if (togo === 0) return places.dcVisited ? "All 50, and DC" : "All 50";
  const rest = `${togo} to go`;
  return places.dcVisited ? `${rest}, plus DC` : rest;
}

// The places caption names the localities, the towns those places sit in. A
// stadium or a park has no locality, so the count can be smaller than the
// places count, and it is simply left out when there is none.
function placesSubtext(places: DashboardPlacesSummary): string | null {
  if (places.places === 0) return "Log the first one";
  if (places.localities === 0) return null;
  return `across ${plural(places.localities, "town", "towns")}`;
}

export function StatsOverview({
  summary,
  distanceKm,
  flagCodes = [],
  places = null,
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

      {/* Two tiles: a pair on a phone row, and two columns each from lg up so
          the four-column row closes rather than leaving half a row empty. */}
      {places ? (
        <>
          <SupportTile
            label="US states"
            value={places.statesVisited}
            unit={`of ${places.statesTotal}`}
            subtext={statesSubtext(places)}
            icon={MapPinnedIcon}
            className="lg:col-span-2"
          />
          <SupportTile
            label="Places"
            value={places.places}
            unit={places.places === 1 ? "place" : "places"}
            subtext={placesSubtext(places)}
            icon={WaypointsIcon}
            className="lg:col-span-2"
          />
        </>
      ) : null}
    </CountUpGroup>
  );
}

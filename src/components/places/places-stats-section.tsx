import Link from "next/link";
import { MapPinnedIcon, PlusIcon } from "lucide-react";

import { CatalogProgress } from "@/components/places/catalog-progress";
import { OccasionChart } from "@/components/places/occasion-chart";
import { PlacesOverview } from "@/components/places/places-overview";
import { PlacesYearlyChart } from "@/components/places/places-yearly-chart";
import { StatesMap } from "@/components/places/states-map";
import {
  hasPlaces,
  occasionBars,
  occasionInsight,
  splitCatalogs,
  yearlyPlaces,
  yearlyPlacesInsight,
  type PlacesStats,
} from "@/lib/places-stats";
import type { StateCoverageRow } from "@/lib/state-map";

// The Places section of the stats page. Rendered only behind PLACES_ENABLED,
// and the page decides that, so this component never has to know about the
// flag.
//
// Order: what you have logged, where it put you, what you are collecting, why
// and when. The two charts pair on a wide screen the way "Travel by year" and
// "Experiences by category" do above them.
//
// EMPTY STATES ARE ONE CARD, NOT FIVE. With no places logged the section is
// the states map (trip stops still fill states, so it can have something true
// to say) plus a single pointer to /places. Each chart is ABSENT when it has
// no rows rather than drawing "nothing here yet" in its own frame: a user with
// three undated places would otherwise get an overview card followed by two
// empty boxes.
//
// A null coverage means the read failed (see places-stats-data.ts); the map is
// then absent rather than drawn empty, because an all-grey map would be a
// claim ("no states") that the failure cannot support.
export function PlacesStatsSection({
  coverage,
  stats,
}: {
  coverage: StateCoverageRow[] | null;
  stats: PlacesStats;
}) {
  const logged = hasPlaces(stats);
  const catalogs = splitCatalogs(stats.catalogs, stats.catalogItems);
  const occasions = occasionBars(stats.occasions);
  const years = yearlyPlaces(stats.yearly);

  return (
    <section className="flex min-w-0 flex-col gap-4" aria-labelledby="places-stats">
      <h2
        id="places-stats"
        className="flex items-center gap-2 text-sm font-medium text-foreground/80"
      >
        <MapPinnedIcon className="size-4 text-brand/70" />
        Places
      </h2>

      {logged && stats.counts ? (
        <PlacesOverview
          counts={stats.counts}
          firstPlaceDate={stats.summary?.first_place_date ?? null}
        />
      ) : (
        <NoPlacesYet />
      )}

      {coverage ? <StatesMap rows={coverage} /> : null}

      {logged ? <CatalogProgress split={catalogs} /> : null}

      {occasions.length > 0 || years.length > 0 ? (
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          {years.length > 0 ? (
            <PlacesYearlyChart data={years} description={yearlyPlacesInsight(years)} />
          ) : null}
          {occasions.length > 0 ? (
            <OccasionChart data={occasions} description={occasionInsight(occasions)} />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function NoPlacesYet() {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-2xl bg-card p-5 ring-1 ring-foreground/10 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium text-foreground/85">No places logged yet</p>
        <p className="mt-0.5 text-sm text-foreground/50">
          Stadiums, campuses, parks, a friend&apos;s town. Each one counts here.
        </p>
      </div>
      <Link
        href="/places"
        className="inline-flex h-9 shrink-0 items-center gap-1.5 self-start rounded-lg bg-brand px-3 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand/90 sm:self-auto"
      >
        <PlusIcon className="size-4" />
        Log a place
      </Link>
    </div>
  );
}

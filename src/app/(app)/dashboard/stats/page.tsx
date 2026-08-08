import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { requireUser } from "@/lib/current-user";
import { getAllStats } from "@/lib/stats-data";
import { getMapData } from "@/lib/map-data";
import { getProfileTrips } from "@/lib/share-data";
import { getBucketList } from "@/lib/bucket-list";
import { buildPosterData, hasPosterData } from "@/lib/poster/poster-data";
import { PosterExportButton } from "@/components/poster/poster-export";
import { YearRecapLauncher } from "@/components/year/year-recap-launcher";
import { todayIso } from "@/lib/year-recap";
import {
  categoryInsight,
  countryInsight,
  travelRecords,
  yearlyInsight,
} from "@/lib/stats-insights";
import { StatsOverview } from "@/components/stats/stats-overview";
import { RecordsRow } from "@/components/stats/records-row";
import { TransportBreakdownCard } from "@/components/stats/transport-breakdown";
import { YearlyChart } from "@/components/stats/yearly-chart";
import { CategoryChart } from "@/components/stats/category-chart";
import { CountryChart } from "@/components/stats/country-chart";
import { TravelMapStats } from "@/components/stats/travel-map-stats";
import {
  SuperlativesHeading,
  SuperlativesSection,
} from "@/components/stats/superlatives";
import { BucketProgress } from "@/components/stats/bucket-progress";
import { hasSuperlatives } from "@/lib/superlatives";

export const metadata = { title: "Travel Stats" };

// Travel stats dashboard. Server component: it resolves the current user (the
// demo account when signed in as the demo) and passes that id to getAllStats so
// the SQL views return that user's data. The page reads as the story of the
// user's travel: a hero summary band, a records row, then chart sections whose
// one-line insights are computed from the already-fetched view rows.
export default async function StatsPage() {
  const { user } = await requireUser();
  // The poster draws the same travel history these numbers describe, so its
  // data rides along here rather than on a route of its own.
  const [stats, mapData, trips, bucketItems] = await Promise.all([
    getAllStats(user.id),
    getMapData(user.id),
    // The year recap is another reading of the same travel history this page
    // counts, so it belongs next to the poster. It needs the trips themselves
    // rather than the aggregate views, which is the one query it adds.
    getProfileTrips(user.id, { story: true }),
    // And the bucket rows, so its closing slide can name the places on the
    // list instead of only counting them.
    getBucketList(user.id),
  ]);
  const posterData = buildPosterData(mapData, stats);

  const records = travelRecords({
    yearly: stats.yearly,
    categories: stats.categories,
    countries: stats.countries,
  });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6 sm:p-8">
      <div>
        <Link
          href="/dashboard"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-foreground/60 transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          Back to dashboard
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Travel Stats
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              The story of your travels, by the numbers
            </p>
          </div>
          {/* Absent until there is something to draw: an empty world is not a
              poster, and offering one would be an empty state with a download
              button on it. */}
          <div className="flex flex-wrap items-center gap-2">
            <YearRecapLauncher
              trips={trips}
              bucket={stats.bucket}
              bucketItems={bucketItems}
              today={todayIso()}
              variant="button"
            />
            {hasPosterData(posterData) ? (
              <PosterExportButton data={posterData} />
            ) : null}
          </div>
        </div>
      </div>

      <StatsOverview
        summary={stats.summary}
        distanceKm={stats.distanceKm}
        flagCodes={stats.countries.map((country) => country.country_code)}
      />

      <RecordsRow records={records} />

      {/* Absent until at least one transport leg has been recorded. There is
          no "record how you travelled" empty state. */}
      {stats.transport ? (
        <TransportBreakdownCard breakdown={stats.transport} />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <YearlyChart data={stats.yearly} description={yearlyInsight(stats.yearly)} />
        <CategoryChart
          data={stats.categories}
          description={categoryInsight(stats.categories)}
        />
      </div>

      <CountryChart
        data={stats.countries}
        description={countryInsight(stats.countries)}
      />

      {/* Superlatives sit after the aggregate charts and before the extremes:
          the charts answer "how much", this answers "which one". */}
      {hasSuperlatives(stats.superlatives) ? (
        <div className="flex flex-col gap-3">
          <SuperlativesHeading />
          <SuperlativesSection superlatives={stats.superlatives} />
        </div>
      ) : null}

      <TravelMapStats
        extremes={stats.extremes}
        furthestFromHome={stats.furthestFromHome}
      />

      {stats.bucket ? <BucketProgress bucket={stats.bucket} /> : null}
    </div>
  );
}

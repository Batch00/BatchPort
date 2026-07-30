import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { requireUser } from "@/lib/current-user";
import { getAllStats } from "@/lib/stats-data";
import {
  categoryInsight,
  countryInsight,
  travelRecords,
  yearlyInsight,
} from "@/lib/stats-insights";
import { StatsOverview } from "@/components/stats/stats-overview";
import { RecordsRow } from "@/components/stats/records-row";
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
  const stats = await getAllStats(user.id);

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
        <h1 className="text-2xl font-semibold tracking-tight">Travel Stats</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The story of your travels, by the numbers
        </p>
      </div>

      <StatsOverview
        summary={stats.summary}
        distanceKm={stats.distanceKm}
        flagCodes={stats.countries.map((country) => country.country_code)}
      />

      <RecordsRow records={records} />

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

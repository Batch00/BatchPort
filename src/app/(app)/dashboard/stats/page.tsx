import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { requireUser } from "@/lib/current-user";
import { getAllStats } from "@/lib/stats-data";
import { StatsGrid } from "@/components/stats/stats-grid";
import { YearlyChart } from "@/components/stats/yearly-chart";
import { CategoryChart } from "@/components/stats/category-chart";
import { CountryChart } from "@/components/stats/country-chart";
import { TravelMapStats } from "@/components/stats/travel-map-stats";
import { BucketProgress } from "@/components/stats/bucket-progress";

// Travel stats dashboard. Server component: it resolves the current user (the
// demo account when signed in as the demo) and passes that id to getAllStats so
// the SQL views return that user's data. Charts receive plain data props.
export default async function StatsPage() {
  const { user } = await requireUser();
  const stats = await getAllStats(user.id);

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
          Your journey by the numbers
        </p>
      </div>

      <StatsGrid summary={stats.summary} distanceKm={stats.distanceKm} />

      <div className="grid gap-4 lg:grid-cols-2">
        <YearlyChart data={stats.yearly} />
        <CategoryChart data={stats.categories} />
      </div>

      <CountryChart data={stats.countries} />

      <TravelMapStats extremes={stats.extremes} />

      {stats.bucket ? <BucketProgress bucket={stats.bucket} /> : null}
    </div>
  );
}

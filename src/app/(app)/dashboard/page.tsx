import Link from "next/link";
import { ChevronRightIcon, ListChecksIcon } from "lucide-react";

import { requireUser } from "@/lib/current-user";
import { getProfileTrips } from "@/lib/share-data";
import { getMapData } from "@/lib/map-data";
import { getAllStats } from "@/lib/stats-data";
import { Card } from "@/components/ui/card";
import { DashboardGlobe } from "@/components/map/dashboard-globe";
import { DashboardTrips } from "@/components/trips/dashboard-trips";
import { StatsGrid } from "@/components/stats/stats-grid";
import { BucketProgress } from "@/components/stats/bucket-progress";

export const metadata = { title: "Dashboard" };

// The authenticated dashboard mirrors the demo and share layout (globe, stats
// summary, trips, bucket progress) but keeps the editing affordances: add trip,
// clickable trip cards, and links into the deep-dive stats and bucket pages.
export default async function DashboardPage() {
  const { user } = await requireUser();
  const [trips, mapData, stats] = await Promise.all([
    getProfileTrips(user.id),
    getMapData(),
    getAllStats(),
  ]);

  const bucket = stats.bucket;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6 sm:p-8">
      <DashboardGlobe data={mapData} />

      <section>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium text-foreground/80">Overview</h2>
          <Link
            href="/dashboard/stats"
            className="text-sm text-brand underline-offset-4 transition-colors hover:underline"
          >
            Detailed stats
          </Link>
        </div>
        <StatsGrid summary={stats.summary} distanceKm={stats.distanceKm} />
      </section>

      <DashboardTrips trips={trips} />

      <section>
        <h2 className="mb-4 text-sm font-medium text-foreground/80">
          Bucket list
        </h2>
        {bucket && bucket.total > 0 ? (
          <Link
            href="/dashboard/bucket-list"
            className="block transition-opacity hover:opacity-90"
          >
            <BucketProgress bucket={bucket} heading={false} />
          </Link>
        ) : (
          <Link href="/dashboard/bucket-list" className="group block">
            <Card className="flex flex-row items-center justify-between gap-4 p-4 transition-all group-hover:ring-brand/40">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                  <ListChecksIcon className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    Start your bucket list
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    Plan the countries and places you want to reach next.
                  </p>
                </div>
              </div>
              <ChevronRightIcon className="size-4 shrink-0 text-foreground/40" />
            </Card>
          </Link>
        )}
      </section>
    </div>
  );
}

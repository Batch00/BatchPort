import Link from "next/link";
import {
  ChevronRightIcon,
  ImageIcon,
  ListChecksIcon,
  PlusIcon,
} from "lucide-react";

import { getTrips } from "@/lib/trips";
import { getMapData } from "@/lib/map-data";
import { getAllStats } from "@/lib/stats-data";
import { getPhotosByIds } from "@/lib/photos-data";
import { getPhotoUrl } from "@/lib/photos";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/trips/status-badge";
import { DashboardGlobe } from "@/components/map/dashboard-globe";
import { StatsGrid } from "@/components/stats/stats-grid";
import { BucketProgress } from "@/components/stats/bucket-progress";
import { flagEmoji, formatDateRange } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Photo } from "@/lib/types";

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export const metadata = { title: "Dashboard" };

// The authenticated dashboard mirrors the demo and share layout (globe, stats
// summary, trips, bucket progress) but keeps the editing affordances: add trip,
// clickable trip cards, and links into the deep-dive stats and bucket pages.
export default async function DashboardPage() {
  const [trips, mapData, stats] = await Promise.all([
    getTrips(),
    getMapData(),
    getAllStats(),
  ]);

  // Resolve every trip's cover photo in a single query.
  const coverIds = trips
    .map((trip) => trip.cover_photo_id)
    .filter((id): id is string => Boolean(id));
  const coverPhotos = await getPhotosByIds(coverIds);
  const coversById = new Map<string, Photo>(
    coverPhotos.map((photo) => [photo.id, photo]),
  );

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

      <section>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium text-foreground/80">Trips</h2>
          <Link
            href="/trips/new"
            className={cn(
              buttonVariants({ size: "sm" }),
              "bg-brand text-brand-foreground hover:bg-brand/90",
            )}
          >
            <PlusIcon />
            Add trip
          </Link>
        </div>

        {trips.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 px-6 py-12 text-center text-sm text-foreground/60">
            Your trips will appear here.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {trips.map((trip) => {
              const cover = trip.cover_photo_id
                ? coversById.get(trip.cover_photo_id)
                : undefined;
              return (
                <Link key={trip.id} href={`/trips/${trip.id}`} className="group">
                  <Card className="h-full gap-0 overflow-hidden p-0 transition-all group-hover:ring-brand/40">
                    <div className="relative aspect-[16/10] w-full bg-white/5">
                      {cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={getPhotoUrl(cover)}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="flex size-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-white/[0.06] to-transparent text-foreground/30">
                          {trip.primary_country_code ? (
                            <span className="text-2xl">
                              {flagEmoji(trip.primary_country_code)}
                            </span>
                          ) : (
                            <ImageIcon className="size-6" />
                          )}
                          {trip.primary_country_code ? (
                            <span className="text-xs text-foreground/40">
                              {trip.primary_country_code}
                            </span>
                          ) : null}
                        </div>
                      )}
                      <div className="absolute right-2 top-2">
                        <StatusBadge status={trip.status} />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 p-4">
                      <h3 className="font-medium text-foreground">{trip.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {formatDateRange(trip.start_date, trip.end_date)}
                      </p>
                      <div className="mt-1 flex items-center gap-4 text-xs text-foreground/60">
                        <span>
                          {countLabel(trip.destination_count, "stop", "stops")}
                        </span>
                        <span>
                          {countLabel(
                            trip.country_count,
                            "country",
                            "countries",
                          )}
                        </span>
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-sm font-medium text-foreground/80">
          Bucket list
        </h2>
        {bucket && bucket.total > 0 ? (
          <Link
            href="/dashboard/bucket-list"
            className="block transition-opacity hover:opacity-90"
          >
            <BucketProgress bucket={bucket} />
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

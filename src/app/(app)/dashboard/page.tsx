import Link from "next/link";

import { requireUser } from "@/lib/current-user";
import { isDemoUser } from "@/lib/demo";
import { getProfileTrips } from "@/lib/share-data";
import { getMapData } from "@/lib/map-data";
import { getPhotoMapData } from "@/lib/photo-map-data";
import { getSummaryStats } from "@/lib/stats-data";
import { getBucketList, getCountries } from "@/lib/bucket-list";
import { getCategories } from "@/lib/experiences";
import { getPlannedExperiencePoints } from "@/lib/nearby-data";
import { getOnThisDay } from "@/lib/on-this-day";
import { OnThisDaySection } from "@/components/dashboard/on-this-day";
import { YearRecapLauncher } from "@/components/year/year-recap-launcher";
import { todayIso } from "@/lib/year-recap";
import { getTripDestinationOptions, getTripOptions } from "@/lib/trips";
import { placeKey } from "@/lib/geo";
import { DashboardGlobe } from "@/components/map/dashboard-globe";
import { DashboardTrips } from "@/components/trips/dashboard-trips";
import { DashboardBucket } from "@/components/bucket-list/dashboard-bucket";
import { StatsOverview } from "@/components/stats/stats-overview";
import { DiscoveryProvider } from "@/components/discover/discovery-host";

export const metadata = { title: "Dashboard" };

// The authenticated dashboard mirrors the demo and share layout (globe, stats
// summary, trips, bucket list) but keeps the editing affordances: add trip,
// clickable trip cards, interactive bucket cards, and links into the deep-dive
// stats and bucket pages. One DiscoveryProvider hosts the discovery panel for
// the whole page: globe clicks, search, and bucket card clicks all share it.
export default async function DashboardPage() {
  const { user } = await requireUser();
  // Passing the user id lets each fetch skip its own auth.getUser round-trip,
  // and the summary fetch loads only the stats this page renders.
  const [
    trips,
    mapData,
    photoMapData,
    stats,
    bucketItems,
    countries,
    tripOptions,
    tripDestinationOptions,
    categories,
    plannedPoints,
    memories,
  ] = await Promise.all([
    // The story payload rides along because the year recap reads it: the
    // hero image, the photo count, and the journal days all come from it, and
    // the alternative was a second trip query on the same page.
    getProfileTrips(user.id, { story: true }),
    getMapData(user.id),
    getPhotoMapData(user.id),
    getSummaryStats(user.id),
    getBucketList(user.id),
    getCountries(),
    getTripOptions(),
    getTripDestinationOptions(),
    // Both feed Nearby mode: the log sheet's category picker and the checkoff
    // prompt's "you are near something you planned" match.
    getCategories(),
    getPlannedExperiencePoints(),
    // Two narrow anniversary-date queries, and only when they match does it
    // look up any context. Returns null on a day with nothing, which is what
    // keeps the section absent rather than empty.
    getOnThisDay(),
  ]);

  const toVisit = bucketItems.filter((item) => !item.fulfilled_at);
  const bucketPlaceKeys = mapData.bucketPlaces.map((place) =>
    placeKey(place.name, place.countryCode),
  );

  return (
    <DiscoveryProvider
      bucketCountryCodes={mapData.bucketCountryCodes}
      bucketPlaceKeys={bucketPlaceKeys}
      tripOptions={tripDestinationOptions}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6 sm:p-8">
        <DashboardGlobe
          data={mapData}
          photoData={photoMapData}
          categories={categories}
          plannedPoints={plannedPoints}
          isDemo={isDemoUser(user.id)}
        />

        {/* Absent until a year has something in it, so a new account never
            sees a recap of nothing. */}
        <YearRecapLauncher
          trips={trips}
          bucket={stats.bucket}
          bucketItems={bucketItems}
          today={todayIso()}
        />

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
          <StatsOverview
            summary={stats.summary}
            distanceKm={stats.distanceKm}
            flagCodes={mapData.visitedCountryCodes}
          />
        </section>

        {memories ? <OnThisDaySection memories={memories} /> : null}

        <DashboardTrips trips={trips} />

        <DashboardBucket
          toVisit={toVisit}
          stats={stats.bucket}
          countries={countries}
          trips={tripOptions}
          isDemo={isDemoUser(user.id)}
        />
      </div>
    </DiscoveryProvider>
  );
}

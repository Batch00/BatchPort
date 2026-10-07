import Link from "next/link";

import { requireUser } from "@/lib/current-user";
import { isDemoUser } from "@/lib/demo";
import { PLACES_ENABLED } from "@/lib/features";
import { getTripSpendByTrip } from "@/lib/expenses-data";
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
import { getTripDestinationOptions, getTripOptions } from "@/lib/trips";
import { placeKey } from "@/lib/geo";
import { DashboardGlobe } from "@/components/map/dashboard-globe";
import { PlaceEntryLauncher } from "@/components/places/place-entry-launcher";
import { RecentPlacesStrip } from "@/components/places/recent-places-strip";
import { getDashboardPlaces } from "@/lib/places-dashboard-data";
import { getOccasions } from "@/lib/places";
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
  // The places additions (overview tiles, recent strip, globe pins) are behind
  // the flag and read for every account, the demo included (its places are
  // seeded; decided 2026-10-06). The log action is the one write here, and
  // the demo account is never offered it.
  const isDemo = isDemoUser(user.id);
  const showPlaces = PLACES_ENABLED;
  const canLogPlaces = showPlaces && !isDemo;
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
    tripSpend,
    dashboardPlaces,
    occasions,
  ] = await Promise.all([
    // The story payload rides along because the year recap reads it: the
    // hero image, the photo count, and the journal days all come from it, and
    // the alternative was a second trip query on the same page.
    getProfileTrips(user.id, { story: true }),
    // Places pins are the dashboard's alone: behind the flag, and never for
    // the demo account, whose places were decided against.
    getMapData(user.id, undefined, { places: showPlaces }),
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
    getTripSpendByTrip(),
    showPlaces ? getDashboardPlaces() : Promise.resolve(null),
    showPlaces ? getOccasions().catch(() => null) : Promise.resolve(null),
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
      {/* The bottom padding carries the home indicator's inset: the root
          viewport is viewport-fit=cover, so without it the bucket list's last
          row sits under the bar on a phone (as on the stats and expenses
          pages). */}
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:p-8 sm:pb-[calc(2rem+env(safe-area-inset-bottom))]">
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
            places={dashboardPlaces?.summary ?? null}
          />
        </section>

        {memories ? <OnThisDaySection memories={memories} /> : null}

        <DashboardTrips
          trips={trips}
          spend={Object.fromEntries(tripSpend)}
          secondaryAction={
            // Reuses the one launcher. Its save calls router.refresh(), which
            // re-renders this page, so the tiles and the strip pick up the new
            // place with no extra wiring.
            occasions && canLogPlaces ? (
              <PlaceEntryLauncher
                occasions={occasions}
                variant="outline"
                size="sm"
                label="Log place"
              />
            ) : null
          }
        />

        {dashboardPlaces && occasions ? (
          <RecentPlacesStrip
            places={dashboardPlaces.recent}
            occasions={occasions}
            // The demo session keeps the links (it can open its own places)
            // but has no empty-state log action.
            readOnly={isDemo && dashboardPlaces.recent.length === 0}
          />
        ) : null}

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

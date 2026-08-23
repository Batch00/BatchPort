import { ShareGlobe } from "@/components/share/share-globe";
import { SharedTripCard } from "@/components/share/shared-trip-card";
import { SharedBucketList } from "@/components/share/shared-bucket-list";
import { StatsOverview } from "@/components/stats/stats-overview";
import { DiscoveryProvider } from "@/components/discover/discovery-host";
import { YearRecapLauncher } from "@/components/year/year-recap-launcher";
import { todayIso } from "@/lib/year-recap";
import { placeKey } from "@/lib/geo";
import type { SharedProfile } from "@/lib/share-data";

// The read-only profile shown on both the demo and public share surfaces:
// globe, summary stats, expandable trips, and the bucket list card grid.
// A single read-only discovery host serves the globe, search, and bucket
// cards; no write affordance exists anywhere in this tree.
export function SharedProfileView({ profile }: { profile: SharedProfile }) {
  const {
    stats,
    mapData,
    photoMapData,
    trips,
    bucketItems,
    bucketTripCovers,
    expenses,
  } = profile;

  // NULL means the route did not ask for spending, which is the case on
  // /share/[slug] including when its slug is "demo". This component must not
  // decide: it cannot know which route mounted it, and deriving the answer
  // from the user would be wrong for exactly the demo account. See the gate
  // note on getSharedProfile.
  const spendByTrip = new Map(
    (expenses ?? []).map((entry) => [entry.tripId, entry]),
  );

  const bucketPlaceKeys = mapData.bucketPlaces.map((place) =>
    placeKey(place.name, place.countryCode),
  );

  return (
    <DiscoveryProvider
      readOnly
      bucketCountryCodes={mapData.bucketCountryCodes}
      bucketPlaceKeys={bucketPlaceKeys}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6 sm:p-8">
        <ShareGlobe data={mapData} photoData={photoMapData} />

        {/* Read-only like everything else here: generating a recap or its card
            reads nothing and writes nothing, so the public surfaces get it. */}
        <YearRecapLauncher
          trips={trips}
          bucket={stats.bucket}
          bucketItems={bucketItems}
          today={todayIso()}
        />

        <StatsOverview
          summary={stats.summary}
          distanceKm={stats.distanceKm}
          flagCodes={mapData.visitedCountryCodes}
        />

        <section>
          <h2 className="mb-4 text-sm font-medium text-foreground/80">Trips</h2>
          {trips.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/10 px-6 py-12 text-center text-sm text-foreground/60">
              No trips to show yet.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {trips.map((trip) => (
                <SharedTripCard
                  key={trip.id}
                  trip={trip}
                  spend={spendByTrip.get(trip.id) ?? null}
                />
              ))}
            </div>
          )}
        </section>

        <SharedBucketList
          items={bucketItems}
          tripCovers={bucketTripCovers}
          bucket={stats.bucket}
        />
      </div>
    </DiscoveryProvider>
  );
}

import { ShareGlobe } from "@/components/share/share-globe";
import { SharedTripCard } from "@/components/share/shared-trip-card";
import { StatsGrid } from "@/components/stats/stats-grid";
import { BucketProgress } from "@/components/stats/bucket-progress";
import type { SharedProfile } from "@/lib/share-data";

// The read-only profile shown on both the demo and public share surfaces:
// globe, summary stats, expandable trips, and bucket progress. No interactive
// or write affordances.
export function SharedProfileView({ profile }: { profile: SharedProfile }) {
  const { stats, mapData, trips } = profile;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6 sm:p-8">
      <ShareGlobe data={mapData} />

      <StatsGrid summary={stats.summary} distanceKm={stats.distanceKm} />

      <section>
        <h2 className="mb-4 text-sm font-medium text-foreground/80">Trips</h2>
        {trips.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 px-6 py-12 text-center text-sm text-foreground/60">
            No trips to show yet.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {trips.map((trip) => (
              <SharedTripCard key={trip.id} trip={trip} />
            ))}
          </div>
        )}
      </section>

      {stats.bucket ? <BucketProgress bucket={stats.bucket} /> : null}
    </div>
  );
}

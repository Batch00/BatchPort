import Link from "next/link";
import { PlusIcon } from "lucide-react";

import { getTrips } from "@/lib/trips";
import { getMapData } from "@/lib/map-data";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/trips/status-badge";
import { DashboardGlobe } from "@/components/map/dashboard-globe";
import { formatDateRange } from "@/lib/format";
import { cn } from "@/lib/utils";

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export default async function DashboardPage() {
  const [trips, mapData] = await Promise.all([getTrips(), getMapData()]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6 sm:p-8">
      <DashboardGlobe data={mapData} />

      <section>
        <header className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">Trips</h1>
          <Link
            href="/trips/new"
            className={cn(
              buttonVariants({ size: "lg" }),
              "bg-brand text-brand-foreground hover:bg-brand/90",
            )}
          >
            <PlusIcon />
            Add trip
          </Link>
        </header>

        {trips.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 px-6 py-12 text-center text-sm text-foreground/60">
            Your trips will appear here.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {trips.map((trip) => (
              <Link key={trip.id} href={`/trips/${trip.id}`} className="group">
                <Card className="h-full transition-all group-hover:ring-brand/40">
                  <CardContent className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="font-medium text-foreground">{trip.name}</h2>
                      <StatusBadge status={trip.status} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {formatDateRange(trip.start_date, trip.end_date)}
                    </p>
                    <div className="mt-1 flex items-center gap-4 text-xs text-foreground/60">
                      <span>
                        {countLabel(trip.destination_count, "stop", "stops")}
                      </span>
                      <span>
                        {countLabel(trip.country_count, "country", "countries")}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

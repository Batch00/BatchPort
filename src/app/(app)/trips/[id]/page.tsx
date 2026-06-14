import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, PencilIcon, PlusIcon } from "lucide-react";

import { getTrip } from "@/lib/trips";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/trips/status-badge";
import { DeleteTripButton } from "@/components/trips/delete-trip-button";
import { flagEmoji, formatDateRange } from "@/lib/format";
import { cn } from "@/lib/utils";

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const trip = await getTrip(id);
  if (!trip) {
    notFound();
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-6 sm:p-8">
      <Link
        href="/dashboard"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-foreground/60 transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Back to trips
      </Link>

      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{trip.name}</h1>
            <StatusBadge status={trip.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {formatDateRange(trip.start_date, trip.end_date)}
          </p>
          {trip.notes ? (
            <p className="max-w-prose text-sm text-foreground/70">{trip.notes}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/trips/${trip.id}/edit`}
            className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
          >
            <PencilIcon />
            Edit
          </Link>
          <DeleteTripButton tripId={trip.id} tripName={trip.name} />
        </div>
      </header>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground/80">Destinations</h2>
        <Link
          href={`/trips/${trip.id}/destinations/new`}
          className={cn(
            buttonVariants({ size: "sm" }),
            "bg-brand text-brand-foreground hover:bg-brand/90",
          )}
        >
          <PlusIcon />
          Add destination
        </Link>
      </div>

      {trip.destinations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 px-6 py-12 text-center text-sm text-foreground/60">
          No destinations yet. Add your first stop on this trip.
        </div>
      ) : (
        <ol className="flex flex-col gap-3">
          {trip.destinations.map((destination, index) => {
            const experienceCount = destination.experiences.length;
            return (
              <li key={destination.id}>
                <Link
                  href={`/trips/${trip.id}/destinations/${destination.id}`}
                  className="group block"
                >
                  <Card className="transition-all group-hover:ring-brand/40">
                    <CardContent className="flex items-center gap-4">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/5 text-xs text-foreground/50">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="flex items-center gap-2 font-medium text-foreground">
                          <span>{destination.name}</span>
                          {destination.country_code ? (
                            <span className="text-sm text-foreground/50">
                              {flagEmoji(destination.country_code)}{" "}
                              {destination.country_code}
                            </span>
                          ) : null}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {formatDateRange(
                            destination.arrival_date,
                            destination.departure_date,
                          )}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-foreground/50">
                        {experienceCount}{" "}
                        {experienceCount === 1 ? "experience" : "experiences"}
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

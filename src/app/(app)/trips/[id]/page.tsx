import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, ImageIcon, PencilIcon, PlusIcon } from "lucide-react";

import { getTrip } from "@/lib/trips";
import { getPhotos, getPhotosForOwners, pickCover } from "@/lib/photos-data";
import { getPhotoUrl } from "@/lib/photos";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/trips/status-badge";
import { DeleteTripButton } from "@/components/trips/delete-trip-button";
import { PhotoBanner } from "@/components/photos/photo-banner";
import { TripPhotos } from "@/components/photos/trip-photos";
import { flagEmoji, formatDateRange } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Photo } from "@/lib/types";

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

  const destIds = trip.destinations.map((destination) => destination.id);
  const [tripPhotos, destPhotos] = await Promise.all([
    getPhotos("trip", id),
    getPhotosForOwners("destination", destIds),
  ]);

  // Group each destination's photos so we can resolve per-card covers.
  const photosByDestination = new Map<string, Photo[]>();
  for (const photo of destPhotos) {
    const list = photosByDestination.get(photo.owner_id) ?? [];
    list.push(photo);
    photosByDestination.set(photo.owner_id, list);
  }
  const destinationCovers = new Map<string, Photo | null>();
  for (const destination of trip.destinations) {
    destinationCovers.set(
      destination.id,
      pickCover(
        photosByDestination.get(destination.id) ?? [],
        destination.cover_photo_id,
      ),
    );
  }

  // Banner: trip cover, falling back to the first destination cover available.
  const firstDestinationCover = trip.destinations
    .map((destination) => destinationCovers.get(destination.id))
    .find((cover): cover is Photo => Boolean(cover));
  const bannerPhoto =
    pickCover(tripPhotos, trip.cover_photo_id) ?? firstDestinationCover ?? null;

  return (
    <div className="mx-auto w-full max-w-3xl p-6 sm:p-8">
      <Link
        href="/dashboard"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-foreground/60 transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Back to trips
      </Link>

      <PhotoBanner photo={bannerPhoto} className="mb-8 min-h-52 sm:min-h-64">
        <div className="absolute right-4 top-4 flex items-center gap-2">
          <Link
            href={`/trips/${trip.id}/edit`}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "border-white/20 bg-black/40 text-white backdrop-blur hover:bg-black/60 hover:text-white",
            )}
          >
            <PencilIcon />
            Edit
          </Link>
          <DeleteTripButton tripId={trip.id} tripName={trip.name} />
        </div>

        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            {trip.name}
          </h1>
          <StatusBadge status={trip.status} />
        </div>
        <p className="mt-1 text-sm text-white/70">
          {formatDateRange(trip.start_date, trip.end_date)}
        </p>
      </PhotoBanner>

      {trip.notes ? (
        <p className="mb-8 max-w-prose text-sm text-foreground/70">
          {trip.notes}
        </p>
      ) : null}

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
            const cover = destinationCovers.get(destination.id) ?? null;
            return (
              <li key={destination.id}>
                <Link
                  href={`/trips/${trip.id}/destinations/${destination.id}`}
                  className="group block"
                >
                  <Card className="transition-all group-hover:ring-brand/40">
                    <CardContent className="flex items-center gap-4 pl-0">
                      <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-white/5">
                        {cover ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={getPhotoUrl(cover)}
                            alt=""
                            className="size-full object-cover"
                          />
                        ) : (
                          <div className="flex size-full items-center justify-center text-foreground/25">
                            <ImageIcon className="size-5" />
                          </div>
                        )}
                        <span className="absolute left-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-black/60 text-[0.65rem] text-white">
                          {index + 1}
                        </span>
                      </div>
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
                      <span className="shrink-0 pr-4 text-xs text-foreground/50">
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

      {destPhotos.length > 0 ? (
        <TripPhotos
          tripId={trip.id}
          coverPhotoId={trip.cover_photo_id}
          photos={destPhotos}
        />
      ) : null}
    </div>
  );
}

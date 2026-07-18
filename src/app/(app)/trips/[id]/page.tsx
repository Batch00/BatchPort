import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, ImageIcon, PencilIcon, PlusIcon } from "lucide-react";

import { getTrip } from "@/lib/trips";
import { getPhotos, getPhotosForOwners } from "@/lib/photos-data";
import { requireUser } from "@/lib/current-user";
import { isDemoUser } from "@/lib/demo";
import { coverImageStyle, getPhotoUrl, resolveCoverPhoto } from "@/lib/photos";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/trips/status-badge";
import { DeleteTripButton } from "@/components/trips/delete-trip-button";
import { PhotoBanner } from "@/components/photos/photo-banner";
import { TripPhotosSection } from "@/components/photos/trip-photos";
import { CountryFlag } from "@/components/country-flag";
import {
  durationDays,
  formatDateRange,
  formatDuration,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Photo } from "@/lib/types";

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // The trip-level photo list only depends on the URL id, so it joins the
  // first batch; only the destination and experience photo queries need the
  // ids that come back with the trip.
  const [{ user }, trip, tripPhotos] = await Promise.all([
    requireUser(),
    getTrip(id),
    getPhotos("trip", id),
  ]);
  if (!trip) {
    notFound();
  }

  const destIds = trip.destinations.map((destination) => destination.id);
  const experienceIds = trip.destinations.flatMap((destination) =>
    destination.experiences.map((experience) => experience.id),
  );
  const [destPhotos, expPhotos] = await Promise.all([
    getPhotosForOwners("destination", destIds),
    getPhotosForOwners("experience", experienceIds),
  ]);

  // Group each destination's photos so we can resolve per-card covers.
  const photosByDestination = new Map<string, Photo[]>();
  for (const photo of destPhotos) {
    const list = photosByDestination.get(photo.owner_id) ?? [];
    list.push(photo);
    photosByDestination.set(photo.owner_id, list);
  }

  // Covers resolve BY ID across every photo on the trip: a trip cover chosen
  // from the trip gallery can be destination- or experience-owned, and a
  // destination cover can be experience-owned. Resolving only against the
  // entity's own photos (the old pickCover call) silently showed a different
  // photo than the dashboard, which resolves by id.
  const photoById = new Map<string, Photo>(
    [...tripPhotos, ...destPhotos, ...expPhotos].map((photo) => [
      photo.id,
      photo,
    ]),
  );
  const destinationCovers = new Map<
    string,
    { photo: Photo; explicit: boolean }
  >();
  for (const destination of trip.destinations) {
    const resolved = resolveCoverPhoto(
      photoById,
      photosByDestination.get(destination.id) ?? [],
      destination.cover_photo_id,
    );
    if (resolved) destinationCovers.set(destination.id, resolved);
  }

  // Banner photo, in the same order the dashboard cards use: the explicit
  // trip cover, then the first destination's cover, then the first
  // trip-level photo.
  const tripCover = resolveCoverPhoto(photoById, [], trip.cover_photo_id);
  const firstDestinationCover =
    trip.destinations
      .map((destination) => destinationCovers.get(destination.id))
      .find((cover) => Boolean(cover))?.photo ?? null;
  const bannerPhoto =
    tripCover?.photo ?? firstDestinationCover ?? tripPhotos[0] ?? null;
  // The stored position describes the explicit cover only.
  const bannerPosition = tripCover?.explicit
    ? (trip.cover_position ?? null)
    : null;

  return (
    <div className="mx-auto w-full max-w-3xl p-6 sm:p-8">
      <Link
        href="/dashboard"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-foreground/60 transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Back to trips
      </Link>

      <PhotoBanner photo={bannerPhoto} coverPosition={bannerPosition} className="mb-8">
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

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight text-white">
            {trip.name}
          </h1>
          <StatusBadge status={trip.status} />
        </div>
        <p className="mt-1 text-sm text-white/70">
          {formatDateRange(trip.start_date, trip.end_date)}
          {(() => {
            const days = durationDays(trip.start_date, trip.end_date);
            return days ? (
              <span className="text-white/50"> · {formatDuration(days)}</span>
            ) : null;
          })()}
        </p>
      </PhotoBanner>

      {trip.notes ? (
        <p className="mb-8 max-w-prose whitespace-pre-line text-sm text-foreground/70">
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
            // The crop position belongs to the explicitly set cover only.
            const coverStyle = cover?.explicit
              ? coverImageStyle(destination.cover_position)
              : undefined;
            return (
              <li key={destination.id}>
                <Link
                  href={`/trips/${trip.id}/destinations/${destination.id}`}
                  className="group block"
                >
                  <Card className="transition-all group-hover:ring-brand/40">
                    <CardContent className="flex items-center gap-4 pl-0">
                      <div className="relative isolate h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-white/5">
                        {cover ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={getPhotoUrl(cover.photo, "thumb")}
                            alt=""
                            loading="lazy"
                            style={coverStyle}
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
                              <CountryFlag
                                code={destination.country_code}
                              />{" "}
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
                      <span className="flex shrink-0 flex-col items-end gap-0.5 pr-4 text-xs text-foreground/50">
                        <span>
                          {experienceCount}{" "}
                          {experienceCount === 1 ? "experience" : "experiences"}
                        </span>
                        {(() => {
                          const photoCount =
                            photosByDestination.get(destination.id)?.length ??
                            0;
                          return photoCount > 0 ? (
                            <span className="text-foreground/40">
                              {photoCount}{" "}
                              {photoCount === 1 ? "photo" : "photos"}
                            </span>
                          ) : null;
                        })()}
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ol>
      )}

      <TripPhotosSection
        tripId={trip.id}
        userId={user.id}
        isDemo={isDemoUser(user.id)}
        coverPhotoId={trip.cover_photo_id}
        coverPosition={trip.cover_position ?? null}
        destinations={trip.destinations.map((destination) => ({
          id: destination.id,
          name: destination.name,
          lat: destination.latitude,
          lng: destination.longitude,
          experiences: destination.experiences.map((experience) => ({
            id: experience.id,
            name: experience.name,
          })),
        }))}
        untaggedPhotos={tripPhotos}
        taggedPhotos={[...destPhotos, ...expPhotos]}
      />
    </div>
  );
}

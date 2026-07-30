import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, PencilIcon } from "lucide-react";

import { getDestination } from "@/lib/destinations";
import { getTripStatus } from "@/lib/trips";
import { getCategories } from "@/lib/experiences";
import { getPhotos, getPhotosForOwners } from "@/lib/photos-data";
import { resolveCoverPhoto } from "@/lib/photos";
import { requireUser } from "@/lib/current-user";
import { isDemoUser } from "@/lib/demo";
import { distanceFromHome, getHomeLocation } from "@/lib/home-location";
import { formatKm } from "@/lib/stats-format";
import { buttonVariants } from "@/components/ui/button";
import { DeleteDestinationButton } from "@/components/destinations/delete-destination-button";
import { ExperiencesSection } from "@/components/experiences/experiences-section";
import { DestinationPhotos } from "@/components/photos/destination-photos";
import { PhotoBanner } from "@/components/photos/photo-banner";
import { CountryFlag } from "@/components/country-flag";
import {
  durationDays,
  formatDateRange,
  formatDuration,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Photo } from "@/lib/types";

export default async function DestinationDetailPage({
  params,
}: {
  params: Promise<{ id: string; destId: string }>;
}) {
  const { id, destId } = await params;
  // Everything that does not depend on the destination row runs in one
  // parallel batch; only the experience photos (which need the experience ids)
  // wait for the destination.
  const [{ user }, destination, categories, photos, tripStatus] =
    await Promise.all([
      requireUser(),
      getDestination(destId),
      getCategories(),
      getPhotos("destination", destId),
      getTripStatus(id),
    ]);

  if (!destination || destination.trip_id !== id) {
    notFound();
  }

  const experienceIds = destination.experiences.map((experience) => experience.id);
  const [experiencePhotos, home] = await Promise.all([
    getPhotosForOwners("experience", experienceIds),
    getHomeLocation(user.id),
  ]);
  // Null whenever no home is set or the stop has no coordinates; the line is
  // then simply absent.
  const homeDistanceKm = distanceFromHome(
    home,
    destination.latitude,
    destination.longitude,
  );
  // The explicit cover can be an experience-owned photo, so it resolves by id
  // across every photo on the page; the crop position applies only to it.
  const photoById = new Map(
    [...photos, ...experiencePhotos].map((photo) => [photo.id, photo]),
  );
  const coverResolved = resolveCoverPhoto(
    photoById,
    photos,
    destination.cover_photo_id,
  );
  const cover = coverResolved?.photo ?? null;
  const coverPosition = coverResolved?.explicit
    ? (destination.cover_position ?? null)
    : null;
  const isDemo = isDemoUser(user.id);

  // Group experience photos by their owning experience for inline display.
  const photosByExperience: Record<string, Photo[]> = {};
  for (const photo of experiencePhotos) {
    (photosByExperience[photo.owner_id] ??= []).push(photo);
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-6 sm:p-8">
      <Link
        href={`/trips/${id}`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-foreground/60 transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Back to trip
      </Link>

      <PhotoBanner photo={cover} coverPosition={coverPosition} className="mb-8">
        <div className="absolute right-4 top-4 flex items-center gap-2">
          <Link
            href={`/trips/${id}/destinations/${destId}/edit`}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "border-white/20 bg-black/40 text-white backdrop-blur hover:bg-black/60 hover:text-white",
            )}
          >
            <PencilIcon />
            Edit
          </Link>
          <DeleteDestinationButton
            tripId={id}
            destinationId={destId}
            destinationName={destination.name}
          />
        </div>

        <h1 className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xl font-semibold tracking-tight text-white">
          <span className="min-w-0 break-words">{destination.name}</span>
          {destination.country_code ? (
            <span className="text-base font-normal text-white/70">
              <CountryFlag code={destination.country_code} className="h-4" />{" "}
              {destination.admin_region ?? destination.country_code}
            </span>
          ) : null}
        </h1>
        <p className="mt-1 text-sm text-white/70">
          {formatDateRange(destination.arrival_date, destination.departure_date)}
          {(() => {
            const days = durationDays(
              destination.arrival_date,
              destination.departure_date,
            );
            return days ? (
              <span className="text-white/50"> · {formatDuration(days)}</span>
            ) : null;
          })()}
          {homeDistanceKm !== null ? (
            <span className="text-white/50">
              {" "}
              · {formatKm(homeDistanceKm)} from home
            </span>
          ) : null}
        </p>
      </PhotoBanner>

      {destination.notes ? (
        <p className="mb-8 max-w-prose whitespace-pre-line text-sm text-foreground/70">
          {destination.notes}
        </p>
      ) : null}

      <ExperiencesSection
        tripId={id}
        tripStatus={tripStatus ?? "completed"}
        destinationId={destId}
        experiences={destination.experiences}
        categories={categories}
        userId={user.id}
        isDemo={isDemo}
        photosByExperience={photosByExperience}
        destLat={destination.latitude}
        destLng={destination.longitude}
      />

      <DestinationPhotos
        tripId={id}
        destination={{
          id: destination.id,
          name: destination.name,
          lat: destination.latitude,
          lng: destination.longitude,
          experiences: destination.experiences.map((experience) => ({
            id: experience.id,
            name: experience.name,
          })),
        }}
        userId={user.id}
        isDemo={isDemo}
        photos={photos}
        experiencePhotos={experiencePhotos}
        coverPhotoId={destination.cover_photo_id}
        coverPosition={destination.cover_position ?? null}
      />
    </div>
  );
}

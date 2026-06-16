import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, PencilIcon } from "lucide-react";

import { getDestination } from "@/lib/destinations";
import { getCategories } from "@/lib/experiences";
import { getPhotos, pickCover } from "@/lib/photos-data";
import { requireUser } from "@/lib/current-user";
import { isDemoUser } from "@/lib/demo";
import { buttonVariants } from "@/components/ui/button";
import { DeleteDestinationButton } from "@/components/destinations/delete-destination-button";
import { ExperiencesSection } from "@/components/experiences/experiences-section";
import { DestinationPhotos } from "@/components/photos/destination-photos";
import { PhotoBanner } from "@/components/photos/photo-banner";
import { flagEmoji, formatDateRange } from "@/lib/format";
import { cn } from "@/lib/utils";

export default async function DestinationDetailPage({
  params,
}: {
  params: Promise<{ id: string; destId: string }>;
}) {
  const { id, destId } = await params;
  const [{ user }, destination, categories] = await Promise.all([
    requireUser(),
    getDestination(destId),
    getCategories(),
  ]);

  if (!destination || destination.trip_id !== id) {
    notFound();
  }

  const photos = await getPhotos("destination", destId);
  const cover = pickCover(photos, destination.cover_photo_id);
  const isDemo = isDemoUser(user.id);

  return (
    <div className="mx-auto w-full max-w-3xl p-6 sm:p-8">
      <Link
        href={`/trips/${id}`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-foreground/60 transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Back to trip
      </Link>

      <PhotoBanner photo={cover} className="mb-8 min-h-52 sm:min-h-64">
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

        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-white">
          {destination.name}
          {destination.country_code ? (
            <span className="text-base font-normal text-white/70">
              {flagEmoji(destination.country_code)} {destination.country_code}
            </span>
          ) : null}
        </h1>
        <p className="mt-1 text-sm text-white/70">
          {formatDateRange(destination.arrival_date, destination.departure_date)}
        </p>
      </PhotoBanner>

      {destination.notes ? (
        <p className="mb-8 max-w-prose text-sm text-foreground/70">
          {destination.notes}
        </p>
      ) : null}

      <ExperiencesSection
        tripId={id}
        destinationId={destId}
        experiences={destination.experiences}
        categories={categories}
      />

      <DestinationPhotos
        destinationId={destId}
        userId={user.id}
        isDemo={isDemo}
        photos={photos}
        coverPhotoId={destination.cover_photo_id}
      />
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { getTrip } from "@/lib/trips";
import {
  getPhotos,
  getPhotosByIds,
  getPhotosForOwners,
} from "@/lib/photos-data";
import { requireUser } from "@/lib/current-user";
import { isDemoUser } from "@/lib/demo";
import { TripForm } from "@/components/trips/trip-form";

export default async function EditTripPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [{ user }, trip] = await Promise.all([requireUser(), getTrip(id)]);
  if (!trip) {
    notFound();
  }

  // The cover can be any photo attached to the trip at any level (trip,
  // destination, or experience), so the picker gallery aggregates all three.
  const destIds = trip.destinations.map((destination) => destination.id);
  const expIds = trip.destinations.flatMap((destination) =>
    destination.experiences.map((experience) => experience.id),
  );
  const [tripPhotos, destPhotos, expPhotos] = await Promise.all([
    getPhotos("trip", trip.id),
    getPhotosForOwners("destination", destIds),
    getPhotosForOwners("experience", expIds),
  ]);
  let coverPhotos = [...tripPhotos, ...destPhotos, ...expPhotos];
  // Covers set before this aggregation existed could in theory point at a
  // photo outside the set; fetch it by id so the current cover always shows.
  if (
    trip.cover_photo_id &&
    !coverPhotos.some((photo) => photo.id === trip.cover_photo_id)
  ) {
    const [coverPhoto] = await getPhotosByIds([trip.cover_photo_id]);
    if (coverPhoto) coverPhotos = [coverPhoto, ...coverPhotos];
  }

  return (
    <div className="mx-auto w-full max-w-xl p-6 sm:p-8">
      <Link
        href={`/trips/${trip.id}`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-foreground/60 transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Back to trip
      </Link>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Edit trip</h1>
      <TripForm
        mode="edit"
        tripId={trip.id}
        userId={user.id}
        isDemo={isDemoUser(user.id)}
        defaultValues={{
          name: trip.name,
          start_date: trip.start_date ?? "",
          end_date: trip.end_date ?? "",
          status: trip.status,
          notes: trip.notes ?? "",
        }}
        coverPhotos={coverPhotos}
        coverPhotoId={trip.cover_photo_id}
        coverPosition={trip.cover_position}
      />
    </div>
  );
}

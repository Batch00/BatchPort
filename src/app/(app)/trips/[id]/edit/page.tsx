import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { getTrip } from "@/lib/trips";
import { getPhotos } from "@/lib/photos-data";
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

  const coverPhotos = await getPhotos("trip", trip.id);

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
      />
    </div>
  );
}

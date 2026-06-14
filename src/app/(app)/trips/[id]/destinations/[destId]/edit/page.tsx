import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { getDestination } from "@/lib/destinations";
import { DestinationForm } from "@/components/destinations/destination-form";
import type { GeoLocation } from "@/lib/types";

export default async function EditDestinationPage({
  params,
}: {
  params: Promise<{ id: string; destId: string }>;
}) {
  const { id, destId } = await params;
  const destination = await getDestination(destId);
  if (!destination || destination.trip_id !== id) {
    notFound();
  }

  const location: GeoLocation = {
    name: destination.name,
    country: null,
    country_code: destination.country_code,
    admin_region: destination.admin_region,
    lat: destination.latitude ?? 0,
    lng: destination.longitude ?? 0,
  };

  return (
    <div className="mx-auto w-full max-w-xl p-6 sm:p-8">
      <Link
        href={`/trips/${id}/destinations/${destId}`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-foreground/60 transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Back to destination
      </Link>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">
        Edit destination
      </h1>
      <DestinationForm
        mode="edit"
        tripId={id}
        destinationId={destId}
        defaultLocation={location}
        defaultLocationQuery={destination.name}
        defaultArrival={destination.arrival_date ?? ""}
        defaultDeparture={destination.departure_date ?? ""}
        defaultNotes={destination.notes ?? ""}
      />
    </div>
  );
}

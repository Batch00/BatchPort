import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, PencilIcon } from "lucide-react";

import { getDestination } from "@/lib/destinations";
import { getCategories } from "@/lib/experiences";
import { buttonVariants } from "@/components/ui/button";
import { DeleteDestinationButton } from "@/components/destinations/delete-destination-button";
import { ExperiencesSection } from "@/components/experiences/experiences-section";
import { flagEmoji, formatDateRange } from "@/lib/format";
import { cn } from "@/lib/utils";

export default async function DestinationDetailPage({
  params,
}: {
  params: Promise<{ id: string; destId: string }>;
}) {
  const { id, destId } = await params;
  const [destination, categories] = await Promise.all([
    getDestination(destId),
    getCategories(),
  ]);

  if (!destination || destination.trip_id !== id) {
    notFound();
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

      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {destination.name}
            {destination.country_code ? (
              <span className="text-base font-normal text-foreground/50">
                {flagEmoji(destination.country_code)} {destination.country_code}
              </span>
            ) : null}
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatDateRange(
              destination.arrival_date,
              destination.departure_date,
            )}
          </p>
          {destination.notes ? (
            <p className="max-w-prose text-sm text-foreground/70">
              {destination.notes}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/trips/${id}/destinations/${destId}/edit`}
            className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
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
      </header>

      <ExperiencesSection
        tripId={id}
        destinationId={destId}
        experiences={destination.experiences}
        categories={categories}
      />
    </div>
  );
}

import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { DestinationForm } from "@/components/destinations/destination-form";

export default async function NewDestinationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="mx-auto w-full max-w-xl p-6 sm:p-8">
      <Link
        href={`/trips/${id}`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-foreground/60 transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Back to trip
      </Link>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">
        Add destination
      </h1>
      <DestinationForm mode="create" tripId={id} />
    </div>
  );
}

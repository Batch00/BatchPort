import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { TripForm } from "@/components/trips/trip-form";

export default function NewTripPage() {
  return (
    <div className="mx-auto w-full max-w-xl p-6 sm:p-8">
      <Link
        href="/dashboard"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-foreground/60 transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Back to trips
      </Link>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">New trip</h1>
      <TripForm mode="create" />
    </div>
  );
}

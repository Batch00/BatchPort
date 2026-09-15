import { notFound } from "next/navigation";

import { PlaceEntryLauncher } from "@/components/places/place-entry-launcher";
import { PlacesList } from "@/components/places/places-list";
import { PLACES_ENABLED } from "@/lib/features";
import { getOccasions, getPlacesList } from "@/lib/places";

// The places list. Server component: one v_places read and one occasions read,
// handed to a client component that does the filtering and sorting in memory.
//
// notFound() rather than a redirect when the flag is off, so an unflagged
// deployment behaves as though the route does not exist, which is what "nothing
// about the app changes" means.

export default async function PlacesPage() {
  if (!PLACES_ENABLED) notFound();

  const [places, occasions] = await Promise.all([getPlacesList(), getOccasions()]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Places</h1>
          <p className="text-sm text-muted-foreground">
            Somewhere you stayed overnight or spent a real day.
          </p>
        </div>
        <PlaceEntryLauncher occasions={occasions} />
      </div>

      <PlacesList places={places} occasions={occasions} />
    </div>
  );
}

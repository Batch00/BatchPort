import { notFound } from "next/navigation";

import { PlaceEntryLauncher } from "@/components/places/place-entry-launcher";
import { PLACES_ENABLED } from "@/lib/features";
import { getOccasions } from "@/lib/places";

// STAGE 3 HARNESS. This is deliberately not the /places route yet: the grouped
// list, the filters, the sort, and the detail view are stage 4. It exists so
// the entry sheet can be opened and reviewed on a real device rather than only
// read as a diff.
//
// notFound() rather than a redirect when the flag is off, so an unflagged
// deployment behaves as though the route does not exist, which is what "nothing
// about the app changes" means.

export default async function PlacesPage() {
  if (!PLACES_ENABLED) notFound();

  const occasions = await getOccasions();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Places</h1>
          <p className="text-sm text-muted-foreground">
            Somewhere you stayed overnight or spent a real day.
          </p>
        </div>
        <PlaceEntryLauncher occasions={occasions} />
      </div>

      <p className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted-foreground">
        The grouped list lands in stage 4.
      </p>
    </div>
  );
}

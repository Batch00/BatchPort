import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";

import { PlaceEntryLauncher } from "@/components/places/place-entry-launcher";
import { PlaceTypeIcon } from "@/components/places/place-type-icon";
import { formatDate } from "@/lib/format";
import type { RecentPlace } from "@/lib/places-dashboard-data";
import type { Occasion } from "@/lib/types";

// The dashboard's recent places: the last few places by their most recent
// visit TO DATE (lib/places-dashboard-data.ts), each linking to its page.
//
// Phone first. On a phone the strip is a single horizontal row that scrolls
// and snaps, bled to the screen edges so the next item peeks in and says
// "there is more this way"; six stacked rows would push the bucket list a
// screen further down for a section that is meant to be a glance. From sm up
// it is a grid that shows all six at once.
//
// With nothing logged, the strip is one line and the action that fills it.
// There is no empty grid of placeholders.
//
// READ-ONLY is /demo: the same cards with no way in. Items are not links and
// there is no "See all", because /places and /places/[id] are behind auth,
// and there is no empty state, because its only content is the log action.
// The caller does not mount a read-only strip with nothing in it.

const CARD_CLASS =
  "flex h-full flex-col gap-1.5 rounded-xl bg-card p-3 ring-1 ring-foreground/10";

export function RecentPlacesStrip({
  places,
  occasions = [],
  readOnly = false,
}: {
  places: RecentPlace[];
  /** For the empty state's log action; unused when read-only. */
  occasions?: Occasion[];
  readOnly?: boolean;
}) {
  if (readOnly && places.length === 0) return null;

  return (
    <section aria-labelledby="recent-places">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="recent-places" className="text-sm font-medium text-foreground/80">
          Recent places
        </h2>
        {places.length > 0 && !readOnly ? (
          <Link
            href="/places"
            className="inline-flex items-center gap-1 text-sm text-brand underline-offset-4 transition-colors hover:underline"
          >
            See all
            <ArrowRightIcon className="size-3.5" />
          </Link>
        ) : null}
      </div>

      {places.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-dashed border-white/10 px-4 py-3">
          <p className="text-sm text-foreground/60">
            No places yet. A game, a park, a weekend somewhere: log the first one.
          </p>
          <PlaceEntryLauncher
            occasions={occasions}
            variant="ghost"
            size="sm"
            label="Log a place"
            className="text-brand hover:text-brand"
          />
        </div>
      ) : (
        <ul className="-mx-6 flex snap-x snap-mandatory gap-3 overflow-x-auto px-6 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:snap-none sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-6 [&::-webkit-scrollbar]:hidden">
          {places.map((place) => {
            const body = (
              <>
                <PlaceTypeIcon type={place.placeType} className="size-4 text-brand" />
                <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
                  {place.name}
                </span>
                <span className="mt-auto text-xs text-foreground/50 tabular-nums">
                  {formatDate(place.visitDate)}
                </span>
                {place.occasion ? (
                  <span className="truncate text-xs text-foreground/50">
                    {place.occasion}
                  </span>
                ) : null}
              </>
            );
            return (
              <li
                key={place.id}
                className="w-40 shrink-0 snap-start sm:w-auto sm:min-w-0"
              >
                {readOnly ? (
                  <div className={CARD_CLASS}>{body}</div>
                ) : (
                  <Link
                    href={`/places/${place.id}`}
                    className={`${CARD_CLASS} transition-colors hover:bg-white/[0.04] hover:ring-brand/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60`}
                  >
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

"use client";

import Link from "next/link";
import { CompassIcon, MapPinIcon, XIcon } from "lucide-react";

import type { GlobeCountrySelection } from "./globe";
import type { MapDestination } from "@/lib/map-data";
import { flagEmoji, formatDateRange } from "@/lib/format";

// The visited-country drill-down panel shared by the dashboard and the public
// share/demo globes: destinations grouped by trip, plus the Explore button
// that hands the country to the discovery panel. Only the dashboard links
// destinations into the app; public surfaces render plain rows.

export interface TripGroup {
  tripId: string;
  tripName: string;
  destinations: MapDestination[];
}

// Group the selected country's destinations by trip, preserving the order they
// arrive in (already sorted by trip start date, then visit order).
export function groupByTrip(destinations: MapDestination[]): TripGroup[] {
  const groups = new Map<string, TripGroup>();
  for (const destination of destinations) {
    const existing = groups.get(destination.tripId);
    if (existing) {
      existing.destinations.push(destination);
    } else {
      groups.set(destination.tripId, {
        tripId: destination.tripId,
        tripName: destination.tripName,
        destinations: [destination],
      });
    }
  }
  return Array.from(groups.values());
}

function DestinationRow({ destination }: { destination: MapDestination }) {
  const dates = formatDateRange(
    destination.arrivalDate,
    destination.departureDate,
  );
  return (
    <>
      <MapPinIcon className="mt-0.5 size-3.5 shrink-0 text-brand" />
      <span className="min-w-0">
        <span className="block truncate text-sm text-foreground/90 group-hover:text-foreground">
          {destination.name}
        </span>
        {dates ? (
          <span className="block truncate text-xs text-foreground/45">
            {dates}
          </span>
        ) : null}
      </span>
    </>
  );
}

interface CountryDrilldownProps {
  selection: GlobeCountrySelection;
  groups: TripGroup[];
  /** Link each destination into the authenticated app. Off on public surfaces. */
  linkDestinations: boolean;
  onClose: () => void;
  /** Opens the discovery panel for this country. */
  onExplore: () => void;
}

export function CountryDrilldown({
  selection,
  groups,
  linkDestinations,
  onClose,
  onExplore,
}: CountryDrilldownProps) {
  const total = groups.reduce(
    (sum, group) => sum + group.destinations.length,
    0,
  );

  return (
    <div className="absolute inset-y-0 right-0 z-30 flex w-80 max-w-[85%] flex-col border-l border-white/10 bg-black/85 shadow-2xl backdrop-blur-md">
      <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 truncate text-base font-semibold tracking-tight">
            <span>{flagEmoji(selection.code)}</span>
            <span className="truncate">{selection.name}</span>
          </h2>
          <p className="mt-0.5 text-xs text-foreground/50">
            {total} {total === 1 ? "destination" : "destinations"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-m-2 rounded-md p-2.5 text-foreground/60 transition-colors hover:bg-white/5 hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {groups.length === 0 ? (
          <p className="text-sm text-foreground/50">
            No destinations in this country.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map((group) => (
              <div key={group.tripId} className="flex flex-col gap-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-foreground/45">
                  {group.tripName}
                </h3>
                <ul className="flex flex-col gap-1">
                  {group.destinations.map((destination) => (
                    <li key={destination.id}>
                      {linkDestinations ? (
                        <Link
                          href={`/trips/${destination.tripId}/destinations/${destination.id}`}
                          className="group flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/5"
                        >
                          <DestinationRow destination={destination} />
                        </Link>
                      ) : (
                        <div className="group flex items-start gap-2 rounded-lg px-2 py-1.5">
                          <DestinationRow destination={destination} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Switch to the discovery view for this country. */}
      <div className="border-t border-white/10 px-4 py-3">
        <button
          type="button"
          onClick={onExplore}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-brand/30 bg-brand/15 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-brand/25"
        >
          <CompassIcon className="size-4 text-brand" />
          Explore {selection.name}
        </button>
      </div>
    </div>
  );
}

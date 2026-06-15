"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { XIcon, MapPinIcon, PlusIcon } from "lucide-react";

import {
  Globe,
  type GlobeDestination,
  type GlobeCountrySelection,
} from "./globe";
import type { MapData, MapDestination } from "@/lib/map-data";
import { flagEmoji, formatDateRange } from "@/lib/format";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DashboardGlobeProps {
  data: MapData;
}

interface TripGroup {
  tripId: string;
  tripName: string;
  destinations: MapDestination[];
}

// Group the selected country's destinations by trip, preserving the order they
// arrive in (already sorted by trip start date, then visit order).
function groupByTrip(destinations: MapDestination[]): TripGroup[] {
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

export function DashboardGlobe({ data }: DashboardGlobeProps) {
  const { destinations, visitedCountryCodes, arcs, stats } = data;
  const [selected, setSelected] = useState<GlobeCountrySelection | null>(null);

  const isEmpty = destinations.length === 0;

  const globeDestinations = useMemo<GlobeDestination[]>(
    () =>
      destinations.map((d) => ({
        id: d.id,
        tripId: d.tripId,
        tripName: d.tripName,
        name: d.name,
        countryCode: d.countryCode,
        lat: d.lat,
        lng: d.lng,
        arrivalDate: d.arrivalDate,
        departureDate: d.departureDate,
        categoryColor: d.category?.color ?? null,
      })),
    [destinations],
  );

  const selectedGroups = useMemo<TripGroup[]>(() => {
    if (!selected) return [];
    return groupByTrip(
      destinations.filter((d) => d.countryCode === selected.code),
    );
  }, [selected, destinations]);

  // Escape dismisses the drill-down.
  useEffect(() => {
    if (!selected) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected]);

  return (
    <div className="relative h-[60vh] min-h-[380px] w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0d0d0d]">
      <Globe
        visitedCountryCodes={visitedCountryCodes}
        destinations={globeDestinations}
        arcs={arcs}
        autoRotate={false}
        fitToData={!isEmpty}
        enableDestinationLinks
        enableCountryDrilldown
        onCountrySelect={setSelected}
      />

      {/* Stats overlay */}
      {!isEmpty ? (
        <div className="pointer-events-none absolute left-4 top-4 z-20 rounded-full border border-white/10 bg-black/60 px-3.5 py-1.5 text-xs font-medium text-foreground/80 shadow-md backdrop-blur-md">
          {stats.countries} {stats.countries === 1 ? "country" : "countries"},{" "}
          {stats.trips} {stats.trips === 1 ? "trip" : "trips"}, {stats.destinations}{" "}
          {stats.destinations === 1 ? "destination" : "destinations"}
        </div>
      ) : null}

      {/* Empty state */}
      {isEmpty ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-6">
          <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-white/10 bg-black/70 px-8 py-10 text-center shadow-xl backdrop-blur-md">
            <p className="text-balance text-foreground/80">
              Your world map is empty. Add your first trip to light it up.
            </p>
            <Link
              href="/trips/new"
              className={cn(
                buttonVariants({ size: "lg" }),
                "bg-brand text-brand-foreground hover:bg-brand/90",
              )}
            >
              <PlusIcon />
              Add your first trip
            </Link>
          </div>
        </div>
      ) : null}

      {/* Country drill-down panel */}
      {selected ? (
        <div className="absolute inset-y-0 right-0 z-30 flex w-80 max-w-[85%] flex-col border-l border-white/10 bg-black/85 shadow-2xl backdrop-blur-md">
          <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 truncate text-base font-semibold tracking-tight">
                <span>{flagEmoji(selected.code)}</span>
                <span className="truncate">{selected.name}</span>
              </h2>
              <p className="mt-0.5 text-xs text-foreground/50">
                {selectedGroups.reduce((sum, g) => sum + g.destinations.length, 0)}{" "}
                {selectedGroups.reduce((sum, g) => sum + g.destinations.length, 0) ===
                1
                  ? "destination"
                  : "destinations"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label="Close"
              className="rounded-md p-1 text-foreground/60 transition-colors hover:bg-white/5 hover:text-foreground"
            >
              <XIcon className="size-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {selectedGroups.length === 0 ? (
              <p className="text-sm text-foreground/50">
                No destinations in this country.
              </p>
            ) : (
              <div className="flex flex-col gap-5">
                {selectedGroups.map((group) => (
                  <div key={group.tripId} className="flex flex-col gap-2">
                    <h3 className="text-xs font-medium uppercase tracking-wide text-foreground/45">
                      {group.tripName}
                    </h3>
                    <ul className="flex flex-col gap-1">
                      {group.destinations.map((destination) => (
                        <li key={destination.id}>
                          <Link
                            href={`/trips/${destination.tripId}/destinations/${destination.id}`}
                            className="group flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/5"
                          >
                            <MapPinIcon className="mt-0.5 size-3.5 shrink-0 text-brand" />
                            <span className="min-w-0">
                              <span className="block truncate text-sm text-foreground/90 group-hover:text-foreground">
                                {destination.name}
                              </span>
                              {formatDateRange(
                                destination.arrivalDate,
                                destination.departureDate,
                              ) ? (
                                <span className="block truncate text-xs text-foreground/45">
                                  {formatDateRange(
                                    destination.arrivalDate,
                                    destination.departureDate,
                                  )}
                                </span>
                              ) : null}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

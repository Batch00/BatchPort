"use client";

import { useMemo } from "react";

import { Globe, type GlobeDestination } from "@/components/map/globe";
import type { MapData } from "@/lib/map-data";

// Read-only globe for the public share and demo surfaces. It reuses the existing
// Globe with the user's data, minus any links into the protected app. Country
// clicks fly the camera in but open nothing (the side panel and detail links
// live only in the authenticated dashboard).
export function ShareGlobe({ data }: { data: MapData }) {
  const { destinations, visitedCountryCodes, bucketCountryCodes, arcs, stats } =
    data;

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

  const isEmpty = destinations.length === 0;

  return (
    <div className="relative h-[60vh] min-h-[380px] w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0d0d0d]">
      <Globe
        visitedCountryCodes={visitedCountryCodes}
        bucketCountryCodes={bucketCountryCodes}
        destinations={globeDestinations}
        arcs={arcs}
        autoRotate={false}
        fitToData={!isEmpty}
        enableCountryDrilldown
        onCountrySelect={() => {}}
      />

      {!isEmpty ? (
        <div className="pointer-events-none absolute left-4 top-4 z-20 rounded-full border border-white/10 bg-black/60 px-3.5 py-1.5 text-xs font-medium text-foreground/80 shadow-md backdrop-blur-md">
          {stats.countries} {stats.countries === 1 ? "country" : "countries"},{" "}
          {stats.trips} {stats.trips === 1 ? "trip" : "trips"},{" "}
          {stats.destinations}{" "}
          {stats.destinations === 1 ? "destination" : "destinations"}
        </div>
      ) : null}
    </div>
  );
}

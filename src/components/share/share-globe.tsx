"use client";

import { useMemo } from "react";

import { Globe, type GlobeDestination } from "@/components/map/globe";
import type { MapData } from "@/lib/map-data";

// Read-only globe for the public share and demo surfaces. It reuses the existing
// Globe with the user's data, minus any links into the protected app. Country
// clicks fly the camera in but open nothing (the side panel and detail links
// live only in the authenticated dashboard).
export function ShareGlobe({ data }: { data: MapData }) {
  const {
    destinations,
    visitedCountryCodes,
    plannedCountryCodes,
    bucketCountryCodes,
    bucketPlaces,
    arcs,
    stats,
  } = data;

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
        planned: d.planned,
      })),
    [destinations],
  );

  // Bucket place pins are part of the profile story; without onExplorePlace
  // their popups show the name only (no explore action on public surfaces).
  const globeBucketPlaces = useMemo(
    () =>
      bucketPlaces
        .filter((place) => place.lat !== null && place.lng !== null)
        .map((place) => ({
          id: place.id,
          name: place.name,
          countryCode: place.countryCode,
          lat: place.lat as number,
          lng: place.lng as number,
        })),
    [bucketPlaces],
  );

  const isEmpty = destinations.length === 0;

  return (
    <div className="relative h-[45vh] min-h-[300px] w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0d0d0d] sm:h-[60vh] sm:min-h-[380px]">
      <Globe
        visitedCountryCodes={visitedCountryCodes}
        bucketCountryCodes={bucketCountryCodes}
        plannedCountryCodes={plannedCountryCodes}
        destinations={globeDestinations}
        arcs={arcs}
        bucketPlaces={globeBucketPlaces}
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

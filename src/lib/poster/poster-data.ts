// Assembling the poster's inputs from rows the page already has.
//
// Type-only imports on both sides, so this module can be called from a server
// component and its output handed to a client component as plain props without
// dragging either data layer across the boundary.

import type { MapData } from "@/lib/map-data";
import type { StatsData } from "@/lib/stats-data";
import type { PosterData } from "@/lib/poster/poster";

function yearOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const year = Number(value.slice(0, 4));
  return Number.isFinite(year) && year > 1900 && year < 2200 ? year : null;
}

/**
 * Planned trips are left out, for the same reason the landing hero leaves them
 * out: hollow pins and dashed arcs need a legend and a trip list to be read as
 * intentions rather than history, and a poster has neither. A poster is a
 * record of where someone has been.
 */
export function buildPosterData(map: MapData, stats: StatsData): PosterData {
  const visited = map.destinations.filter((destination) => !destination.planned);
  const visitedCountryCodes = map.visitedCountryCodes;
  const visitedSet = new Set(visitedCountryCodes);

  let firstYear: number | null = null;
  let lastYear: number | null = null;
  for (const destination of visited) {
    for (const value of [
      destination.arrivalDate,
      destination.departureDate,
      destination.tripStartDate,
      destination.tripEndDate,
    ]) {
      const year = yearOf(value);
      if (year === null) continue;
      if (firstYear === null || year < firstYear) firstYear = year;
      if (lastYear === null || year > lastYear) lastYear = year;
    }
  }

  return {
    visitedCountryCodes,
    bucketCountryCodes: map.bucketCountryCodes.filter(
      (code) => !visitedSet.has(code),
    ),
    pins: visited.map((destination) => ({
      lat: destination.lat,
      lng: destination.lng,
    })),
    legs: map.arcs
      .filter((arc) => !arc.planned)
      .map((arc) => ({ from: arc.sourcePosition, to: arc.targetPosition })),
    countries: stats.summary?.countries_visited ?? visitedCountryCodes.length,
    continents: stats.summary?.continents_visited ?? 0,
    trips: stats.summary?.total_trips ?? map.stats.trips,
    destinations: stats.summary?.total_destinations ?? visited.length,
    distanceKm: stats.distanceKm,
    firstYear,
    lastYear,
  };
}

/** Whether there is enough here to be worth exporting. */
export function hasPosterData(data: PosterData): boolean {
  return data.pins.length > 0 || data.visitedCountryCodes.length > 0;
}

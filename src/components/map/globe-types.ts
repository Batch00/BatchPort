// The globe's public data shapes. They live in their own module so the pure
// source builders (globe-sources) can use them without importing the component,
// and so hosts can type their props without pulling in MapLibre. The Globe
// component re-exports all of them, so `from "@/components/map/globe"` keeps
// working everywhere it is already used.

import type { TransportMode } from "@/lib/transport";

/** A single mappable stop. Positions are [lng, lat]. */
export interface GlobeDestination {
  id: string;
  tripId: string;
  tripName: string;
  name: string;
  countryCode: string | null;
  lat: number;
  lng: number;
  arrivalDate: string | null;
  departureDate: string | null;
  /** Hex colour for the pin tint, or null to fall back to the brand colour. */
  categoryColor: string | null;
  /** Planned-trip stops render hollow (dark core, no glow). Default false. */
  planned?: boolean;
  /** Trip dates and visit order, used by the replay timeline when enabled. */
  tripStartDate?: string | null;
  tripEndDate?: string | null;
  orderIndex?: number;
}

/** A great-circle leg between two consecutive stops on a trip. */
export interface GlobeArc {
  sourcePosition: [number, number];
  targetPosition: [number, number];
  tripName: string;
  sourceCity: string;
  targetCity: string;
  /** Planned-trip legs render dashed. Default false. */
  planned?: boolean;
  /** How the hop was travelled, which picks the arc's line family (see
   * lib/transport.ts). Absent or null draws the default air styling, so a map
   * nobody has annotated looks exactly as it always did. */
  mode?: TransportMode | null;
}

/** An unfulfilled place-type bucket list item with coordinates. */
export interface GlobeBucketPlace {
  id: string;
  name: string;
  countryCode: string | null;
  lat: number;
  lng: number;
}

/** The country a drill-down was opened on. */
export interface GlobeCountrySelection {
  code: string;
  name: string;
}

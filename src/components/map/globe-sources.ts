import type { FeatureCollection, LineString, Point } from "geojson";

import { greatCirclePoints } from "@/lib/geo";
import { arcFamily } from "@/lib/transport";
import type {
  GlobeArc,
  GlobeBucketPlace,
  GlobeDestination,
  GlobePlace,
} from "./globe-types";

// Pure builders that turn the globe's data props into the GeoJSON its native
// MapLibre sources consume, plus the small formatting helpers the popup HTML
// needs. Kept out of the component so the map effect reads as layer setup.

// Intermediate points per arc, so the line follows the great circle smoothly.
const ARC_SEGMENTS = 48;

export function destinationsFC(
  destinations: GlobeDestination[],
  brandHex: string,
): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: destinations.map((d, index) => ({
      type: "Feature",
      // Numeric id so MapLibre feature-state (hover) works.
      id: index,
      geometry: { type: "Point", coordinates: [d.lng, d.lat] },
      properties: {
        destId: d.id,
        tripId: d.tripId,
        tripName: d.tripName,
        name: d.name,
        countryCode: d.countryCode ?? "",
        arrivalDate: d.arrivalDate ?? "",
        departureDate: d.departureDate ?? "",
        color: d.categoryColor ?? brandHex,
        planned: d.planned ?? false,
      },
    })),
  };
}

export function arcsFC(arcs: GlobeArc[]): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: arcs.map((arc) => ({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: greatCirclePoints(
          arc.sourcePosition,
          arc.targetPosition,
          ARC_SEGMENTS,
        ),
      },
      properties: {
        tripName: arc.tripName,
        planned: arc.planned ?? false,
        // The layer filters read this: "air" covers flights and every hop
        // nobody recorded a mode for.
        family: arcFamily(arc.mode ?? null),
      },
    })),
  };
}

export function bucketPlacesFC(
  places: GlobeBucketPlace[],
): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: places.map((place, index) => ({
      type: "Feature",
      id: index,
      geometry: { type: "Point", coordinates: [place.lng, place.lat] },
      properties: {
        placeId: place.id,
        name: place.name,
        countryCode: place.countryCode ?? "",
        lat: place.lat,
        lng: place.lng,
      },
    })),
  };
}

export function placesFC(places: GlobePlace[]): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: places.map((place, index) => ({
      type: "Feature",
      // Numeric id so MapLibre feature-state (hover) works.
      id: index,
      geometry: { type: "Point", coordinates: [place.lng, place.lat] },
      properties: {
        placeId: place.id,
        name: place.name,
        placeType: place.placeType,
        firstVisitDate: place.firstVisitDate ?? "",
        visitCount: place.visitCount,
      },
    })),
  };
}

/**
 * The globe's country tiers, strongest first. A country takes exactly one:
 *
 *   visited   a completed or ongoing trip stopped there      solid brand fill
 *   places    reached only through logged places            brand hatch
 *   planned   only a planned trip goes there                dashed outline
 *   bucket    on the bucket list, none of the above          amber fill
 *
 * "places" is presentation only. It never joins visitedCountryCodes, so the
 * countries count, v_user_travel_summary, and every stat are untouched; it is
 * derived here, on the client, from the pins the globe is already showing.
 * That is also why hiding places with the toggle removes the tier: a hatched
 * country with no pin in it would be a fill nobody can explain.
 *
 * It outranks planned and bucket because it is a statement about the past
 * (the user has been there), the same reason visited outranks them. A bucket
 * country reached by a place stays on the list (auto-fulfillment counts trips
 * only); the list is where that is visible, not the fill.
 */
export interface CountryTiers {
  visited: string[];
  places: string[];
  planned: string[];
  bucket: string[];
}

export function countryTiers(input: {
  visited: string[];
  planned: string[];
  bucket: string[];
  places: GlobePlace[];
}): CountryTiers {
  const visited = new Set(input.visited);
  const places = new Set<string>();
  for (const place of input.places) {
    if (place.countryCode && !visited.has(place.countryCode)) {
      places.add(place.countryCode);
    }
  }
  const taken = (code: string) => visited.has(code) || places.has(code);
  return {
    visited: input.visited,
    places: Array.from(places),
    planned: input.planned.filter((code) => !taken(code)),
    bucket: Array.from(new Set(input.bucket.filter((code) => !taken(code)))),
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Inline SVG flag for popup HTML (emoji flags render as bare letters on
 * Windows). Returns an empty string for anything that is not a two-letter
 * code, so the value is never interpolated unvalidated. */
export function flagImgHtml(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "";
  return `<img src="https://flagcdn.com/${code.toLowerCase()}.svg" alt="" style="height:11px;width:auto;border-radius:2px;vertical-align:-1px;margin-right:4px" />`;
}

/** Normalize a longitude into [-180, 180) after the auto-rotation walks it
 * past the antimeridian. */
export function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

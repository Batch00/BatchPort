import type { FeatureCollection, LineString, Point } from "geojson";

import { greatCirclePoints } from "@/lib/geo";
import { arcFamily } from "@/lib/transport";
import type {
  GlobeArc,
  GlobeBucketPlace,
  GlobeDestination,
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

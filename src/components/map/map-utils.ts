// Helpers shared by the globe component and the replay engine: brand colour
// resolution from CSS, country-code match filters, and feature bounds.

import type { FilterSpecification, GeoJSONFeature } from "maplibre-gl";

import { boundsOfPoints } from "@/lib/geo";

export const BRAND_FALLBACK = "#2563eb";
export const VISITED_BORDER = "#4a8af5";

/**
 * The normal travel layers (fills, arcs, pins) that step aside while an
 * alternate globe mode (replay, photo map) owns the stage. Modes hide these
 * on enter and restore them on exit.
 */
export const TRAVEL_LAYERS = [
  "country-bucket",
  "country-visited",
  "country-visited-outline",
  "country-planned-outline",
  "trip-arcs-glow",
  "trip-arcs",
  "trip-arcs-planned",
  "bucket-pins-glow",
  "bucket-pins",
  "pins-glow",
  "pins",
];

// Match expression comparing ISO_A2_EH against a code list.
export function matchFilter(codes: string[]): FilterSpecification {
  return [
    "match",
    ["get", "ISO_A2_EH"],
    codes.length > 0 ? codes : [" "],
    true,
    false,
  ] as unknown as FilterSpecification;
}

export function hexToRgb(hex: string): [number, number, number] {
  let value = hex.trim().replace("#", "");
  if (value.length === 3) {
    value = value
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const int = Number.parseInt(value, 16);
  if (Number.isNaN(int) || value.length !== 6) return hexToRgb(BRAND_FALLBACK);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  const channel = (c: number) =>
    Math.max(0, Math.min(255, Math.round(c)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** The brand colour as a hex string, read from CSS so it tracks the theme. */
export function readBrandHex(): string {
  if (typeof window === "undefined") return BRAND_FALLBACK;
  const fromCss = getComputedStyle(document.documentElement)
    .getPropertyValue("--brand")
    .trim();
  if (!fromCss) return BRAND_FALLBACK;
  if (fromCss.startsWith("#")) return rgbToHex(hexToRgb(fromCss));
  return fromCss;
}

/** Bounding box of a clicked country feature's polygon geometry. */
export function boundsOfFeature(
  feature: GeoJSONFeature,
): [number, number, number, number] | null {
  const geometry = feature.geometry;
  const points: [number, number][] = [];
  const collectRing = (ring: number[][]) => {
    for (const position of ring) {
      points.push([position[0], position[1]]);
    }
  };
  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) collectRing(ring as number[][]);
  } else if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) collectRing(ring as number[][]);
    }
  }
  return boundsOfPoints(points);
}

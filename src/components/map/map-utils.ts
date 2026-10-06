// Helpers shared by the globe component and the replay engine: brand colour
// resolution from CSS, country-code match filters, and feature bounds.

import type {
  FilterSpecification,
  GeoJSONFeature,
  MapGeoJSONFeature,
  Map as MlMap,
} from "maplibre-gl";

import { boundsOfPoints } from "@/lib/geo";

// Pin hit testing.
//
// MapLibre hit-tests a circle at exactly its drawn size (circle-radius plus
// circle-stroke-width), so the tap target IS the dot: 4.75px of radius for a
// logged place, 7 for a bucket pin, 8.5 for a trip stop. Every one of those is
// far under a fingertip, and a miss does not fail quietly, it lands on the
// country fill underneath and opens that instead. So pins are found within a
// radius of the pointer and the drawn sizes stay as they are.
//
// TOUCH: 22px of radius, a 44px target, which is Apple's minimum touch target
// (44pt) and a hair under Material's 48dp. A fingertip's contact patch is
// roughly that wide, so anything smaller still misses on an ordinary tap.
// MOUSE: 10px, a 20px target. A cursor is precise, and the radius only has to
// cover the largest drawn pin (8.5px) with a little slack; any more and the
// cursor turns into a pointer well off a pin, over a country the user may
// have meant to click.
export const PIN_HIT_RADIUS_TOUCH = 22;
export const PIN_HIT_RADIUS_MOUSE = 10;

/**
 * The hit radius for one pointer event: touch and pen get the finger radius,
 * a mouse gets the cursor radius. Browsers that deliver click as a plain
 * MouseEvent with no pointerType (older Safari) fall back to whether the
 * primary pointer is coarse, which is right for every phone.
 */
export function pinHitRadius(event: Event | undefined): number {
  if (typeof PointerEvent !== "undefined" && event instanceof PointerEvent) {
    if (event.pointerType === "mouse") return PIN_HIT_RADIUS_MOUSE;
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      return PIN_HIT_RADIUS_TOUCH;
    }
  }
  if (typeof TouchEvent !== "undefined" && event instanceof TouchEvent) {
    return PIN_HIT_RADIUS_TOUCH;
  }
  if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) {
    return PIN_HIT_RADIUS_TOUCH;
  }
  return PIN_HIT_RADIUS_MOUSE;
}

/**
 * The pin nearest the pointer, within `radius` CSS pixels of its centre, or
 * null. Queries a box around the point (the circle layers report anything
 * whose dot touches it) and then keeps the closest centre inside the circle,
 * so three Wisconsin pins a few pixels apart resolve to the one actually
 * under the finger rather than to whichever MapLibre listed first.
 *
 * `layers` is in priority order: on an exact tie (two pins drawn on the same
 * spot) the earlier layer wins, which keeps a trip stop ahead of a logged
 * place at the same coordinate.
 */
export function nearestPinFeature(
  map: MlMap,
  point: { x: number; y: number },
  layers: string[],
  radius: number,
): MapGeoJSONFeature | null {
  const live = layers.filter((layer) => map.getLayer(layer));
  if (live.length === 0) return null;
  const candidates = map.queryRenderedFeatures(
    [
      [point.x - radius, point.y - radius],
      [point.x + radius, point.y + radius],
    ],
    { layers: live },
  );
  let best: MapGeoJSONFeature | null = null;
  let bestDistance = Infinity;
  let bestRank = Infinity;
  for (const feature of candidates) {
    if (feature.geometry.type !== "Point") continue;
    const [lng, lat] = feature.geometry.coordinates as [number, number];
    const projected = map.project([lng, lat]);
    const distance = Math.hypot(projected.x - point.x, projected.y - point.y);
    if (distance > radius) continue;
    const rank = live.indexOf(feature.layer.id);
    const closer = distance < bestDistance - 0.5;
    const tiedButHigher = Math.abs(distance - bestDistance) <= 0.5 && rank < bestRank;
    if (closer || tiedButHigher) {
      best = feature;
      bestDistance = distance;
      bestRank = rank;
    }
  }
  return best;
}

export const BRAND_FALLBACK = "#2563eb";
export const VISITED_BORDER = "#4a8af5";

/**
 * The normal travel layers (fills, arcs, pins) that step aside while an
 * alternate globe mode (replay, photo map) owns the stage. Modes hide these
 * on enter and restore them on exit.
 */
export const TRAVEL_LAYERS = [
  "country-bucket",
  "country-places",
  "country-places-outline",
  "country-visited",
  "country-visited-outline",
  "country-planned-outline",
  "trip-arcs-glow",
  "trip-arcs",
  "trip-arcs-ground",
  "trip-arcs-sea",
  "trip-arcs-planned",
  "bucket-pins-glow",
  "bucket-pins-halo",
  "bucket-pins",
  "place-pins-halo",
  "place-pins",
  "pins-glow",
  "pins-halo",
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

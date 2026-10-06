import type { FilterSpecification, Map as MlMap } from "maplibre-gl";

import { GROUND_ARC_COLOR, SEA_ARC_COLOR } from "@/lib/transport";
import { getCachedCountries, overlayTheme } from "./basemaps";
import {
  arcsFC,
  bucketPlacesFC,
  countryTiers,
  destinationsFC,
  placesFC,
} from "./globe-sources";
import { VISITED_BORDER, matchFilter } from "./map-utils";
import type {
  GlobeArc,
  GlobeBucketPlace,
  GlobeDestination,
  GlobePlace,
} from "./globe-types";

// Every runtime layer the globe draws on top of whichever basemap style is
// loaded: country fills, trip arcs, destination pins, bucket place pins, and
// the transparent country hit-test layer detailed basemaps do not ship.
//
// These run on first load and again after every basemap switch (setStyle with
// diff:false wipes all non-style sources and layers). The existence guards keep
// them safe to call more than once and preserve the intended z-order: fills
// beneath the country border, arcs and pins on top.

// Dim amber for "want to visit" countries: distinct from visited (blue) and
// unvisited (dark gray) without competing with the brand accent.
const BUCKET_FILL = "#b45309";
// Amber pin colours for place-type bucket items.
const BUCKET_PIN_FILL = "#b45309";
const BUCKET_PIN_STROKE = "#fbbf24";
// Hollow core for planned-trip pins: reads as "not yet filled in".
const PLANNED_PIN_CORE = "#111318";
const PIN_RADIUS = 6;
const PIN_RADIUS_HOVER = 8.5;
// Logged places: one class, never tinted by type. Smaller than a trip stop,
// no glow, no category ring, and a soft grey-white rather than the stop's pure
// white, so a stop always reads as the louder of the two. The dark stroke
// keeps a 3.5px dot legible against the brand-blue country fill it will
// usually sit on.
const PLACE_PIN_FILL = "#cbd5e1";
const PLACE_PIN_STROKE = "#0a0a0a";
const PLACE_PIN_RADIUS = 3.5;
const PLACE_PIN_RADIUS_HOVER = 5.5;

// The places-only country tier is a diagonal hatch in the brand blue: a
// partial fill, which is what it means (been there, not on a trip). A fainter
// solid fill was the alternative and loses twice: it reads as "visited, but
// dim", and on detailed basemaps, where visited is already a 14 to 18 percent
// tint, half of that is invisible. Stripes stay legible on every basemap.
export const PLACES_HATCH_IMAGE = "places-hatch";
// One tile, in CSS pixels; drawn at 2x so the stripes stay crisp.
const HATCH_TILE = 8;
const HATCH_PIXEL_RATIO = 2;
const HATCH_STROKE = 1.6;

// A seamless 45 degree hatch: lines x + y = k * HATCH_TILE / 2, so shifting by
// a whole tile maps every line onto another one and the edges meet. Returned
// as raw RGBA so it needs no canvas element in the DOM.
function hatchImage(brandHex: string): {
  width: number;
  height: number;
  data: Uint8Array;
} | null {
  const size = HATCH_TILE * HATCH_PIXEL_RATIO;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.strokeStyle = brandHex;
  ctx.lineWidth = HATCH_STROKE * HATCH_PIXEL_RATIO;
  ctx.lineCap = "square";
  const step = size / 2;
  for (let k = -1; k <= 5; k += 1) {
    ctx.beginPath();
    ctx.moveTo(k * step - size, size);
    ctx.lineTo(k * step, 0);
    ctx.stroke();
  }
  const { data } = ctx.getImageData(0, 0, size, size);
  return { width: size, height: size, data: new Uint8Array(data.buffer) };
}

export interface OverlayInstallOptions {
  /** The active basemap id, which selects the overlay tint treatment. */
  basemapId: string;
  brandHex: string;
  brandFillCss: string;
  visitedCountryCodes: string[];
  bucketCountryCodes: string[];
  plannedCountryCodes: string[];
  destinations: GlobeDestination[];
  arcs: GlobeArc[];
  bucketPlaces: GlobeBucketPlace[];
  places: GlobePlace[];
}

/** Sky and atmosphere. Re-applied after every style (initial load or a later
 * basemap switch, which resets style-level settings). */
export function applySky(map: MlMap) {
  try {
    map.setSky({
      "sky-color": "#0a1a33",
      "horizon-color": "#0d0d0d",
      "fog-color": "#0d0d0d",
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.6,
      "fog-ground-blend": 0.4,
      "atmosphere-blend": 0.5,
    });
  } catch {
    // Older renderers may not support sky; the map still works without it.
  }
}

// The dark style ships the countries source and the hit-test fill / border
// layers; MapTiler basemaps do not. Add them when missing (transparent land so
// imagery shows through but stays hoverable, subtle borders) so country hover,
// click, and the visited/bucket fills work on every basemap.
function ensureCountriesBase(map: MlMap, basemapId: string) {
  if (!map.getSource("countries")) {
    map.addSource("countries", {
      type: "geojson",
      // The module-level cache makes basemap switches reinstall from memory;
      // the URL form only runs on the very first style load.
      data: getCachedCountries() ?? "/data/countries.geojson",
      generateId: true,
    });
  }
  // On detailed basemaps the country layers (and the visited/bucket fills
  // anchored beneath country-outline) slot in under the style's own label
  // layers, so place names and native POI labels render above the tint. The
  // dark style keeps its original stacking untouched.
  const beforeLabels =
    basemapId === "dark"
      ? undefined
      : map.getStyle().layers?.find((layer) => layer.type === "symbol")?.id;
  if (!map.getLayer("country-fill")) {
    map.addLayer(
      {
        id: "country-fill",
        type: "fill",
        source: "countries",
        paint: {
          "fill-color": "#ffffff",
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            0.08,
            0,
          ],
        },
      },
      beforeLabels,
    );
  }
  if (!map.getLayer("country-outline")) {
    map.addLayer(
      {
        id: "country-outline",
        type: "line",
        source: "countries",
        paint: {
          "line-color": "rgba(255,255,255,0.15)",
          "line-width": 0.6,
        },
      },
      beforeLabels,
    );
  }
}

/** Install every runtime overlay on top of the current style. */
export function installOverlays(map: MlMap, options: OverlayInstallOptions) {
  const { basemapId, brandHex, brandFillCss } = options;
  ensureCountriesBase(map, basemapId);

  const theme = overlayTheme(basemapId);
  const tiers = countryTiers({
    visited: options.visitedCountryCodes,
    planned: options.plannedCountryCodes,
    bucket: options.bucketCountryCodes,
    places: options.places,
  });
  const visitedFilter = matchFilter(tiers.visited);
  const bucketFilter = matchFilter(tiers.bucket);
  const placesFilter = matchFilter(tiers.places);
  const beforeOutline = map.getLayer("country-outline")
    ? "country-outline"
    : undefined;

  // Want-to-visit fill (dim amber), drawn beneath the visited fill.
  if (!map.getLayer("country-bucket")) {
    map.addLayer(
      {
        id: "country-bucket",
        type: "fill",
        source: "countries",
        filter: bucketFilter,
        paint: {
          "fill-color": BUCKET_FILL,
          "fill-opacity": theme.bucketOpacity,
        },
      },
      beforeOutline,
    );
  }

  // Places-only tier (brand hatch), above amber and beneath visited. The image
  // is runtime state, so a basemap switch wipes it with everything else and
  // this re-adds it.
  if (!map.hasImage(PLACES_HATCH_IMAGE)) {
    const image = hatchImage(brandHex);
    if (image) {
      map.addImage(PLACES_HATCH_IMAGE, image, {
        pixelRatio: HATCH_PIXEL_RATIO,
      });
    }
  }
  if (map.hasImage(PLACES_HATCH_IMAGE) && !map.getLayer("country-places")) {
    map.addLayer(
      {
        id: "country-places",
        type: "fill",
        source: "countries",
        filter: placesFilter,
        paint: {
          "fill-pattern": PLACES_HATCH_IMAGE,
          "fill-opacity": theme.placesHatchOpacity,
        },
      },
      beforeOutline,
    );
  }

  // Visited country fill (brand blue), under the outline so borders stay
  // crisp; brightens on hover.
  if (!map.getLayer("country-visited")) {
    map.addLayer(
      {
        id: "country-visited",
        type: "fill",
        source: "countries",
        filter: visitedFilter,
        paint: {
          "fill-color": brandFillCss,
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            theme.visitedHoverOpacity,
            theme.visitedOpacity,
          ],
        },
      },
      beforeOutline,
    );
  }

  if (!map.getLayer("country-visited-outline")) {
    map.addLayer({
      id: "country-visited-outline",
      type: "line",
      source: "countries",
      filter: visitedFilter,
      paint: {
        "line-color": VISITED_BORDER,
        "line-width": theme.visitedOutlineWidth,
        "line-opacity": theme.visitedOutlineOpacity,
      },
    });
  }

  // Places-only countries: a SOLID outline, thinner and fainter than visited.
  // Solid is what separates it from planned (dashed) at a glance, before the
  // hatch inside has resolved.
  if (!map.getLayer("country-places-outline")) {
    map.addLayer({
      id: "country-places-outline",
      type: "line",
      source: "countries",
      filter: placesFilter,
      paint: {
        "line-color": VISITED_BORDER,
        "line-width": theme.visitedOutlineWidth,
        "line-opacity": theme.visitedOutlineOpacity * 0.6,
      },
    });
  }

  // Planned trips: countries get a dashed brand-blue outline with no fill, so
  // upcoming travel is visible but clearly not yet visited.
  if (!map.getLayer("country-planned-outline")) {
    map.addLayer({
      id: "country-planned-outline",
      type: "line",
      source: "countries",
      filter: matchFilter(tiers.planned),
      paint: {
        "line-color": VISITED_BORDER,
        "line-width": theme.plannedOutlineWidth,
        "line-opacity": 0.85,
        "line-dasharray": [2, 2],
      },
    });
  }

  // Native pins and arcs: rendered by MapLibre so they stay locked to their
  // coordinates on both globe and mercator projections.
  if (!map.getSource("arcs")) {
    map.addSource("arcs", { type: "geojson", data: arcsFC(options.arcs) });
  }
  if (!map.getSource("destinations")) {
    map.addSource("destinations", {
      type: "geojson",
      data: destinationsFC(options.destinations, brandHex),
    });
  }

  // Completed/ongoing legs, split by how they were travelled. The families and
  // their reasoning live in lib/transport.ts; the split into three layers is a
  // MapLibre constraint, not a design one: line-dasharray is not a data-driven
  // paint property, so each dash pattern needs its own layer and filter (the
  // same reason planned arcs already have theirs).
  //
  //   air    solid brand blue with a glow, which is what every arc looked like
  //          before modes existed. Flights and unrecorded hops both land here.
  //   ground violet, dashed, thinner, no glow. The dashes read as "this line
  //          stands in for a road or a railway", which it does: the geometry
  //          is still the great circle and nothing knows the real route.
  //   sea    cyan, dotted (a zero-length dash with round caps).
  const air: FilterSpecification = [
    "all",
    ["!", ["get", "planned"]],
    ["==", ["get", "family"], "air"],
  ] as unknown as FilterSpecification;
  const ground: FilterSpecification = [
    "all",
    ["!", ["get", "planned"]],
    ["==", ["get", "family"], "ground"],
  ] as unknown as FilterSpecification;
  const sea: FilterSpecification = [
    "all",
    ["!", ["get", "planned"]],
    ["==", ["get", "family"], "sea"],
  ] as unknown as FilterSpecification;

  if (!map.getLayer("trip-arcs-glow")) {
    map.addLayer({
      id: "trip-arcs-glow",
      type: "line",
      source: "arcs",
      filter: air,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": brandHex,
        "line-width": 7,
        "line-opacity": 0.18,
        "line-blur": 2,
      },
    });
  }
  if (!map.getLayer("trip-arcs")) {
    map.addLayer({
      id: "trip-arcs",
      type: "line",
      source: "arcs",
      filter: air,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": brandHex,
        "line-width": 2.5,
        "line-opacity": 0.9,
      },
    });
  }
  if (!map.getLayer("trip-arcs-ground")) {
    map.addLayer({
      id: "trip-arcs-ground",
      type: "line",
      source: "arcs",
      filter: ground,
      layout: { "line-join": "round" },
      paint: {
        "line-color": GROUND_ARC_COLOR,
        "line-width": 2,
        "line-opacity": 0.85,
        "line-dasharray": [3, 2],
      },
    });
  }
  if (!map.getLayer("trip-arcs-sea")) {
    map.addLayer({
      id: "trip-arcs-sea",
      type: "line",
      source: "arcs",
      filter: sea,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": SEA_ARC_COLOR,
        "line-width": 2.2,
        "line-opacity": 0.85,
        "line-dasharray": [0, 2.2],
      },
    });
  }
  if (!map.getLayer("trip-arcs-planned")) {
    map.addLayer({
      id: "trip-arcs-planned",
      type: "line",
      source: "arcs",
      filter: ["get", "planned"],
      layout: { "line-join": "round" },
      paint: {
        "line-color": brandHex,
        "line-width": 2,
        "line-opacity": 0.6,
        "line-dasharray": [1.5, 2],
      },
    });
  }

  // Amber pins for place-type bucket items, drawn beneath destination pins so
  // real stops win overlaps.
  if (!map.getSource("bucket-places")) {
    map.addSource("bucket-places", {
      type: "geojson",
      data: bucketPlacesFC(options.bucketPlaces),
    });
  }
  if (!map.getLayer("bucket-pins-glow")) {
    map.addLayer({
      id: "bucket-pins-glow",
      type: "circle",
      source: "bucket-places",
      paint: {
        "circle-radius": 11,
        "circle-color": BUCKET_PIN_STROKE,
        "circle-opacity": 0.3,
        "circle-blur": 1,
      },
    });
  }
  // Contrast halo behind the bucket pins on light basemaps.
  if (theme.pinHalo && !map.getLayer("bucket-pins-halo")) {
    map.addLayer({
      id: "bucket-pins-halo",
      type: "circle",
      source: "bucket-places",
      paint: {
        "circle-radius": 8,
        "circle-color": "#0a0a0a",
        "circle-opacity": 0.75,
      },
    });
  }
  if (!map.getLayer("bucket-pins")) {
    map.addLayer({
      id: "bucket-pins",
      type: "circle",
      source: "bucket-places",
      paint: {
        "circle-radius": 5,
        "circle-color": BUCKET_PIN_FILL,
        "circle-stroke-color": BUCKET_PIN_STROKE,
        "circle-stroke-width": 2,
      },
    });
  }

  // Logged places: above bucket pins, beneath every destination layer, so a
  // trip stop wins any overlap (the click and hover handlers query pins in
  // the same order).
  if (!map.getSource("places")) {
    map.addSource("places", {
      type: "geojson",
      data: placesFC(options.places),
    });
  }
  if (theme.pinHalo && !map.getLayer("place-pins-halo")) {
    map.addLayer({
      id: "place-pins-halo",
      type: "circle",
      source: "places",
      paint: {
        "circle-radius": PLACE_PIN_RADIUS + 2.5,
        "circle-color": "#0a0a0a",
        "circle-opacity": 0.6,
      },
    });
  }
  if (!map.getLayer("place-pins")) {
    map.addLayer({
      id: "place-pins",
      type: "circle",
      source: "places",
      paint: {
        "circle-radius": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          PLACE_PIN_RADIUS_HOVER,
          PLACE_PIN_RADIUS,
        ],
        "circle-color": PLACE_PIN_FILL,
        "circle-opacity": 0.9,
        "circle-stroke-color": PLACE_PIN_STROKE,
        "circle-stroke-width": 1.25,
      },
    });
  }

  // Glow only behind real (non-planned) stops.
  if (!map.getLayer("pins-glow")) {
    map.addLayer({
      id: "pins-glow",
      type: "circle",
      source: "destinations",
      filter: ["!", ["get", "planned"]],
      paint: {
        "circle-radius": 14,
        "circle-color": ["get", "color"],
        "circle-opacity": 0.4,
        "circle-blur": 1,
      },
    });
  }
  // Contrast halo behind destination pins on light basemaps: the white core
  // and pale category strokes vanish against bright terrain without a dark
  // ring underneath.
  if (theme.pinHalo && !map.getLayer("pins-halo")) {
    map.addLayer({
      id: "pins-halo",
      type: "circle",
      source: "destinations",
      paint: {
        "circle-radius": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          PIN_RADIUS_HOVER + 3,
          PIN_RADIUS + 3,
        ],
        "circle-color": "#0a0a0a",
        "circle-opacity": 0.75,
      },
    });
  }
  // One pins layer for both states: planned stops swap the white core for a
  // dark one, reading as a hollow ring in the trip's colour.
  if (!map.getLayer("pins")) {
    map.addLayer({
      id: "pins",
      type: "circle",
      source: "destinations",
      paint: {
        "circle-radius": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          PIN_RADIUS_HOVER,
          PIN_RADIUS,
        ],
        "circle-color": ["case", ["get", "planned"], PLANNED_PIN_CORE, "#ffffff"],
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-width": ["case", ["get", "planned"], 2, 2.5],
        "circle-opacity": ["case", ["get", "planned"], 0.9, 1],
      },
    });
  }
}

import type { Map as MlMap } from "maplibre-gl";

import { getCachedCountries, overlayTheme } from "./basemaps";
import { arcsFC, bucketPlacesFC, destinationsFC } from "./globe-sources";
import { VISITED_BORDER, matchFilter } from "./map-utils";
import type {
  GlobeArc,
  GlobeBucketPlace,
  GlobeDestination,
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
  const visitedFilter = matchFilter(options.visitedCountryCodes);
  const visitedSet = new Set(options.visitedCountryCodes);
  const bucketFilter = matchFilter(
    options.bucketCountryCodes.filter((code) => !visitedSet.has(code)),
  );
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

  // Planned trips: countries get a dashed brand-blue outline with no fill, so
  // upcoming travel is visible but clearly not yet visited.
  if (!map.getLayer("country-planned-outline")) {
    map.addLayer({
      id: "country-planned-outline",
      type: "line",
      source: "countries",
      filter: matchFilter(options.plannedCountryCodes),
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

  // Completed/ongoing legs: solid with a glow. Planned legs: dashed, no glow,
  // slightly dimmer.
  if (!map.getLayer("trip-arcs-glow")) {
    map.addLayer({
      id: "trip-arcs-glow",
      type: "line",
      source: "arcs",
      filter: ["!", ["get", "planned"]],
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
      filter: ["!", ["get", "planned"]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": brandHex,
        "line-width": 2.5,
        "line-opacity": 0.9,
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

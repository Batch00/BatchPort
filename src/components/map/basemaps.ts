import type {
  StyleSpecification,
  RasterSourceSpecification,
} from "maplibre-gl";
import type { FeatureCollection } from "geojson";

import type { BasemapOption } from "./map-controls";

// Basemap style management for the globe: which styles are offered, how each
// resolves to a MapLibre style, how far each can zoom, and how the brand
// overlays are tinted on top of it.
//
// The dark minimal style is the brand default and needs zero keys, so a fresh
// deploy never regresses. Detailed styles (real zoom detail past where the dark
// PMTiles raster goes gray) come from MapTiler and only appear when
// NEXT_PUBLIC_MAPTILER_KEY is set; without it the switcher hides those options
// (and hides entirely, since only the one style remains).

/** sessionStorage key holding the user's basemap choice for the session. */
export const BASEMAP_STORAGE_KEY = "batchport:basemap";

/**
 * Per-style overlay treatment. The dark minimal style carries the full-strength
 * brand fills (there is no underlying detail to bury); detailed basemaps drop
 * the fills to a light tint with clearer borders so streets, imagery, and
 * terrain stay readable underneath. Light styles also get a dark halo behind
 * the white-core pins, which otherwise vanish against pale terrain.
 */
export interface OverlayTheme {
  visitedOpacity: number;
  visitedHoverOpacity: number;
  bucketOpacity: number;
  visitedOutlineWidth: number;
  visitedOutlineOpacity: number;
  plannedOutlineWidth: number;
  pinHalo: boolean;
}

const OVERLAY_THEMES: Record<string, OverlayTheme> = {
  // The brand default look, unchanged.
  dark: {
    visitedOpacity: 0.55,
    visitedHoverOpacity: 0.72,
    bucketOpacity: 0.25,
    visitedOutlineWidth: 1,
    visitedOutlineOpacity: 0.9,
    plannedOutlineWidth: 1.5,
    pinHalo: false,
  },
  // Dark streets style: light tint so the road network reads through.
  streets: {
    visitedOpacity: 0.18,
    visitedHoverOpacity: 0.3,
    bucketOpacity: 0.14,
    visitedOutlineWidth: 1.6,
    visitedOutlineOpacity: 1,
    plannedOutlineWidth: 1.6,
    pinHalo: false,
  },
  // Imagery: the faintest wash, borders do the work; halo the pins against
  // bright terrain and snow.
  satellite: {
    visitedOpacity: 0.14,
    visitedHoverOpacity: 0.26,
    bucketOpacity: 0.12,
    visitedOutlineWidth: 1.6,
    visitedOutlineOpacity: 1,
    plannedOutlineWidth: 1.6,
    pinHalo: true,
  },
  // Outdoor terrain is a light style: light tint, strong borders, pin halos.
  terrain: {
    visitedOpacity: 0.16,
    visitedHoverOpacity: 0.28,
    bucketOpacity: 0.14,
    visitedOutlineWidth: 1.6,
    visitedOutlineOpacity: 1,
    plannedOutlineWidth: 1.6,
    pinHalo: true,
  },
};

export function overlayTheme(basemapId: string): OverlayTheme {
  return OVERLAY_THEMES[basemapId] ?? OVERLAY_THEMES.dark;
}

// MapTiler style slugs. Dark-leaning where a dark variant exists, to stay on
// brand; satellite uses "hybrid" so imagery keeps place labels.
const MAPTILER_STYLES: { id: string; label: string; slug: string }[] = [
  { id: "streets", label: "Streets", slug: "streets-v2-dark" },
  { id: "satellite", label: "Satellite", slug: "hybrid" },
  { id: "terrain", label: "Terrain", slug: "outdoor-v2" },
];

/**
 * Zoom depth per basemap: the keyless dark style has no detail past country
 * shapes, so zooming further just shows empty space; MapTiler styles carry
 * real street-level detail down to z19 (past the photo clustering max of 14,
 * so photo stacks fully unstack at street level).
 */
export function maxZoomForBasemap(id: string): number {
  return MAPTILER_STYLES.some((style) => style.id === id) &&
    process.env.NEXT_PUBLIC_MAPTILER_KEY
    ? 19
    : 10;
}

/**
 * The basemap a street-level mode should borrow, or null when the deployment
 * has no MapTiler key and there is nothing to borrow.
 *
 * Nearby and the attractions layer both work at zoom 13 and up, and the dark
 * minimal style has no detail past country shapes (it is capped at zoom 10 by
 * maxZoomForBasemap, so those modes cannot even reach their own zoom on it).
 * Streets is the answer rather than satellite or terrain: it is the dark
 * variant, so the switch stays on brand, and street names are what "what is
 * around me" actually needs.
 *
 * Without a key this returns null and the modes run on dark exactly as they
 * did before, which is the required degrade: no error, no missing control.
 */
export function detailBasemapId(): string | null {
  return process.env.NEXT_PUBLIC_MAPTILER_KEY ? "streets" : null;
}

/** The basemaps offered in the switcher. Always includes the keyless dark
 * default; adds the MapTiler styles only when a key is configured. */
export function availableBasemaps(): BasemapOption[] {
  const list: BasemapOption[] = [{ id: "dark", label: "Dark" }];
  if (process.env.NEXT_PUBLIC_MAPTILER_KEY) {
    for (const style of MAPTILER_STYLES) {
      list.push({ id: style.id, label: style.label });
    }
  }
  return list;
}

/** One entry in a style's layers array, derived to avoid extra type imports. */
type StyleLayerSpec = StyleSpecification["layers"][number];

/**
 * Inject the PMTiles raster basemap into the dark style. Assumes a raster
 * PMTiles archive, which is schema agnostic and needs no key.
 */
async function buildPmtilesStyle(
  pmtilesUrl: string,
): Promise<StyleSpecification> {
  const response = await fetch("/styles/dark-style.json");
  const style = (await response.json()) as StyleSpecification;

  const basemapSource: RasterSourceSpecification = {
    type: "raster",
    url: `pmtiles://${pmtilesUrl}`,
    tileSize: 512,
  };
  style.sources = { ...style.sources, basemap: basemapSource };

  const basemapLayer: StyleLayerSpec = {
    id: "basemap",
    type: "raster",
    source: "basemap",
    paint: { "raster-opacity": 0.85 },
  };
  // Sit the basemap just above the background and below the country layers.
  style.layers.splice(1, 0, basemapLayer);
  return style;
}

/** Resolve a basemap id to a MapLibre style. Unknown ids and the "dark" id both
 * resolve to the dark style (PMTiles raster when configured, else the bundled
 * JSON), so a missing key or a stale persisted id always degrades safely. */
export async function resolveBasemapStyle(
  id: string,
): Promise<string | StyleSpecification> {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  const maptiler = MAPTILER_STYLES.find((style) => style.id === id);
  if (maptiler && key) {
    return `https://api.maptiler.com/maps/${maptiler.slug}/style.json?key=${key}`;
  }
  const pmtilesUrl = process.env.NEXT_PUBLIC_PMTILES_URL;
  if (pmtilesUrl) {
    try {
      return await buildPmtilesStyle(pmtilesUrl);
    } catch {
      return "/styles/dark-style.json";
    }
  }
  return "/styles/dark-style.json";
}

// The countries GeoJSON is re-added to every new style; cache the parsed
// payload so a basemap switch reinstalls the source from memory instead of
// re-fetching the multi-megabyte file.
let cachedCountries: FeatureCollection | null = null;
let countriesFetchStarted = false;

export function primeCountriesCache() {
  if (countriesFetchStarted) return;
  countriesFetchStarted = true;
  fetch("/data/countries.geojson")
    .then((response) => (response.ok ? response.json() : null))
    .then((data: FeatureCollection | null) => {
      if (data) cachedCountries = data;
      else countriesFetchStarted = false;
    })
    .catch(() => {
      countriesFetchStarted = false;
    });
}

/** The cached countries payload, or null if it has not arrived yet (the first
 * style load then falls back to the URL form). */
export function getCachedCountries(): FeatureCollection | null {
  return cachedCountries;
}

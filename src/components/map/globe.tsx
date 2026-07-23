"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import "maplibre-gl/dist/maplibre-gl.css";
import "./map.css";

import type {
  Map as MlMap,
  MapMouseEvent,
  Popup as MlPopup,
  StyleSpecification,
  RasterSourceSpecification,
  LngLatBoundsLike,
  GeoJSONFeature,
  GeoJSONSource,
  MapGeoJSONFeature,
} from "maplibre-gl";
import type { FeatureCollection, LineString, Point } from "geojson";

import { formatDateRange } from "@/lib/format";
import { boundsOfPoints, greatCirclePoints } from "@/lib/geo";
import { buildReplayTimeline } from "@/lib/replay";
import { cn } from "@/lib/utils";
import { Lightbox } from "@/components/photos/lightbox";
import { FixLocationDialog } from "@/components/photos/fix-location-dialog";
import { UnlocatedPhotosModal } from "./unlocated-photos-modal";
import type { UnlocatedPhoto } from "@/lib/photo-map-data";
import { MapControls, type BasemapOption } from "./projection-toggle";
import {
  TRAVEL_LAYERS,
  VISITED_BORDER,
  boundsOfFeature,
  hexToRgb,
  matchFilter,
  readBrandHex,
  rgbToHex,
} from "./map-utils";
import { ReplayControls } from "./replay-controls";
import { useReplay } from "./use-replay";
import { usePhotoMode, type GlobePhoto } from "./use-photo-mode";
import { useAttractions, type AttractionPoi } from "./use-attractions";

type Projection = "globe" | "mercator";

/** One entry in a style's layers array, derived to avoid extra type imports. */
type StyleLayerSpec = StyleSpecification["layers"][number];

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

export interface GlobeProps {
  visitedCountryCodes: string[];
  /** Countries the user wants to visit, shown in a distinct amber fill. */
  bucketCountryCodes?: string[];
  /** Countries reached only by planned trips, shown as a dashed outline. */
  plannedCountryCodes?: string[];
  destinations: GlobeDestination[];
  arcs: GlobeArc[];
  /** Place-type bucket items, shown as amber pins. */
  bucketPlaces?: GlobeBucketPlace[];
  /** Clicking a bucket place pin's action button reports the place. */
  onExplorePlace?: (place: GlobeBucketPlace) => void;
  /** Label of the bucket pin popup action. Default "Explore". */
  explorePlaceLabel?: string;
  /** Camera target: each new value flies the map to it (e.g. search results). */
  focus?: { lat: number; lng: number; zoom?: number } | null;
  /** Slowly spin the globe while idle. Default true (landing hero). */
  autoRotate?: boolean;
  /** Fit the camera to the destinations on load. Default false (full globe). */
  fitToData?: boolean;
  /** Add dates and a detail link to the pin popup. Default false. */
  enableDestinationLinks?: boolean;
  /** Clicking a visited country flies to it and reports the selection. */
  enableCountryDrilldown?: boolean;
  onCountrySelect?: (selection: GlobeCountrySelection | null) => void;
  /** Clicking an unvisited country flies to it and reports it for discovery. */
  enableDiscovery?: boolean;
  onDiscoverCountry?: (selection: GlobeCountrySelection | null) => void;
  /** When provided, shows a refresh control that re-fetches the map data. */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Show the Replay control and enable timeline playback. Default false. */
  enableReplay?: boolean;
  /** Fired when replay mode starts or ends, so hosts can hide their overlays. */
  onReplayActiveChange?: (active: boolean) => void;
  /** Mappable photos. When non-empty, the Photos toggle enters photo map
   * mode: travel layers hide and clustered photo thumbnails take the stage. */
  photos?: GlobePhoto[];
  /** Photos with no resolvable location, surfaced in the mode header. */
  photoUnlocatedCount?: number;
  /** The unlocated photos themselves, opened as an off-map grid from the
   * header when present. */
  unlocatedPhotos?: UnlocatedPhoto[];
  /** Fired when photo mode starts or ends, so hosts can hide their overlays. */
  onPhotoModeActiveChange?: (active: boolean) => void;
  /** Authenticated photo management: enables the lightbox's gallery link and
   * Fix location action, plus assign/delete in the unlocated grid. Omit on
   * read-only surfaces (demo, share). */
  photoManagement?: {
    destinations: { id: string; name: string }[];
    isDemo: boolean;
  };
  /** When provided, enables the "Show attractions" explore layer: viewport
   * Wikipedia geosearch markers that open in the host's discovery panel. */
  onOpenAttraction?: (poi: AttractionPoi) => void;
  /** When provided, shows the fullscreen toggle in the control cluster. The
   * host owns the fullscreen state and container styling. */
  onFullscreenToggle?: () => void;
  fullscreen?: boolean;
}

// Dim amber for "want to visit" countries: distinct from visited (blue) and
// unvisited (dark gray) without competing with the brand accent.
const BUCKET_FILL = "#b45309";
// Amber pin colours for place-type bucket items.
const BUCKET_PIN_FILL = "#b45309";
const BUCKET_PIN_STROKE = "#fbbf24";
// Hollow core for planned-trip pins: reads as "not yet filled in".
const PLANNED_PIN_CORE = "#111318";
const ROTATION_DEG_PER_SEC = 3;
const IDLE_BEFORE_RESUME_MS = 5000;
const PIN_RADIUS = 6;
const PIN_RADIUS_HOVER = 8.5;
// Intermediate points per arc, so the line follows the great circle smoothly.
const ARC_SEGMENTS = 48;

function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

function destinationsFC(
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

function arcsFC(arcs: GlobeArc[]): FeatureCollection<LineString> {
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
      properties: { tripName: arc.tripName, planned: arc.planned ?? false },
    })),
  };
}

function bucketPlacesFC(places: GlobeBucketPlace[]): FeatureCollection<Point> {
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

// --- Basemap styles ----------------------------------------------------------
//
// The dark minimal style is the brand default and needs zero keys, so a fresh
// deploy never regresses. Detailed styles (real zoom detail past where the dark
// PMTiles raster goes gray) come from MapTiler and only appear when
// NEXT_PUBLIC_MAPTILER_KEY is set; without it the switcher hides those options
// (and hides entirely, since only the one style remains).

const BASEMAP_STORAGE_KEY = "batchport:basemap";

// Per-style overlay treatment. The dark minimal style carries the full-strength
// brand fills (there is no underlying detail to bury); detailed basemaps drop
// the fills to a light tint with clearer borders so streets, imagery, and
// terrain stay readable underneath. Light styles also get a dark halo behind
// the white-core pins, which otherwise vanish against pale terrain.
interface OverlayTheme {
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

function overlayTheme(basemapId: string): OverlayTheme {
  return OVERLAY_THEMES[basemapId] ?? OVERLAY_THEMES.dark;
}

// Zoom depth per basemap: the keyless dark style has no detail past country
// shapes, so zooming further just shows empty space; MapTiler styles carry
// real street-level detail down to z19 (past the photo clustering max of 14,
// so photo stacks fully unstack at street level).
function maxZoomForBasemap(id: string): number {
  return MAPTILER_STYLES.some((style) => style.id === id) &&
    process.env.NEXT_PUBLIC_MAPTILER_KEY
    ? 19
    : 10;
}

// The countries GeoJSON is re-added to every new style; cache the parsed
// payload so a basemap switch reinstalls the source from memory instead of
// re-fetching the multi-megabyte file.
let cachedCountries: unknown | null = null;
let countriesFetchStarted = false;
function primeCountriesCache() {
  if (countriesFetchStarted) return;
  countriesFetchStarted = true;
  fetch("/data/countries.geojson")
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      if (data) cachedCountries = data;
      else countriesFetchStarted = false;
    })
    .catch(() => {
      countriesFetchStarted = false;
    });
}

// MapTiler style slugs. Dark-leaning where a dark variant exists, to stay on
// brand; satellite uses "hybrid" so imagery keeps place labels.
const MAPTILER_STYLES: { id: string; label: string; slug: string }[] = [
  { id: "streets", label: "Streets", slug: "streets-v2-dark" },
  { id: "satellite", label: "Satellite", slug: "hybrid" },
  { id: "terrain", label: "Terrain", slug: "outdoor-v2" },
];

/** The basemaps offered in the switcher. Always includes the keyless dark
 * default; adds the MapTiler styles only when a key is configured. */
function availableBasemaps(): BasemapOption[] {
  const list: BasemapOption[] = [{ id: "dark", label: "Dark" }];
  if (process.env.NEXT_PUBLIC_MAPTILER_KEY) {
    for (const style of MAPTILER_STYLES) {
      list.push({ id: style.id, label: style.label });
    }
  }
  return list;
}

/** Resolve a basemap id to a MapLibre style. Unknown ids and the "dark" id both
 * resolve to the dark style (PMTiles raster when configured, else the bundled
 * JSON), so a missing key or a stale persisted id always degrades safely. */
async function resolveBasemapStyle(
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

export function Globe({
  visitedCountryCodes,
  bucketCountryCodes = [],
  plannedCountryCodes = [],
  destinations,
  arcs,
  bucketPlaces = [],
  onExplorePlace,
  explorePlaceLabel = "Explore",
  focus = null,
  autoRotate = true,
  fitToData = false,
  enableDestinationLinks = false,
  enableCountryDrilldown = false,
  onCountrySelect,
  enableDiscovery = false,
  onDiscoverCountry,
  onRefresh,
  refreshing = false,
  enableReplay = false,
  onReplayActiveChange,
  photos = [],
  photoUnlocatedCount = 0,
  unlocatedPhotos = [],
  onPhotoModeActiveChange,
  photoManagement,
  onOpenAttraction,
  onFullscreenToggle,
  fullscreen = false,
}: GlobeProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const loadedRef = useRef(false);
  const [projection, setProjection] = useState<Projection>("globe");
  // Mirrors the projection state for the replay engine (restore on exit).
  const projectionRef = useRef<Projection>("globe");
  // Read by the map's hover/click handlers so interactions go inert in replay.
  const replayActiveRef = useRef(false);
  // Same for photo map mode: country hover/click stand down while it is on.
  const photoActiveRef = useRef(false);
  // The photo stack open in the lightbox: indices into photos, plus a cursor.
  const [photoLightbox, setPhotoLightbox] = useState<{
    indices: number[];
    index: number;
  } | null>(null);
  // The off-map grid of photos that have no location to pin, opened from the
  // photo mode header.
  const [unlocatedOpen, setUnlocatedOpen] = useState(false);
  // The photo whose location is being manually fixed from the map lightbox.
  const [fixLocationId, setFixLocationId] = useState<string | null>(null);
  // Mirrored for the lightbox key handler (registered once per lightbox open):
  // while the fix dialog is up, Escape belongs to the dialog, not the lightbox.
  const fixLocationOpenRef = useRef(false);
  useEffect(() => {
    fixLocationOpenRef.current = fixLocationId !== null;
  }, [fixLocationId]);
  // The active basemap id and the list offered in the switcher. The list is
  // stable per session (it only depends on the MapTiler key env var).
  const basemaps = useMemo(() => availableBasemaps(), []);
  const [basemap, setBasemap] = useState("dark");
  // True from a basemap switch until the new style's tiles settle, so the
  // brief tile load reads as intentional rather than a broken map.
  const [styleLoading, setStyleLoading] = useState(false);
  // The style-switch routine, defined inside the one-time map effect and read
  // by the switcher control.
  const applyBasemapRef = useRef<(id: string) => void>(() => {});
  // Photo mode's re-attach, mirrored so the map effect (which reinstalls
  // overlays after a style switch) can restore the photo layers without a stale
  // closure.
  const photoReattachRef = useRef<() => void>(() => {});

  const replayTimeline = useMemo(
    () => (enableReplay ? buildReplayTimeline(destinations) : null),
    [enableReplay, destinations],
  );

  function applyProjection(next: Projection) {
    mapRef.current?.setProjection({ type: next });
    projectionRef.current = next;
    setProjection(next);
  }

  const replay = useReplay({
    mapRef,
    timeline: replayTimeline,
    projectionRef,
    applyProjection,
    activeRef: replayActiveRef,
    onActiveChange: onReplayActiveChange,
  });

  const photoMode = usePhotoMode({
    mapRef,
    photos,
    activeRef: photoActiveRef,
    onActiveChange: (active) => {
      onPhotoModeActiveChange?.(active);
      if (!active) {
        setPhotoLightbox(null);
        setUnlocatedOpen(false);
      }
    },
    onOpenGroup: (indices) => setPhotoLightbox({ indices, index: 0 }),
  });
  useEffect(() => {
    photoReattachRef.current = photoMode.reattach;
  });

  // The optional attractions explore layer. It stands down whenever another
  // mode takes the globe (photo map, replay) and its toggle hides with them.
  const attractions = useAttractions({
    mapRef,
    enabled: Boolean(onOpenAttraction),
    onOpen: (poi) => onOpenAttraction?.(poi),
  });
  const attractionsDisableRef = useRef(attractions.disable);
  useEffect(() => {
    attractionsDisableRef.current = attractions.disable;
  });
  useEffect(() => {
    if (photoMode.active || replay.active) attractionsDisableRef.current();
  }, [photoMode.active, replay.active]);

  // Lightbox keyboard handling lives with the host (the Lightbox component is
  // presentation-only): Escape closes, arrows step through the stack.
  useEffect(() => {
    if (!photoLightbox) return;
    function onKey(event: KeyboardEvent) {
      if (fixLocationOpenRef.current) return;
      if (event.key === "Escape") setPhotoLightbox(null);
      if (event.key === "ArrowRight") stepPhotoLightbox(1);
      if (event.key === "ArrowLeft") stepPhotoLightbox(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // stepPhotoLightbox is stable in behaviour (pure setState updater).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoLightbox !== null]);

  function stepPhotoLightbox(delta: number) {
    setPhotoLightbox((current) => {
      if (!current) return current;
      const total = current.indices.length;
      return { ...current, index: (current.index + delta + total) % total };
    });
  }

  // Mirror the latest props so the one-time map effect always reads fresh
  // values without rebuilding the map.
  const dataRef = useRef({
    visitedCountryCodes,
    bucketCountryCodes,
    plannedCountryCodes,
    destinations,
    arcs,
    bucketPlaces,
    onExplorePlace,
    autoRotate,
    fitToData,
    enableDestinationLinks,
    enableCountryDrilldown,
    onCountrySelect,
    enableDiscovery,
    onDiscoverCountry,
    explorePlaceLabel,
  });
  useEffect(() => {
    dataRef.current = {
      visitedCountryCodes,
      bucketCountryCodes,
      plannedCountryCodes,
      destinations,
      arcs,
      bucketPlaces,
      onExplorePlace,
      autoRotate,
      fitToData,
      enableDestinationLinks,
      enableCountryDrilldown,
      onCountrySelect,
      enableDiscovery,
      onDiscoverCountry,
      explorePlaceLabel,
    };
  });

  // Keep the GeoJSON sources in sync when the data props change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const brandHex = readBrandHex();
    const destSource = map.getSource("destinations") as
      | GeoJSONSource
      | undefined;
    const arcSource = map.getSource("arcs") as GeoJSONSource | undefined;
    const bucketSource = map.getSource("bucket-places") as
      | GeoJSONSource
      | undefined;
    destSource?.setData(destinationsFC(destinations, brandHex));
    arcSource?.setData(arcsFC(arcs));
    bucketSource?.setData(bucketPlacesFC(bucketPlaces));
  }, [destinations, arcs, bucketPlaces]);

  // Fly to a requested focus target (search results, explored places) so the
  // camera lands where the panel's content is.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !focus) return;
    map.flyTo({
      center: [focus.lng, focus.lat],
      zoom: focus.zoom ?? 4,
      duration: 1400,
    });
  }, [focus]);

  // Keep the country fill filters in sync so a new bucket list country turns
  // amber (and a newly visited one turns blue) without rebuilding the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !map.getLayer("country-visited")) return;
    const visitedFilter = matchFilter(visitedCountryCodes);
    const visited = new Set(visitedCountryCodes);
    // The amber fill only paints countries that are not already visited; the
    // unfiltered list also feeds the discovery panel's bucket state.
    map.setFilter(
      "country-bucket",
      matchFilter(bucketCountryCodes.filter((code) => !visited.has(code))),
    );
    map.setFilter("country-visited", visitedFilter);
    map.setFilter("country-visited-outline", visitedFilter);
    if (map.getLayer("country-planned-outline")) {
      map.setFilter("country-planned-outline", matchFilter(plannedCountryCodes));
    }
  }, [visitedCountryCodes, bucketCountryCodes, plannedCountryCodes]);

  function handleToggle() {
    if (!mapRef.current) return;
    applyProjection(projection === "globe" ? "mercator" : "globe");
  }

  function fitToDestinations(duration: number) {
    const map = mapRef.current;
    if (!map) return;
    const bounds = boundsOfPoints(
      dataRef.current.destinations.map(
        (d) => [d.lng, d.lat] as [number, number],
      ),
    );
    if (!bounds) return;
    const isPoint = bounds[0] === bounds[2] && bounds[1] === bounds[3];
    if (isPoint) {
      map.flyTo({ center: [bounds[0], bounds[1]], zoom: 4, duration });
    } else {
      map.fitBounds(bounds as LngLatBoundsLike, {
        padding: 64,
        maxZoom: 5,
        duration,
      });
    }
  }

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let map: MlMap | null = null;
    let popup: MlPopup | null = null;
    let maplibregl: typeof import("maplibre-gl") | null = null;
    let protocolRegistered = false;

    let hoveredCountryId: number | string | null = null;
    let hoveredPinId: number | string | null = null;
    // The active basemap id, read by installOverlays for the per-style
    // overlay theme and zoom cap. Set before setStyle so the style.load
    // reinstall sees the new id.
    let currentBasemapId = "dark";
    let lastInteraction = 0;
    let lastFrame = 0;

    const brand = hexToRgb(readBrandHex());
    const brandHex = rgbToHex(brand);
    const brandFillCss = `rgba(${brand[0]}, ${brand[1]}, ${brand[2]}, 1)`;

    // Destination count per country code, for the visited-country tooltip.
    const destCountByCode = new Map<string, number>();
    for (const destination of dataRef.current.destinations) {
      if (!destination.countryCode) continue;
      destCountByCode.set(
        destination.countryCode,
        (destCountByCode.get(destination.countryCode) ?? 0) + 1,
      );
    }

    // Inline SVG flag for popup HTML (emoji flags render as bare letters on
    // Windows). The code is validated before being interpolated.
    function flagImgHtml(code: string): string {
      if (!/^[A-Za-z]{2}$/.test(code)) return "";
      return `<img src="https://flagcdn.com/${code.toLowerCase()}.svg" alt="" style="height:11px;width:auto;border-radius:2px;vertical-align:-1px;margin-right:4px" />`;
    }

    function showPinPopupFromFeature(feature: MapGeoJSONFeature) {
      if (!maplibregl || !map) return;
      const props = feature.properties ?? {};
      const name = String(props.name ?? "");
      const countryCode = String(props.countryCode ?? "");
      const tripName = String(props.tripName ?? "");
      const tripId = String(props.tripId ?? "");
      const destId = String(props.destId ?? "");
      const arrivalDate = props.arrivalDate ? String(props.arrivalDate) : null;
      const departureDate = props.departureDate
        ? String(props.departureDate)
        : null;
      const geometry = feature.geometry;
      if (geometry.type !== "Point") return;
      const [lng, lat] = geometry.coordinates as [number, number];

      const countryHtml = countryCode
        ? `${flagImgHtml(countryCode)}${escapeHtml(countryCode)}`
        : "";
      const dates = formatDateRange(arrivalDate, departureDate);
      const linkHtml = dataRef.current.enableDestinationLinks
        ? `<a href="/trips/${tripId}/destinations/${destId}" style="display:inline-block;margin-top:8px;color:var(--brand,#3b82f6);font-weight:600;font-size:0.75rem">View details</a>`
        : "";
      const datesHtml =
        dataRef.current.enableDestinationLinks && dates
          ? `<div style="margin-top:4px;color:#8b8b94;font-size:0.75rem">${escapeHtml(
              dates,
            )}</div>`
          : "";
      const html = `
        <div>
          <div style="font-weight:600;color:#f4f4f5">${escapeHtml(name)}</div>
          <div style="color:#a1a1aa">${countryHtml}</div>
          <div style="margin-top:4px;color:#8b8b94;font-size:0.75rem">${escapeHtml(
            tripName,
          )}</div>
          ${datesHtml}
          ${linkHtml}
        </div>`;
      popup?.remove();
      popup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: true,
        className: "batchport-popup",
        offset: 14,
        maxWidth: "260px",
      })
        .setLngLat([lng, lat])
        .setHTML(html)
        .addTo(map);
    }

    // Popup for an amber bucket place pin: the place name, its country, and
    // (when the host wires onExplorePlace, i.e. the dashboard) an Explore
    // button that opens the discovery city view.
    function showBucketPopupFromFeature(feature: MapGeoJSONFeature) {
      if (!maplibregl || !map) return;
      const props = feature.properties ?? {};
      const name = String(props.name ?? "");
      const countryCode = String(props.countryCode ?? "");
      const lat = Number(props.lat);
      const lng = Number(props.lng);
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const container = document.createElement("div");
      const title = document.createElement("div");
      title.style.cssText = "font-weight:600;color:#f4f4f5";
      title.textContent = name;
      container.appendChild(title);
      const subtitle = document.createElement("div");
      subtitle.style.cssText = "color:#a1a1aa";
      subtitle.innerHTML = countryCode
        ? `${flagImgHtml(countryCode)}${escapeHtml(countryCode)} · Bucket list`
        : "Bucket list";
      container.appendChild(subtitle);

      const explore = dataRef.current.onExplorePlace;
      if (explore && countryCode) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = dataRef.current.explorePlaceLabel;
        button.style.cssText =
          "display:inline-block;margin-top:8px;color:var(--brand,#3b82f6);font-weight:600;font-size:0.75rem;background:none;border:none;padding:0;cursor:pointer";
        button.addEventListener("click", () => {
          popup?.remove();
          explore({
            id: String(props.placeId ?? ""),
            name,
            countryCode,
            lat,
            lng,
          });
        });
        container.appendChild(button);
      }

      popup?.remove();
      popup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: true,
        className: "batchport-popup",
        offset: 12,
        maxWidth: "240px",
      })
        .setLngLat([lng, lat])
        .setDOMContent(container)
        .addTo(map);
    }

    function showTooltip(x: number, y: number, text: string, hint?: string) {
      const el = tooltipRef.current;
      if (!el) return;
      el.textContent = text;
      if (hint) {
        const hintEl = document.createElement("div");
        hintEl.className = "text-[10px] font-normal text-foreground/50";
        hintEl.textContent = hint;
        el.appendChild(hintEl);
      }
      el.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
      el.style.display = "block";
    }

    function hideTooltip() {
      const el = tooltipRef.current;
      if (el) el.style.display = "none";
    }

    function clearCountryHover() {
      if (map && hoveredCountryId !== null) {
        map.setFeatureState(
          { source: "countries", id: hoveredCountryId },
          { hover: false },
        );
      }
      hoveredCountryId = null;
    }

    function clearPinHover() {
      if (map && hoveredPinId !== null) {
        map.setFeatureState(
          { source: "destinations", id: hoveredPinId },
          { hover: false },
        );
      }
      hoveredPinId = null;
    }

    function onMouseMove(event: MapMouseEvent) {
      if (!map) return;

      // Replay and photo modes: the globe is a stage, not a control surface.
      if (replayActiveRef.current || photoActiveRef.current) {
        clearPinHover();
        clearCountryHover();
        hideTooltip();
        map.getCanvas().style.cursor = "";
        return;
      }

      // Pins (destination and bucket place) win over country hover.
      const pinLayers = ["pins", "bucket-pins"].filter((layer) =>
        map?.getLayer(layer),
      );
      const pinFeatures =
        pinLayers.length > 0
          ? map.queryRenderedFeatures(event.point, { layers: pinLayers })
          : [];
      if (pinFeatures.length > 0) {
        const feature = pinFeatures[0];
        const isBucketPin = feature.layer?.id === "bucket-pins";
        if (isBucketPin) {
          clearPinHover();
        } else {
          const nextId = feature.id ?? null;
          if (nextId !== hoveredPinId) {
            clearPinHover();
            hoveredPinId = nextId;
            if (nextId !== null) {
              map.setFeatureState(
                { source: "destinations", id: nextId },
                { hover: true },
              );
            }
          }
        }
        clearCountryHover();
        const name = String(feature.properties?.name ?? "");
        const planned = feature.properties?.planned === true;
        showTooltip(
          event.point.x,
          event.point.y,
          name,
          isBucketPin ? "On your bucket list" : planned ? "Planned trip" : undefined,
        );
        map.getCanvas().style.cursor = "pointer";
        return;
      }
      clearPinHover();

      // The layer can be briefly absent mid basemap switch (between setStyle
      // wiping the old style and style.load reinstalling the overlays).
      const features = map.getLayer("country-fill")
        ? map.queryRenderedFeatures(event.point, { layers: ["country-fill"] })
        : [];
      const feature = features[0];
      if (!feature || feature.id === undefined) {
        clearCountryHover();
        hideTooltip();
        map.getCanvas().style.cursor = "";
        return;
      }
      if (hoveredCountryId !== null && hoveredCountryId !== feature.id) {
        map.setFeatureState(
          { source: "countries", id: hoveredCountryId },
          { hover: false },
        );
      }
      hoveredCountryId = feature.id;
      map.setFeatureState(
        { source: "countries", id: hoveredCountryId },
        { hover: true },
      );
      const name =
        (feature.properties?.NAME as string | undefined) ??
        (feature.properties?.ADMIN as string | undefined) ??
        "";
      const code = feature.properties?.ISO_A2_EH as string | undefined;
      const count = code ? destCountByCode.get(code) ?? 0 : 0;
      const text =
        count > 0
          ? `${name} · ${count} ${count === 1 ? "destination" : "destinations"}`
          : name;
      // Countries whose click would open discovery get a hint and a pointer:
      // unvisited ones always, and visited ones too on discovery-only hosts
      // (the map picker) where no drill-down competes for the click.
      const discoverable =
        dataRef.current.enableDiscovery &&
        Boolean(code) &&
        (!dataRef.current.visitedCountryCodes.includes(code as string) ||
          !dataRef.current.enableCountryDrilldown);
      showTooltip(
        event.point.x,
        event.point.y,
        text,
        discoverable ? "Click to explore" : undefined,
      );
      map.getCanvas().style.cursor =
        count > 0 || discoverable ? "pointer" : "default";
    }

    function onMouseOut() {
      clearCountryHover();
      clearPinHover();
      hideTooltip();
    }

    function flyToFeature(feature: GeoJSONFeature) {
      if (!map) return;
      const bounds = boundsOfFeature(feature);
      if (!bounds) return;
      map.fitBounds(bounds as LngLatBoundsLike, {
        padding: 80,
        maxZoom: 5,
        duration: 1200,
      });
    }

    function onMapClick(event: MapMouseEvent) {
      if (!map) return;

      // Country clicks and pin popups are inert during replay and photo mode
      // (photo layers register their own click handlers).
      if (replayActiveRef.current || photoActiveRef.current) return;

      // A click on a pin opens its popup and never doubles as a country select.
      const pinLayers = ["pins", "bucket-pins"].filter((layer) =>
        map?.getLayer(layer),
      );
      if (pinLayers.length > 0) {
        const pinFeatures = map.queryRenderedFeatures(event.point, {
          layers: pinLayers,
        });
        if (pinFeatures.length > 0) {
          const feature = pinFeatures[0];
          if (feature.layer?.id === "bucket-pins") {
            showBucketPopupFromFeature(feature);
          } else {
            showPinPopupFromFeature(feature);
          }
          return;
        }
      }

      const {
        onCountrySelect: select,
        onDiscoverCountry: discover,
        enableCountryDrilldown,
        enableDiscovery,
        visitedCountryCodes: visited,
      } = dataRef.current;

      // Resolve the clicked country from the all-countries fill layer, then
      // route it: visited countries open the drill-down, unvisited ones open
      // discovery. Anything else (ocean, no code) closes both panels.
      const features = map.getLayer("country-fill")
        ? map.queryRenderedFeatures(event.point, { layers: ["country-fill"] })
        : [];
      const feature = features[0];
      const code = feature?.properties?.ISO_A2_EH as string | undefined;
      const name =
        (feature?.properties?.NAME as string | undefined) ??
        (feature?.properties?.ADMIN as string | undefined) ??
        "";
      if (!feature || !code) {
        select?.(null);
        discover?.(null);
        return;
      }
      if (visited.includes(code)) {
        if (enableCountryDrilldown) {
          flyToFeature(feature);
          select?.({ code, name });
        } else if (enableDiscovery) {
          // Discovery-only hosts (the map destination picker) treat every
          // country alike: visited ones surface their cities too.
          flyToFeature(feature);
          discover?.({ code, name });
        } else {
          select?.(null);
          discover?.(null);
        }
        return;
      }
      if (enableDiscovery) {
        flyToFeature(feature);
        discover?.({ code, name });
        return;
      }
      select?.(null);
      discover?.(null);
    }

    function markInteraction() {
      lastInteraction = performance.now();
    }

    function frame(now: number) {
      if (!map) return;
      if (
        dataRef.current.autoRotate &&
        !replayActiveRef.current &&
        !photoActiveRef.current &&
        lastFrame > 0 &&
        now - lastInteraction > IDLE_BEFORE_RESUME_MS
      ) {
        const delta = (now - lastFrame) / 1000;
        const center = map.getCenter();
        map.setCenter([
          wrapLng(center.lng + ROTATION_DEG_PER_SEC * delta),
          center.lat,
        ]);
      }
      lastFrame = now;
      if (!dataRef.current.autoRotate) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(frame);
    }

    // Sky and atmosphere, re-applied after every style (initial load or a
    // later basemap switch, which resets style-level settings).
    function applySky() {
      if (!map) return;
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
    // layers; MapTiler basemaps do not. Add them when missing (transparent land
    // so imagery shows through but stays hoverable, subtle borders) so country
    // hover, click, and the visited/bucket fills work on every basemap.
    function ensureCountriesBase() {
      if (!map) return;
      if (!map.getSource("countries")) {
        map.addSource("countries", {
          type: "geojson",
          // The module-level cache makes basemap switches reinstall from
          // memory; the URL form only runs on the very first style load.
          data:
            (cachedCountries as FeatureCollection | null) ??
            "/data/countries.geojson",
          generateId: true,
        });
      }
      // On detailed basemaps the country layers (and the visited/bucket fills
      // anchored beneath country-outline) slot in under the style's own label
      // layers, so place names and native POI labels render above the tint.
      // The dark style keeps its original stacking untouched.
      const beforeLabels =
        currentBasemapId === "dark"
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

    // Install every runtime overlay (country fills, arcs, pins, bucket pins) on
    // top of the current style. Called on first load and re-called after a
    // basemap switch wipes all non-style sources and layers. The existence
    // guards keep it safe to call more than once and preserve the intended
    // z-order (fills beneath the country border, pins and arcs on top).
    function installOverlays() {
      if (!map) return;
      ensureCountriesBase();

      const theme = overlayTheme(currentBasemapId);
      const visitedFilter = matchFilter(dataRef.current.visitedCountryCodes);
      const visitedSet = new Set(dataRef.current.visitedCountryCodes);
      const bucketFilter = matchFilter(
        dataRef.current.bucketCountryCodes.filter(
          (code) => !visitedSet.has(code),
        ),
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
            paint: { "fill-color": BUCKET_FILL, "fill-opacity": theme.bucketOpacity },
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

      // Planned trips: countries get a dashed brand-blue outline with no fill,
      // so upcoming travel is visible but clearly not yet visited.
      if (!map.getLayer("country-planned-outline")) {
        map.addLayer({
          id: "country-planned-outline",
          type: "line",
          source: "countries",
          filter: matchFilter(dataRef.current.plannedCountryCodes),
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
        map.addSource("arcs", {
          type: "geojson",
          data: arcsFC(dataRef.current.arcs),
        });
      }
      if (!map.getSource("destinations")) {
        map.addSource("destinations", {
          type: "geojson",
          data: destinationsFC(dataRef.current.destinations, brandHex),
        });
      }

      // Completed/ongoing legs: solid with a glow. Planned legs: dashed, no
      // glow, slightly dimmer.
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

      // Amber pins for place-type bucket items, drawn beneath destination pins
      // so real stops win overlaps.
      if (!map.getSource("bucket-places")) {
        map.addSource("bucket-places", {
          type: "geojson",
          data: bucketPlacesFC(dataRef.current.bucketPlaces),
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
      // Contrast halo behind destination pins on light basemaps: the white
      // core and pale category strokes vanish against bright terrain without
      // a dark ring underneath.
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
            "circle-color": [
              "case",
              ["get", "planned"],
              PLANNED_PIN_CORE,
              "#ffffff",
            ],
            "circle-stroke-color": ["get", "color"],
            "circle-stroke-width": ["case", ["get", "planned"], 2, 2.5],
            "circle-opacity": ["case", ["get", "planned"], 0.9, 1],
          },
        });
      }
    }

    // Re-establish everything a style switch resets: sky, projection, all
    // overlays, and whichever alternate mode currently owns the globe. Preserves
    // photo map mode (its layers are re-added) and replay (travel layers stay
    // hidden) so a basemap change never breaks the active view.
    function reinstallAfterStyle() {
      if (!map) return;
      applySky();
      map.setProjection({ type: projectionRef.current });
      installOverlays();
      if (photoActiveRef.current) {
        photoReattachRef.current();
      } else if (replayActiveRef.current) {
        for (const id of TRAVEL_LAYERS) {
          if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
        }
      }
    }

    // Switch the basemap: persist the choice and swap the style. The persistent
    // style.load handler registered in init reinstalls every overlay once the
    // new style is ready, so this function only needs to kick off the swap.
    // Resolving to an unknown or key-less id falls back to the dark style, so
    // this never blanks the map.
    function applyBasemap(id: string) {
      if (!map) return;
      try {
        sessionStorage.setItem(BASEMAP_STORAGE_KEY, id);
      } catch {
        // Non-fatal: the choice just will not persist across reloads.
      }
      currentBasemapId = id;
      setBasemap(id);
      setStyleLoading(true);
      void resolveBasemapStyle(id).then((nextStyle) => {
        if (cancelled || !map) return;
        map.setMaxZoom(maxZoomForBasemap(id));
        // diff:false forces a clean swap: every runtime source/layer is wiped
        // and deterministically re-added on style.load, rather than relying on
        // MapLibre's diff to preserve them across very different styles.
        map.setStyle(nextStyle, { diff: false });
      });
    }

    async function init() {
      const maplibreModule = await import("maplibre-gl");
      const { Protocol } = await import("pmtiles");
      if (cancelled || !containerRef.current) return;

      const ml = maplibreModule;
      maplibregl = ml;

      // Register the PMTiles protocol up front whenever a PMTiles URL is
      // configured, regardless of the starting basemap, so switching back to
      // the dark PMTiles style later still resolves.
      const pmtilesUrl = process.env.NEXT_PUBLIC_PMTILES_URL;
      if (pmtilesUrl) {
        const protocol = new Protocol();
        ml.addProtocol("pmtiles", protocol.tile);
        protocolRegistered = true;
      }

      // Restore the per-session basemap choice (falling back to dark), then
      // resolve its style for the initial render.
      let initialBasemap = "dark";
      try {
        const saved = sessionStorage.getItem(BASEMAP_STORAGE_KEY);
        if (saved && availableBasemaps().some((option) => option.id === saved)) {
          initialBasemap = saved;
        }
      } catch {
        // sessionStorage may be unavailable (private mode); keep the default.
      }
      currentBasemapId = initialBasemap;
      setBasemap(initialBasemap);
      primeCountriesCache();
      const style = await resolveBasemapStyle(initialBasemap);
      if (cancelled) return;

      // Start centred on the user's data when fitting, so the fly-in is short.
      let center: [number, number] = [8, 28];
      let zoom = 1.4;
      const dataBounds = boundsOfPoints(
        dataRef.current.destinations.map(
          (d) => [d.lng, d.lat] as [number, number],
        ),
      );
      if (dataRef.current.fitToData && dataBounds) {
        center = [
          (dataBounds[0] + dataBounds[2]) / 2,
          (dataBounds[1] + dataBounds[3]) / 2,
        ];
        zoom = 1.8;
      }

      const m = new ml.Map({
        container: containerRef.current,
        style,
        center,
        zoom,
        minZoom: 0.5,
        maxZoom: maxZoomForBasemap(initialBasemap),
        attributionControl: false,
      });
      map = m;
      mapRef.current = m;

      m.addControl(new ml.AttributionControl({ compact: true }), "bottom-left");

      // Reinstall the overlays after every basemap switch. style.load fires
      // exactly once per style, at the moment addSource/addLayer are safe
      // again. (Waiting for styledata gated on isStyleLoaded() does not work:
      // isStyleLoaded() stays false while the new style's tiles are still
      // loading, so the guard can reject every styledata firing and the
      // reinstall then never runs.) loadedRef skips the initial style load,
      // which the load handler below installs.
      m.on("style.load", () => {
        if (cancelled || !map || !loadedRef.current) return;
        try {
          reinstallAfterStyle();
        } catch (error) {
          console.error("BatchPort globe: overlay reinstall failed", error);
        }
        // Clear the switch loading cue once the new style's tiles settle.
        // idle can be starved on a busy map, so a timeout backstops it.
        const clear = () => setStyleLoading(false);
        map.once("idle", clear);
        window.setTimeout(clear, 8000);
      });

      m.on("load", () => {
        if (cancelled || !map) return;

        map.setProjection({ type: projectionRef.current });
        applySky();
        installOverlays();

        map.on("mousemove", onMouseMove);
        map.on("mouseout", onMouseOut);
        map.on("click", onMapClick);

        if (dataRef.current.fitToData && dataBounds) {
          fitToDestinations(1200);
        }

        loadedRef.current = true;
        // The switcher control becomes live only once the map is loaded.
        applyBasemapRef.current = applyBasemap;

        if (dataRef.current.autoRotate) {
          raf = requestAnimationFrame(frame);
        }
      });

      m.on("mousedown", markInteraction);
      m.on("wheel", markInteraction);
      m.on("touchstart", markInteraction);
      m.on("drag", markInteraction);
      m.on("zoom", markInteraction);
      m.on("rotate", markInteraction);
      m.on("pitch", markInteraction);
    }

    void init();

    return () => {
      cancelled = true;
      loadedRef.current = false;
      if (raf) cancelAnimationFrame(raf);
      popup?.remove();
      map?.remove();
      if (protocolRegistered && maplibregl) {
        try {
          maplibregl.removeProtocol("pmtiles");
        } catch {
          // Protocol may already be removed.
        }
      }
      mapRef.current = null;
    };
    // The map is built once; live data and handlers are read from dataRef.
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="absolute inset-0 size-full overflow-hidden bg-[#0d0d0d]"
    >
      <div ref={containerRef} className="absolute inset-0 size-full" />
      <div
        ref={tooltipRef}
        className="pointer-events-none absolute left-0 top-0 z-20 hidden rounded-md border border-white/10 bg-black/80 px-2 py-1 text-xs font-medium text-foreground/90 shadow-md backdrop-blur-sm"
      />
      {styleLoading ? (
        <div className="pointer-events-none absolute bottom-10 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-black/70 px-3.5 py-1.5 text-xs font-medium text-foreground/80 shadow-md backdrop-blur-md">
          <span className="size-3 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          Loading map style...
        </div>
      ) : null}
      {photoMode.active ? (
        <div
          className={cn(
            "pointer-events-none absolute left-4 z-20 flex flex-wrap items-center gap-x-2 rounded-full border border-white/10 bg-black/60 px-3.5 py-1.5 text-xs font-medium text-foreground/80 shadow-md backdrop-blur-md",
            fullscreen ? "top-[max(1rem,env(safe-area-inset-top))]" : "top-4",
          )}
        >
          <span>
            {photos.length} {photos.length === 1 ? "photo" : "photos"} on the
            map
          </span>
          {photoUnlocatedCount > 0 ? (
            unlocatedPhotos.length > 0 ? (
              <button
                type="button"
                onClick={() => setUnlocatedOpen(true)}
                className="pointer-events-auto rounded-full px-1.5 text-foreground/50 underline decoration-foreground/20 underline-offset-2 transition-colors hover:text-foreground hover:decoration-foreground/50"
              >
                {photoUnlocatedCount} without location
              </button>
            ) : (
              <span className="text-foreground/40">
                {photoUnlocatedCount} without location
              </span>
            )
          ) : null}
        </div>
      ) : null}

      {photoMode.active && unlocatedOpen && unlocatedPhotos.length > 0 ? (
        <UnlocatedPhotosModal
          photos={unlocatedPhotos}
          destinations={photoManagement?.destinations}
          isDemo={photoManagement?.isDemo ?? false}
          onChanged={onRefresh}
          onClose={() => setUnlocatedOpen(false)}
        />
      ) : null}
      {!replay.active ? (
        <MapControls
          projection={projection}
          onToggle={handleToggle}
          onRecenter={
            destinations.length > 0 ? () => fitToDestinations(900) : undefined
          }
          onRefresh={onRefresh}
          refreshing={refreshing}
          onReplay={
            replayTimeline
              ? () => {
                  // Only one mode owns the globe at a time.
                  photoMode.exit();
                  replay.enter();
                }
              : undefined
          }
          onPhotoToggle={photos.length > 0 ? photoMode.toggle : undefined}
          photoModeActive={photoMode.active}
          onAttractionsToggle={
            onOpenAttraction && !photoMode.active
              ? attractions.toggle
              : undefined
          }
          attractionsActive={attractions.active}
          basemaps={basemaps}
          activeBasemap={basemap}
          onBasemapChange={(id) => applyBasemapRef.current(id)}
          onFullscreenToggle={onFullscreenToggle}
          fullscreen={fullscreen}
        />
      ) : (
        <ReplayControls
          playing={replay.playing}
          ended={replay.ended}
          speed={replay.speed}
          attach={replay.attach}
          onTogglePlay={replay.togglePlay}
          onToggleSpeed={replay.toggleSpeed}
          onRestart={replay.restart}
          onExit={replay.exit}
          onScrubStart={replay.scrubStart}
          onScrub={replay.scrubMove}
          onScrubEnd={replay.scrubEnd}
        />
      )}

      {photoLightbox
        ? (() => {
            const photo = photos[photoLightbox.indices[photoLightbox.index]];
            if (!photo) return null;
            const caption =
              [photo.destinationName, photo.tripName]
                .filter(Boolean)
                .join(" · ") || null;
            // Authenticated surfaces: link to the owning gallery page (where
            // full editing lives) and offer the manual location fix.
            const galleryHref =
              photoManagement && photo.tripId
                ? photo.destinationId
                  ? `/trips/${photo.tripId}/destinations/${photo.destinationId}`
                  : `/trips/${photo.tripId}`
                : null;
            const galleryLabel = photo.destinationId
              ? `View in ${photo.destinationName ?? "destination"}`
              : `View in ${photo.tripName ?? "trip"}`;
            const actions = photoManagement ? (
              <>
                {galleryHref ? (
                  <Link
                    href={galleryHref}
                    className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white/90 transition-colors hover:bg-white/20"
                  >
                    {galleryLabel}
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={() => setFixLocationId(photo.id)}
                  className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white/90 transition-colors hover:bg-white/20"
                >
                  Fix location
                </button>
              </>
            ) : undefined;
            return (
              <Lightbox
                item={{
                  src: photo.fullUrl,
                  dateTaken: photo.dateTaken,
                  attribution: photo.attribution,
                  caption,
                }}
                index={photoLightbox.index}
                total={photoLightbox.indices.length}
                onPrev={() => stepPhotoLightbox(-1)}
                onNext={() => stepPhotoLightbox(1)}
                onClose={() => setPhotoLightbox(null)}
                actions={actions}
              />
            );
          })()
        : null}

      {fixLocationId && photoManagement ? (
        <FixLocationDialog
          photoId={fixLocationId}
          destinations={photoManagement.destinations}
          isDemo={photoManagement.isDemo}
          onDone={() => {
            setFixLocationId(null);
            // The stack indices may shift once the photo moves; close the
            // lightbox and let the refreshed data redraw the markers.
            setPhotoLightbox(null);
            onRefresh?.();
          }}
          onCancel={() => setFixLocationId(null)}
        />
      ) : null}
    </div>
  );
}

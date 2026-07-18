"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
import { MapControls } from "./projection-toggle";
import {
  VISITED_BORDER,
  boundsOfFeature,
  hexToRgb,
  matchFilter,
  readBrandHex,
  rgbToHex,
} from "./map-utils";
import { ReplayControls } from "./replay-controls";
import { useReplay } from "./use-replay";

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

      // Replay mode: the globe is a stage, not a control surface.
      if (replayActiveRef.current) {
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

      const features = map.queryRenderedFeatures(event.point, {
        layers: ["country-fill"],
      });
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

      // Country clicks and pin popups are inert during replay.
      if (replayActiveRef.current) return;

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

    async function init() {
      const maplibreModule = await import("maplibre-gl");
      const { Protocol } = await import("pmtiles");
      if (cancelled || !containerRef.current) return;

      const ml = maplibreModule;
      maplibregl = ml;

      const pmtilesUrl = process.env.NEXT_PUBLIC_PMTILES_URL;
      let style: string | StyleSpecification = "/styles/dark-style.json";
      if (pmtilesUrl) {
        const protocol = new Protocol();
        ml.addProtocol("pmtiles", protocol.tile);
        protocolRegistered = true;
        try {
          style = await buildPmtilesStyle(pmtilesUrl);
        } catch {
          style = "/styles/dark-style.json";
        }
        if (cancelled) return;
      }

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
        maxZoom: 12,
        attributionControl: false,
      });
      map = m;
      mapRef.current = m;

      m.addControl(new ml.AttributionControl({ compact: true }), "bottom-left");

      m.on("load", () => {
        if (cancelled || !map) return;

        map.setProjection({ type: "globe" });

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

        const visitedFilter = matchFilter(dataRef.current.visitedCountryCodes);
        const visitedSet = new Set(dataRef.current.visitedCountryCodes);
        const bucketFilter = matchFilter(
          dataRef.current.bucketCountryCodes.filter(
            (code) => !visitedSet.has(code),
          ),
        );

        // Want-to-visit fill (dim amber), drawn beneath the visited fill.
        map.addLayer(
          {
            id: "country-bucket",
            type: "fill",
            source: "countries",
            filter: bucketFilter,
            paint: { "fill-color": BUCKET_FILL, "fill-opacity": 0.25 },
          },
          "country-outline",
        );

        // Visited country fill (brand blue), under the outline so borders stay
        // crisp; brightens on hover.
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
                0.72,
                0.55,
              ],
            },
          },
          "country-outline",
        );

        map.addLayer({
          id: "country-visited-outline",
          type: "line",
          source: "countries",
          filter: visitedFilter,
          paint: {
            "line-color": VISITED_BORDER,
            "line-width": 1,
            "line-opacity": 0.9,
          },
        });

        // Planned trips: countries get a dashed brand-blue outline with no
        // fill, so upcoming travel is visible but clearly not yet visited.
        map.addLayer({
          id: "country-planned-outline",
          type: "line",
          source: "countries",
          filter: matchFilter(dataRef.current.plannedCountryCodes),
          paint: {
            "line-color": VISITED_BORDER,
            "line-width": 1.5,
            "line-opacity": 0.85,
            "line-dasharray": [2, 2],
          },
        });

        // Native pins and arcs: rendered by MapLibre so they stay locked to
        // their coordinates on both globe and mercator projections.
        map.addSource("arcs", {
          type: "geojson",
          data: arcsFC(dataRef.current.arcs),
        });
        map.addSource("destinations", {
          type: "geojson",
          data: destinationsFC(dataRef.current.destinations, brandHex),
        });

        // Completed/ongoing legs: solid with a glow. Planned legs: dashed,
        // no glow, slightly dimmer.
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

        // Amber pins for place-type bucket items, drawn beneath destination
        // pins so real stops win overlaps.
        map.addSource("bucket-places", {
          type: "geojson",
          data: bucketPlacesFC(dataRef.current.bucketPlaces),
        });
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

        // Glow only behind real (non-planned) stops.
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
        // One pins layer for both states: planned stops swap the white core
        // for a dark one, reading as a hollow ring in the trip's colour.
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

        map.on("mousemove", onMouseMove);
        map.on("mouseout", onMouseOut);
        map.on("click", onMapClick);

        if (dataRef.current.fitToData && dataBounds) {
          fitToDestinations(1200);
        }

        loadedRef.current = true;

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
      {!replay.active ? (
        <MapControls
          projection={projection}
          onToggle={handleToggle}
          onRecenter={
            destinations.length > 0 ? () => fitToDestinations(900) : undefined
          }
          onRefresh={onRefresh}
          refreshing={refreshing}
          onReplay={replayTimeline ? replay.enter : undefined}
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
    </div>
  );
}

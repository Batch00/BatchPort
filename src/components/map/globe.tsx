"use client";

import { useEffect, useRef, useState } from "react";

import "maplibre-gl/dist/maplibre-gl.css";
import "./map.css";

import type {
  Map as MlMap,
  MapMouseEvent,
  Popup as MlPopup,
  StyleSpecification,
  RasterSourceSpecification,
  FilterSpecification,
  LngLatBoundsLike,
  GeoJSONFeature,
  GeoJSONSource,
  MapGeoJSONFeature,
} from "maplibre-gl";
import type { FeatureCollection, LineString, Point } from "geojson";

import { flagEmoji, formatDateRange } from "@/lib/format";
import { MapControls } from "./projection-toggle";

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
}

/** A great-circle leg between two consecutive stops on a trip. */
export interface GlobeArc {
  sourcePosition: [number, number];
  targetPosition: [number, number];
  tripName: string;
  sourceCity: string;
  targetCity: string;
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
  destinations: GlobeDestination[];
  arcs: GlobeArc[];
  /** Slowly spin the globe while idle. Default true (landing hero). */
  autoRotate?: boolean;
  /** Fit the camera to the destinations on load. Default false (full globe). */
  fitToData?: boolean;
  /** Add dates and a detail link to the pin popup. Default false. */
  enableDestinationLinks?: boolean;
  /** Clicking a visited country flies to it and reports the selection. */
  enableCountryDrilldown?: boolean;
  onCountrySelect?: (selection: GlobeCountrySelection | null) => void;
  /** When provided, shows a refresh control that re-fetches the map data. */
  onRefresh?: () => void;
  refreshing?: boolean;
}

const BRAND_FALLBACK = "#2563eb";
const VISITED_BORDER = "#4a8af5";
// Dim amber for "want to visit" countries: distinct from visited (blue) and
// unvisited (dark gray) without competing with the brand accent.
const BUCKET_FILL = "#b45309";
const ROTATION_DEG_PER_SEC = 3;
const IDLE_BEFORE_RESUME_MS = 5000;
const PIN_RADIUS = 6;
const PIN_RADIUS_HOVER = 8.5;
// Intermediate points per arc, so the line follows the great circle smoothly.
const ARC_SEGMENTS = 48;

function hexToRgb(hex: string): [number, number, number] {
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

function rgbToHex([r, g, b]: [number, number, number]): string {
  const channel = (c: number) =>
    Math.max(0, Math.min(255, Math.round(c)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** The brand colour as a hex string, read from CSS so it tracks the theme. */
function readBrandHex(): string {
  if (typeof window === "undefined") return BRAND_FALLBACK;
  const fromCss = getComputedStyle(document.documentElement)
    .getPropertyValue("--brand")
    .trim();
  if (!fromCss) return BRAND_FALLBACK;
  if (fromCss.startsWith("#")) return rgbToHex(hexToRgb(fromCss));
  return fromCss;
}

function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

// Spherical interpolation of the great-circle path between two lng/lat points.
// Longitudes are unwrapped so the line stays continuous across the antimeridian.
function greatCirclePoints(
  a: [number, number],
  b: [number, number],
  segments: number,
): [number, number][] {
  const lng1 = toRad(a[0]);
  const lat1 = toRad(a[1]);
  const lng2 = toRad(b[0]);
  const lat2 = toRad(b[1]);

  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2,
      ),
    );

  if (d === 0 || Number.isNaN(d)) {
    return [
      [a[0], a[1]],
      [b[0], b[1]],
    ];
  }

  const points: [number, number][] = [];
  let prevLng: number | null = null;
  for (let i = 0; i <= segments; i += 1) {
    const f = i / segments;
    const aCoef = Math.sin((1 - f) * d) / Math.sin(d);
    const bCoef = Math.sin(f * d) / Math.sin(d);
    const x =
      aCoef * Math.cos(lat1) * Math.cos(lng1) +
      bCoef * Math.cos(lat2) * Math.cos(lng2);
    const y =
      aCoef * Math.cos(lat1) * Math.sin(lng1) +
      bCoef * Math.cos(lat2) * Math.sin(lng2);
    const z = aCoef * Math.sin(lat1) + bCoef * Math.sin(lat2);
    const lat = toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)));
    let lng = toDeg(Math.atan2(y, x));
    if (prevLng !== null) {
      while (lng - prevLng > 180) lng -= 360;
      while (lng - prevLng < -180) lng += 360;
    }
    prevLng = lng;
    points.push([lng, lat]);
  }
  return points;
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
      properties: { tripName: arc.tripName },
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

/** Bounding box [minLng, minLat, maxLng, maxLat] of a set of [lng, lat] pairs. */
function boundsOfPoints(
  points: [number, number][],
): [number, number, number, number] | null {
  if (points.length === 0) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of points) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLng, minLat, maxLng, maxLat];
}

/** Bounding box of a clicked country feature's polygon geometry. */
function boundsOfFeature(
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
  destinations,
  arcs,
  autoRotate = true,
  fitToData = false,
  enableDestinationLinks = false,
  enableCountryDrilldown = false,
  onCountrySelect,
  onRefresh,
  refreshing = false,
}: GlobeProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const loadedRef = useRef(false);
  const [projection, setProjection] = useState<Projection>("globe");

  // Mirror the latest props so the one-time map effect always reads fresh
  // values without rebuilding the map.
  const dataRef = useRef({
    visitedCountryCodes,
    bucketCountryCodes,
    destinations,
    arcs,
    autoRotate,
    fitToData,
    enableDestinationLinks,
    enableCountryDrilldown,
    onCountrySelect,
  });
  useEffect(() => {
    dataRef.current = {
      visitedCountryCodes,
      bucketCountryCodes,
      destinations,
      arcs,
      autoRotate,
      fitToData,
      enableDestinationLinks,
      enableCountryDrilldown,
      onCountrySelect,
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
    destSource?.setData(destinationsFC(destinations, brandHex));
    arcSource?.setData(arcsFC(arcs));
  }, [destinations, arcs]);

  function handleToggle() {
    const map = mapRef.current;
    if (!map) return;
    const next: Projection = projection === "globe" ? "mercator" : "globe";
    map.setProjection({ type: next });
    setProjection(next);
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

    // Match expression comparing ISO_A2_EH against a code list.
    function matchFilter(codes: string[]): FilterSpecification {
      return [
        "match",
        ["get", "ISO_A2_EH"],
        codes.length > 0 ? codes : [" "],
        true,
        false,
      ] as unknown as FilterSpecification;
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

      const country = countryCode
        ? `${flagEmoji(countryCode)} ${countryCode}`
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
          <div style="color:#a1a1aa">${escapeHtml(country)}</div>
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

    function showTooltip(x: number, y: number, text: string) {
      const el = tooltipRef.current;
      if (!el) return;
      el.textContent = text;
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

      // Pins win over country hover.
      const pinFeatures = map.getLayer("pins")
        ? map.queryRenderedFeatures(event.point, { layers: ["pins"] })
        : [];
      if (pinFeatures.length > 0) {
        const feature = pinFeatures[0];
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
        clearCountryHover();
        const name = String(feature.properties?.name ?? "");
        showTooltip(event.point.x, event.point.y, name);
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
      showTooltip(event.point.x, event.point.y, text);
      map.getCanvas().style.cursor = count > 0 ? "pointer" : "default";
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

      // A click on a pin opens its popup and never doubles as a country select.
      if (map.getLayer("pins")) {
        const pinFeatures = map.queryRenderedFeatures(event.point, {
          layers: ["pins"],
        });
        if (pinFeatures.length > 0) {
          showPinPopupFromFeature(pinFeatures[0]);
          return;
        }
      }

      const select = dataRef.current.onCountrySelect;
      if (!dataRef.current.enableCountryDrilldown) {
        select?.(null);
        return;
      }
      if (!map.getLayer("country-visited")) {
        select?.(null);
        return;
      }
      const features = map.queryRenderedFeatures(event.point, {
        layers: ["country-visited"],
      });
      const feature = features[0];
      if (!feature) {
        select?.(null);
        return;
      }
      const code = feature.properties?.ISO_A2_EH as string | undefined;
      const name =
        (feature.properties?.NAME as string | undefined) ??
        (feature.properties?.ADMIN as string | undefined) ??
        "";
      if (!code) {
        select?.(null);
        return;
      }
      flyToFeature(feature);
      select?.({ code, name });
    }

    function markInteraction() {
      lastInteraction = performance.now();
    }

    function frame(now: number) {
      if (!map) return;
      if (
        dataRef.current.autoRotate &&
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
        const bucketFilter = matchFilter(dataRef.current.bucketCountryCodes);

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

        map.addLayer({
          id: "trip-arcs-glow",
          type: "line",
          source: "arcs",
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
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": brandHex,
            "line-width": 2.5,
            "line-opacity": 0.9,
          },
        });

        map.addLayer({
          id: "pins-glow",
          type: "circle",
          source: "destinations",
          paint: {
            "circle-radius": 14,
            "circle-color": ["get", "color"],
            "circle-opacity": 0.4,
            "circle-blur": 1,
          },
        });
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
            "circle-color": "#ffffff",
            "circle-stroke-color": ["get", "color"],
            "circle-stroke-width": 2.5,
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
      <MapControls
        projection={projection}
        onToggle={handleToggle}
        onRecenter={
          destinations.length > 0 ? () => fitToDestinations(900) : undefined
        }
        onRefresh={onRefresh}
        refreshing={refreshing}
      />
    </div>
  );
}

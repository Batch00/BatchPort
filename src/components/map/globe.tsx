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
} from "maplibre-gl";
import type { Layer, PickingInfo } from "@deck.gl/core";
import type { MapboxOverlay as DeckOverlay } from "@deck.gl/mapbox";

import { flagEmoji, formatDateRange } from "@/lib/format";
import { ProjectionToggle } from "./projection-toggle";

type Projection = "globe" | "mercator";

/** One entry in a style's layers array, derived to avoid extra type imports. */
type StyleLayerSpec = StyleSpecification["layers"][number];

/** A single mappable stop. Positions are [lng, lat] to match deck.gl. */
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
}

const BRAND_FALLBACK = "#2563eb";
const VISITED_BORDER = "#4a8af5";
// Dim amber for "want to visit" countries: distinct from visited (blue) and
// unvisited (dark gray) without competing with the brand accent.
const BUCKET_FILL = "#b45309";
const ROTATION_DEG_PER_SEC = 3;
const IDLE_BEFORE_RESUME_MS = 5000;
const ARC_DRAW_MS = 2200;
const PIN_RADIUS = 4.5;
const PIN_RADIUS_HOVER = 6.5;

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

function readBrandRgb(): [number, number, number] {
  if (typeof window === "undefined") return hexToRgb(BRAND_FALLBACK);
  const fromCss = getComputedStyle(document.documentElement)
    .getPropertyValue("--brand")
    .trim();
  return hexToRgb(fromCss || BRAND_FALLBACK);
}

function rgbCss([r, g, b]: [number, number, number], alpha = 1): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Mix a colour toward black for the dimmer target end of an arc gradient. */
function darken([r, g, b]: [number, number, number], amount: number): [number, number, number] {
  return [
    Math.round(r * (1 - amount)),
    Math.round(g * (1 - amount)),
    Math.round(b * (1 - amount)),
  ];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Bounding box [minLng, minLat, maxLng, maxLat] of a set of [lng, lat] pairs. */
function boundsOfPoints(points: [number, number][]): [number, number, number, number] | null {
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
function boundsOfFeature(feature: GeoJSONFeature): [number, number, number, number] | null {
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
async function buildPmtilesStyle(pmtilesUrl: string): Promise<StyleSpecification> {
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
}: GlobeProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [projection, setProjection] = useState<Projection>("globe");

  // Mirror the latest props/handlers so the one-time map effect always reads
  // fresh values without tearing down and rebuilding the map on every render.
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
  // Keep the mirror current for subsequent renders without touching the ref
  // during render (the map effect below reads dataRef, never re-creating).
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

  function handleToggle() {
    const map = mapRef.current;
    if (!map) return;
    const next: Projection = projection === "globe" ? "mercator" : "globe";
    map.setProjection({ type: next });
    setProjection(next);
  }

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let map: MlMap | null = null;
    let popup: MlPopup | null = null;
    let overlay: DeckOverlay | null = null;
    let maplibregl: typeof import("maplibre-gl") | null = null;
    let protocolRegistered = false;

    let hoveredCountryId: number | string | null = null;
    let hoveredPinId: string | null = null;
    let lastInteraction = 0;
    let lastFrame = 0;
    let arcStart = 0;
    let arcProgress = 0;
    let arcsSettled = false;

    const brand = readBrandRgb();
    const brandFillCss = rgbCss(brand);
    const brandTarget = darken(brand, 0.45);

    // Destination count per country code, for the visited-country tooltip.
    const destCountByCode = new Map<string, number>();
    for (const destination of dataRef.current.destinations) {
      if (!destination.countryCode) continue;
      destCountByCode.set(
        destination.countryCode,
        (destCountByCode.get(destination.countryCode) ?? 0) + 1,
      );
    }

    // Leg count per trip, so arcs on longer trips render a touch thicker.
    const arcCountByTrip = new Map<string, number>();
    for (const arc of dataRef.current.arcs) {
      arcCountByTrip.set(arc.tripName, (arcCountByTrip.get(arc.tripName) ?? 0) + 1);
    }
    function arcWidth(arc: GlobeArc): number {
      return 2 + Math.min((arcCountByTrip.get(arc.tripName) ?? 1) - 1, 4) * 0.25;
    }

    // Keep only visited countries. A match expression compares ISO_A2_EH
    // against the visited codes. MapLibre expression literals do not infer to
    // the spec tuple types, so we assert the shape.
    const visitedFilter = [
      "match",
      ["get", "ISO_A2_EH"],
      dataRef.current.visitedCountryCodes.length > 0
        ? dataRef.current.visitedCountryCodes
        : [" "],
      true,
      false,
    ] as unknown as FilterSpecification;

    // Same match shape for the "want to visit" countries.
    const bucketFilter = [
      "match",
      ["get", "ISO_A2_EH"],
      dataRef.current.bucketCountryCodes.length > 0
        ? dataRef.current.bucketCountryCodes
        : [" "],
      true,
      false,
    ] as unknown as FilterSpecification;

    function colorWithAlpha(
      rgb: [number, number, number],
      alpha: number,
    ): [number, number, number, number] {
      return [rgb[0], rgb[1], rgb[2], alpha];
    }

    function pinColor(destination: GlobeDestination): [number, number, number] {
      return destination.categoryColor
        ? hexToRgb(destination.categoryColor)
        : brand;
    }

    function buildLayers(ScatterplotLayer: typeof import("@deck.gl/layers").ScatterplotLayer, ArcLayer: typeof import("@deck.gl/layers").ArcLayer): Layer[] {
      const { arcs: arcData, destinations: pins } = dataRef.current;
      const eased = easeOutCubic(arcProgress);

      // Wide, faint arc underneath for a subtle glow.
      const arcGlow = new ArcLayer<GlobeArc>({
        id: "trip-arcs-glow",
        data: arcData,
        greatCircle: true,
        getSourcePosition: (d) => d.sourcePosition,
        getTargetPosition: (d) => [
          lerp(d.sourcePosition[0], d.targetPosition[0], eased),
          lerp(d.sourcePosition[1], d.targetPosition[1], eased),
        ],
        getSourceColor: colorWithAlpha(brand, 60),
        getTargetColor: colorWithAlpha(brandTarget, 30),
        getWidth: (d) => arcWidth(d) + 4,
        widthUnits: "pixels",
        pickable: false,
        updateTriggers: { getTargetPosition: eased },
      });

      // Bright-to-dim gradient arc on top.
      const arcLayer = new ArcLayer<GlobeArc>({
        id: "trip-arcs",
        data: arcData,
        greatCircle: true,
        getSourcePosition: (d) => d.sourcePosition,
        getTargetPosition: (d) => [
          lerp(d.sourcePosition[0], d.targetPosition[0], eased),
          lerp(d.sourcePosition[1], d.targetPosition[1], eased),
        ],
        getSourceColor: colorWithAlpha(brand, 235),
        getTargetColor: colorWithAlpha(brandTarget, 150),
        getWidth: (d) => arcWidth(d),
        widthUnits: "pixels",
        pickable: false,
        updateTriggers: { getTargetPosition: eased },
      });

      const glowLayer = new ScatterplotLayer<GlobeDestination>({
        id: "pins-glow",
        data: pins,
        getPosition: (d) => [d.lng, d.lat],
        getFillColor: (d) => colorWithAlpha(pinColor(d), 55),
        getRadius: 13,
        radiusUnits: "pixels",
        pickable: false,
      });

      const coreLayer = new ScatterplotLayer<GlobeDestination>({
        id: "pins",
        data: pins,
        getPosition: (d) => [d.lng, d.lat],
        getFillColor: [255, 255, 255, 255],
        getLineColor: (d) => colorWithAlpha(pinColor(d), 255),
        getRadius: (d) => (d.id === hoveredPinId ? PIN_RADIUS_HOVER : PIN_RADIUS),
        radiusUnits: "pixels",
        stroked: true,
        getLineWidth: 1.5,
        lineWidthUnits: "pixels",
        pickable: true,
        onClick: (info: PickingInfo<GlobeDestination>) => {
          showPinPopup(info.object);
          return true;
        },
        updateTriggers: { getRadius: hoveredPinId },
      });

      return [arcGlow, arcLayer, glowLayer, coreLayer];
    }

    function pushLayers() {
      if (!overlay || !scatterRef || !arcRef) return;
      overlay.setProps({ layers: buildLayers(scatterRef, arcRef) });
    }

    let scatterRef: typeof import("@deck.gl/layers").ScatterplotLayer | null = null;
    let arcRef: typeof import("@deck.gl/layers").ArcLayer | null = null;

    function showPinPopup(destination?: GlobeDestination | null) {
      if (!destination || !maplibregl || !map) return;
      const country = destination.countryCode
        ? `${flagEmoji(destination.countryCode)} ${destination.countryCode}`
        : "";
      const dates = formatDateRange(
        destination.arrivalDate,
        destination.departureDate,
      );
      const linkHtml = dataRef.current.enableDestinationLinks
        ? `<a href="/trips/${destination.tripId}/destinations/${destination.id}" style="display:inline-block;margin-top:8px;color:var(--brand,#3b82f6);font-weight:600;font-size:0.75rem">View details</a>`
        : "";
      const datesHtml = dataRef.current.enableDestinationLinks && dates
        ? `<div style="margin-top:4px;color:#8b8b94;font-size:0.75rem">${escapeHtml(dates)}</div>`
        : "";
      const html = `
        <div>
          <div style="font-weight:600;color:#f4f4f5">${escapeHtml(destination.name)}</div>
          <div style="color:#a1a1aa">${escapeHtml(country)}</div>
          <div style="margin-top:4px;color:#8b8b94;font-size:0.75rem">${escapeHtml(destination.tripName)}</div>
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
        .setLngLat([destination.lng, destination.lat])
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

    function onMouseMove(event: MapMouseEvent) {
      if (!map) return;
      // A hovered pin (tracked by the deck onHover handler) wins over country
      // hover so the tooltip and cursor reflect the pin.
      if (hoveredPinId !== null) {
        clearCountryHover();
        return;
      }
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
      if (hoveredPinId === null) hideTooltip();
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
      // A pin under the pointer is handled by its deck onClick; do not let the
      // click double as a country select or a drill-down dismiss.
      const pinHit = overlay?.pickObject({
        x: event.point.x,
        y: event.point.y,
        radius: 6,
        layerIds: ["pins"],
      });
      if (pinHit?.object) return;

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

      if (overlay && arcStart > 0 && !arcsSettled) {
        arcProgress = Math.min((now - arcStart) / ARC_DRAW_MS, 1);
        pushLayers();
        if (arcProgress >= 1) arcsSettled = true;
      }

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

      // Once arcs have settled and there is nothing to animate, stop the loop.
      if (arcsSettled && !dataRef.current.autoRotate) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(frame);
    }

    async function init() {
      const maplibreModule = await import("maplibre-gl");
      const { MapboxOverlay } = await import("@deck.gl/mapbox");
      const { ScatterplotLayer, ArcLayer } = await import("@deck.gl/layers");
      const { Protocol } = await import("pmtiles");
      if (cancelled || !containerRef.current) return;

      scatterRef = ScatterplotLayer;
      arcRef = ArcLayer;
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
        dataRef.current.destinations.map((d) => [d.lng, d.lat] as [number, number]),
      );
      if (dataRef.current.fitToData && dataBounds) {
        center = [(dataBounds[0] + dataBounds[2]) / 2, (dataBounds[1] + dataBounds[3]) / 2];
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

      function setupDeck() {
        try {
          const deck = new MapboxOverlay({ interleaved: true, layers: [] });
          m.addControl(deck);
          overlay = deck;
          arcStart = performance.now();
          // Track pin hover here: it fires only on change, so it is cheaper
          // than picking on every mouse move.
          deck.setProps({
            onHover: (info: PickingInfo) => {
              if (info.layer?.id !== "pins") {
                if (hoveredPinId !== null) {
                  hoveredPinId = null;
                  hideTooltip();
                  pushLayers();
                  if (map) map.getCanvas().style.cursor = "";
                }
                return;
              }
              const object = info.object as GlobeDestination | undefined;
              const nextId = object?.id ?? null;
              if (nextId !== hoveredPinId) {
                hoveredPinId = nextId;
                pushLayers();
              }
              if (object) {
                showTooltip(info.x, info.y, object.name);
                if (map) map.getCanvas().style.cursor = "pointer";
              }
            },
          });
          pushLayers();
        } catch (error) {
          overlay = null;
          console.warn("BatchPort globe: deck.gl overlay disabled", error);
        }
      }

      m.on("load", () => {
        if (cancelled || !map) return;

        map.setProjection({ type: "globe" });

        // Subtle dark-blue atmosphere around the globe edge.
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

        // Want-to-visit fill (dim amber), drawn beneath the visited fill so a
        // country that is both visited and on the list still reads as visited.
        map.addLayer(
          {
            id: "country-bucket",
            type: "fill",
            source: "countries",
            filter: bucketFilter,
            paint: {
              "fill-color": BUCKET_FILL,
              "fill-opacity": 0.25,
            },
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

        // Lighter border around visited countries, drawn on top.
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

        map.on("mousemove", onMouseMove);
        map.on("mouseout", onMouseOut);
        map.on("click", onMapClick);

        // Fit to the user's data with padding once the style is ready.
        if (dataRef.current.fitToData && dataBounds) {
          const isPoint =
            dataBounds[0] === dataBounds[2] && dataBounds[1] === dataBounds[3];
          if (isPoint) {
            map.flyTo({ center: [dataBounds[0], dataBounds[1]], zoom: 4, duration: 1200 });
          } else {
            map.fitBounds(dataBounds as LngLatBoundsLike, {
              padding: 64,
              maxZoom: 5,
              duration: 1200,
            });
          }
        }

        setupDeck();
        raf = requestAnimationFrame(frame);
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
      if (raf) cancelAnimationFrame(raf);
      popup?.remove();
      if (map && overlay) {
        try {
          map.removeControl(overlay);
        } catch {
          // Overlay may already be detached during teardown.
        }
      }
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
      <ProjectionToggle projection={projection} onToggle={handleToggle} />
    </div>
  );
}

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
} from "maplibre-gl";
import type { Layer, PickingInfo } from "@deck.gl/core";
import type { MapboxOverlay as DeckOverlay } from "@deck.gl/mapbox";

import { ProjectionToggle } from "./projection-toggle";
import {
  destinations,
  tripsById,
  visitedCountryCodes,
  getDestinationPrimaryCategory,
  type Destination,
} from "@/lib/mock-travel-data";

type Projection = "globe" | "mercator";

/** One entry in a style's layers array, derived to avoid extra type imports. */
type StyleLayerSpec = StyleSpecification["layers"][number];

/** A single great-circle segment between two consecutive stops on a trip. */
interface ArcDatum {
  from: [number, number];
  to: [number, number];
  tripId: string;
}

const BRAND_FALLBACK = "#2563eb";
const ROTATION_DEG_PER_SEC = 3;
const IDLE_BEFORE_RESUME_MS = 5000;
const ARC_DRAW_MS = 2200;

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

/** Mix a color toward white for the subtle visited border. */
function lighten([r, g, b]: [number, number, number], amount: number): [number, number, number] {
  return [
    Math.round(r + (255 - r) * amount),
    Math.round(g + (255 - g) * amount),
    Math.round(b + (255 - b) * amount),
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

/** Build arcs between consecutive destinations within each trip. */
function buildArcs(): ArcDatum[] {
  const byTrip = new Map<string, Destination[]>();
  for (const destination of destinations) {
    const list = byTrip.get(destination.trip_id) ?? [];
    list.push(destination);
    byTrip.set(destination.trip_id, list);
  }

  const arcs: ArcDatum[] = [];
  for (const [tripId, list] of byTrip) {
    const ordered = [...list].sort((a, b) => a.order_index - b.order_index);
    for (let i = 0; i < ordered.length - 1; i += 1) {
      arcs.push({
        from: [ordered[i].longitude, ordered[i].latitude],
        to: [ordered[i + 1].longitude, ordered[i + 1].latitude],
        tripId,
      });
    }
  }
  return arcs;
}

const pinColorById = new Map<string, [number, number, number]>(
  destinations.map((destination) => [
    destination.id,
    hexToRgb(getDestinationPrimaryCategory(destination.id).color),
  ]),
);

/**
 * Option A base style: inject the PMTiles raster basemap into the dark style.
 * Assumes a raster PMTiles archive, which is schema agnostic and needs no key.
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

export function Globe() {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [projection, setProjection] = useState<Projection>("globe");

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

    let hoveredId: number | string | null = null;
    let lastInteraction = 0;
    let lastFrame = 0;
    let arcStart = 0;
    let arcsSettled = false;

    const arcs = buildArcs();
    const brand = readBrandRgb();
    const brandFillCss = rgbCss(brand);
    const brandBorderCss = rgbCss(lighten(brand, 0.45), 0.9);
    // MapLibre expression literals do not infer to the spec tuple types, so we
    // assert the shape. This filter keeps only visited countries.
    const visitedFilter = [
      "in",
      ["get", "ISO_A2_EH"],
      ["literal", visitedCountryCodes],
    ] as unknown as FilterSpecification;

    async function init() {
      const maplibreModule = await import("maplibre-gl");
      const { MapboxOverlay } = await import("@deck.gl/mapbox");
      const { ScatterplotLayer, ArcLayer } = await import("@deck.gl/layers");
      const { Protocol } = await import("pmtiles");
      if (cancelled || !containerRef.current) return;

      const ml = maplibreModule;
      maplibregl = ml;

      // Option A if a PMTiles URL is configured, otherwise the zero-service
      // dark fallback (Option B).
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

      const m = new ml.Map({
        container: containerRef.current,
        style,
        center: [8, 28],
        zoom: 1.4,
        minZoom: 0.5,
        maxZoom: 12,
        attributionControl: false,
      });
      map = m;
      mapRef.current = m;
      // The style starts in globe; set it explicitly so a fetched/PMTiles
      // style without a projection still opens as a globe.
      m.setProjection({ type: "globe" });

      m.addControl(
        new ml.AttributionControl({ compact: true }),
        "bottom-left",
      );

      overlay = new MapboxOverlay({ interleaved: true, layers: [] });
      m.addControl(overlay);

      function colorWithAlpha(
        rgb: [number, number, number],
        alpha: number,
      ): [number, number, number, number] {
        return [rgb[0], rgb[1], rgb[2], alpha];
      }

      function buildLayers(progress: number): Layer[] {
        const eased = easeOutCubic(progress);
        const arcLayer = new ArcLayer<ArcDatum>({
          id: "trip-arcs",
          data: arcs,
          greatCircle: true,
          getSourcePosition: (d) => d.from,
          getTargetPosition: (d) => [
            lerp(d.from[0], d.to[0], eased),
            lerp(d.from[1], d.to[1], eased),
          ],
          getSourceColor: colorWithAlpha(brand, 235),
          getTargetColor: colorWithAlpha(brand, 120),
          getWidth: 2.25,
          widthUnits: "pixels",
          updateTriggers: {
            getTargetPosition: eased,
          },
        });

        const glowLayer = new ScatterplotLayer<Destination>({
          id: "pins-glow",
          data: destinations,
          getPosition: (d) => [d.longitude, d.latitude],
          getFillColor: (d) =>
            colorWithAlpha(pinColorById.get(d.id) ?? brand, 55),
          getRadius: 13,
          radiusUnits: "pixels",
          pickable: false,
        });

        const coreLayer = new ScatterplotLayer<Destination>({
          id: "pins",
          data: destinations,
          getPosition: (d) => [d.longitude, d.latitude],
          getFillColor: (d) =>
            colorWithAlpha(pinColorById.get(d.id) ?? brand, 255),
          getRadius: 4.5,
          radiusUnits: "pixels",
          stroked: true,
          getLineColor: [255, 255, 255, 210],
          getLineWidth: 1,
          lineWidthUnits: "pixels",
          pickable: true,
          onClick: (info: PickingInfo<Destination>) => showPinPopup(info.object),
        });

        return [arcLayer, glowLayer, coreLayer];
      }

      function showPinPopup(destination?: Destination | null) {
        if (!destination || !maplibregl || !map) return;
        const trip = tripsById[destination.trip_id];
        const html = `
          <div class="space-y-0.5">
            <div style="font-weight:600;color:#f4f4f5">${destination.name}</div>
            <div style="color:#a1a1aa">${destination.country}</div>
            <div style="margin-top:4px;color:#8b8b94;font-size:0.75rem">${
              trip ? trip.name : ""
            }</div>
          </div>`;
        popup?.remove();
        popup = new maplibregl.Popup({
          closeButton: true,
          closeOnClick: true,
          className: "batchport-popup",
          offset: 14,
          maxWidth: "240px",
        })
          .setLngLat([destination.longitude, destination.latitude])
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

      function clearHover() {
        if (map && hoveredId !== null) {
          map.setFeatureState({ source: "countries", id: hoveredId }, { hover: false });
        }
        hoveredId = null;
      }

      function onMouseMove(event: MapMouseEvent) {
        if (!map) return;
        const features = map.queryRenderedFeatures(event.point, {
          layers: ["country-fill", "country-visited"],
        });
        const feature = features[0];
        if (!feature || feature.id === undefined) {
          clearHover();
          hideTooltip();
          map.getCanvas().style.cursor = "";
          return;
        }
        if (hoveredId !== null && hoveredId !== feature.id) {
          map.setFeatureState({ source: "countries", id: hoveredId }, { hover: false });
        }
        hoveredId = feature.id;
        map.setFeatureState({ source: "countries", id: hoveredId }, { hover: true });
        const name =
          (feature.properties?.NAME as string | undefined) ??
          (feature.properties?.ADMIN as string | undefined) ??
          "";
        showTooltip(event.point.x, event.point.y, name);
        map.getCanvas().style.cursor = "default";
      }

      function onMouseOut() {
        clearHover();
        hideTooltip();
      }

      function markInteraction() {
        lastInteraction = performance.now();
      }

      function frame(now: number) {
        if (!map || !overlay) return;

        if (arcStart > 0 && !arcsSettled) {
          const progress = Math.min((now - arcStart) / ARC_DRAW_MS, 1);
          overlay.setProps({ layers: buildLayers(progress) });
          if (progress >= 1) arcsSettled = true;
        }

        if (lastFrame > 0 && now - lastInteraction > IDLE_BEFORE_RESUME_MS) {
          const delta = (now - lastFrame) / 1000;
          const center = map.getCenter();
          map.setCenter([wrapLng(center.lng + ROTATION_DEG_PER_SEC * delta), center.lat]);
        }

        lastFrame = now;
        raf = requestAnimationFrame(frame);
      }

      m.on("load", () => {
        if (cancelled || !map) return;

        // Visited country fill (brand blue), inserted under the outline so the
        // borders stay crisp.
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
                0.78,
                0.58,
              ],
            },
          },
          "country-outline",
        );

        // Subtle lighter border around visited countries, drawn on top.
        map.addLayer({
          id: "country-visited-outline",
          type: "line",
          source: "countries",
          filter: visitedFilter,
          paint: {
            "line-color": brandBorderCss,
            "line-width": 0.8,
          },
        });

        // Hover interactions only after the country layers exist.
        map.on("mousemove", onMouseMove);
        map.on("mouseout", onMouseOut);

        arcStart = performance.now();
        overlay?.setProps({ layers: buildLayers(0) });
        raf = requestAnimationFrame(frame);
      });

      // Pause auto-rotation while the user is interacting. None of these fire
      // from the center-only rotation, so the loop resumes after 5s of idle.
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
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="absolute inset-0 size-full overflow-hidden bg-[#0a0a0a]"
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

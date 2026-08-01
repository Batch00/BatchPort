"use client";

// The globe's optional "Show attractions" explore layer: when toggled on, the
// viewport center is geosearched against Wikipedia (via /api/discover/geo,
// cached server-side in geocode_cache) once per move-settle, and up to ~15
// attraction markers render as small HTML markers. Clicking one opens the
// existing POI detail in the discovery panel.
//
// Request-frugal by design: a debounce coalesces consecutive settles, a
// client-side memo short-circuits repeat viewports, requests only fire at
// zoom >= MIN_ZOOM, and the server caches by rounded center + zoom band.

import { useEffect, useRef, useState, type RefObject } from "react";
import type { Map as MlMap, Marker as MlMarker } from "maplibre-gl";

const MIN_ZOOM = 10;
const DEBOUNCE_MS = 500;
const STORAGE_KEY = "batchport:attractions";

/** One attraction marker's payload, passed to the host when opened. */
export interface AttractionPoi {
  name: string;
  description: string | null;
  lat: number;
  lng: number;
  thumbnailUrl: string | null;
}

export interface AttractionsHandle {
  active: boolean;
  toggle: () => void;
  /** Turn the layer on without recording a preference. Nearby mode borrows the
   * layer for the duration of the mode; that is not the user choosing to keep
   * attractions on everywhere. */
  enable: () => void;
  /** Turn the layer off (mode changes: photo map, replay, nearby exit). */
  disable: () => void;
  /** The attractions currently on screen. Nearby mode reads these to prefill
   * the name of something logged where you are standing. */
  pois: AttractionPoi[];
}

// Inline landmark glyph so the marker needs no icon font at runtime.
const LANDMARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 18v-7"/><path d="M11.12 2.198a2 2 0 0 1 1.76.006l7.866 3.847c.476.233.31.949-.22.949H3.474c-.53 0-.695-.716-.22-.949z"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M3 22h18"/><path d="M6 18v-7"/></svg>';

export function useAttractions({
  mapRef,
  enabled: featureEnabled,
  onOpen,
}: {
  mapRef: RefObject<MlMap | null>;
  /** Whether the feature exists on this surface at all. */
  enabled: boolean;
  onOpen: (poi: AttractionPoi) => void;
}): AttractionsHandle {
  const [active, setActive] = useState(false);
  const [pois, setPois] = useState<AttractionPoi[]>([]);
  const activeRef = useRef(false);
  const markersRef = useRef<MlMarker[]>([]);
  const debounceRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const lastKeyRef = useRef("");
  const memoRef = useRef(new Map<string, AttractionPoi[]>());
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  });

  function clearMarkers() {
    for (const marker of markersRef.current) marker.remove();
    markersRef.current = [];
  }

  function markerElement(poi: AttractionPoi): HTMLElement {
    const el = document.createElement("button");
    el.type = "button";
    el.title = poi.description ? `${poi.name} · ${poi.description}` : poi.name;
    el.setAttribute("aria-label", poi.name);
    // position:absolute keeps the .maplibregl-marker anchoring rule intact
    // (same constraint as the photo mode markers).
    el.style.cssText =
      "position:absolute;width:24px;height:24px;padding:0;border-radius:50%;border:1.5px solid rgba(255,255,255,0.35);background:rgba(10,14,22,0.85);color:var(--brand,#2563eb);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.5)";
    el.innerHTML = LANDMARK_SVG;
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      onOpenRef.current(poi);
    });
    return el;
  }

  async function renderMarkers(list: AttractionPoi[]) {
    const map = mapRef.current;
    if (!map || !activeRef.current) return;
    const ml = await import("maplibre-gl");
    if (!activeRef.current) return;
    clearMarkers();
    setPois(list);
    for (const poi of list) {
      const marker = new ml.Marker({ element: markerElement(poi) })
        .setLngLat([poi.lng, poi.lat])
        .addTo(map);
      markersRef.current.push(marker);
    }
  }

  function fetchForViewport() {
    const map = mapRef.current;
    if (!map || !activeRef.current) return;
    const zoom = map.getZoom();
    if (zoom < MIN_ZOOM) {
      clearMarkers();
      setPois([]);
      lastKeyRef.current = "";
      return;
    }
    const center = map.getCenter();
    // Matches the server's cache granularity so panning inside one cache cell
    // never issues a second request.
    const round = zoom >= 12 ? 2 : 1;
    const band = zoom >= 14 ? "high" : zoom >= 12 ? "mid" : "low";
    const key = `${center.lat.toFixed(round)},${center.lng.toFixed(round)}|${band}`;
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;

    const memoized = memoRef.current.get(key);
    if (memoized) {
      void renderMarkers(memoized);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    fetch(
      `/api/discover/geo?lat=${center.lat.toFixed(4)}&lng=${center.lng.toFixed(4)}&zoom=${Math.round(zoom)}`,
      { signal: controller.signal },
    )
      .then((response) => (response.ok ? response.json() : []))
      .then((data: AttractionPoi[]) => {
        if (!Array.isArray(data)) return;
        memoRef.current.set(key, data);
        void renderMarkers(data);
      })
      .catch(() => {
        // Aborted or failed: keep whatever is on screen.
      });
  }

  function onMoveEnd() {
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(fetchForViewport, DEBOUNCE_MS);
  }

  function start(persist: boolean) {
    const map = mapRef.current;
    if (!map || activeRef.current) return;
    activeRef.current = true;
    setActive(true);
    if (persist) {
      try {
        sessionStorage.setItem(STORAGE_KEY, "1");
      } catch {
        // Non-fatal.
      }
    }
    map.on("moveend", onMoveEnd);
    fetchForViewport();
  }

  function stop(persist: boolean) {
    if (!activeRef.current) return;
    activeRef.current = false;
    setActive(false);
    if (persist) {
      try {
        sessionStorage.setItem(STORAGE_KEY, "0");
      } catch {
        // Non-fatal.
      }
    }
    const map = mapRef.current;
    map?.off("moveend", onMoveEnd);
    window.clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    lastKeyRef.current = "";
    clearMarkers();
    setPois([]);
  }

  function toggle() {
    if (activeRef.current) stop(true);
    else start(true);
  }

  // Restore the per-session choice once the surface offers the feature. The
  // map may still be initializing; start() is safe to call once it exists, so
  // poll briefly rather than plumbing a load callback through.
  useEffect(() => {
    if (!featureEnabled) return;
    let wanted = false;
    try {
      wanted = sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      wanted = false;
    }
    if (!wanted) return;
    const timer = window.setInterval(() => {
      if (mapRef.current) {
        window.clearInterval(timer);
        start(true);
      }
    }, 400);
    return () => window.clearInterval(timer);
    // Mount-time restore only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureEnabled]);

  // Teardown on unmount (the map removal also removes markers, but the timers
  // and in-flight fetch are ours).
  useEffect(() => {
    return () => {
      window.clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  return {
    active,
    toggle,
    enable: () => start(false),
    disable: () => stop(false),
    pois,
  };
}

"use client";

// Nearby mode: the app's only present tense. Everything else on the globe is
// retrospective (where you have been) or pre-trip (where you are going); this
// is for standing somewhere.
//
// Location handling rules, which the whole feature is built around:
//   - The browser Geolocation API is only ever called from an explicit tap, so
//     the permission prompt never appears on page load.
//   - getCurrentPosition, never watchPosition: one fix per explicit request, no
//     background tracking.
//   - The fix lives in this hook's state for the life of the mode and is
//     dropped on exit. It is never persisted and never sent anywhere. The one
//     exception is an experience the user deliberately creates, whose
//     coordinates they are choosing to save.
//   - A denial is final for the session: the state explains itself and offers
//     an exit, and only another explicit tap re-asks.

import { useEffect, useRef, useState, type RefObject } from "react";
import type { Map as MlMap, Marker as MlMarker } from "maplibre-gl";

import type { NearbyPosition } from "@/lib/nearby";

/** Zoom the map settles at once a fix arrives: close enough to read streets,
 * wide enough that the attraction markers around you are on screen. */
const NEARBY_ZOOM = 13;

const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15000,
  // A fix from the last minute is fine and saves the device a cold start.
  maximumAge: 60000,
};

export type NearbyStatus =
  | "off"
  | "locating"
  | "active"
  /** The user (or the browser) refused. Do not ask again unasked. */
  | "denied"
  /** No Geolocation API on this device or context (needs a secure origin). */
  | "unavailable"
  /** A fix was attempted and failed: timeout, or no position available. */
  | "error";

export interface NearbyHandle {
  status: NearbyStatus;
  /** True whenever the mode owns the map, including its failure states (they
   * are part of the mode and it stays on until dismissed). */
  active: boolean;
  position: NearbyPosition | null;
  enter: () => void;
  exit: () => void;
  toggle: () => void;
  /** Ask the device for a fresh fix. Explicit user action only. */
  refresh: () => void;
}

// The you-are-here marker: a filled emerald dot with a pulsing ring. Emerald
// rather than the brand blue (destination pins) or amber (bucket list), so
// "this is you" never reads as "this is one of your places".
function markerElement(): HTMLElement {
  const el = document.createElement("div");
  el.className = "batchport-here";
  el.setAttribute("aria-hidden", "true");
  el.title = "Your location";
  el.innerHTML =
    '<span class="batchport-here-pulse"></span><span class="batchport-here-dot"></span>';
  return el;
}

export function useNearby({
  mapRef,
  enabled,
  onActiveChange,
}: {
  mapRef: RefObject<MlMap | null>;
  /** Whether the surface offers the mode at all. */
  enabled: boolean;
  onActiveChange?: (active: boolean) => void;
}): NearbyHandle {
  const [status, setStatus] = useState<NearbyStatus>("off");
  const [position, setPosition] = useState<NearbyPosition | null>(null);
  const statusRef = useRef<NearbyStatus>("off");
  const markerRef = useRef<MlMarker | null>(null);
  // True until the first fix of a session has moved the camera, so a manual
  // refresh nudges the marker without yanking the user's zoom back.
  const firstFixRef = useRef(true);
  const onActiveChangeRef = useRef(onActiveChange);
  useEffect(() => {
    onActiveChangeRef.current = onActiveChange;
  });

  // Read through a function rather than touching statusRef.current inline: the
  // mode can be exited while an await or a geolocation callback is in flight,
  // and TypeScript's narrowing would otherwise treat the ref as unchanged.
  function isOff(): boolean {
    return statusRef.current === "off";
  }

  function setStatusBoth(next: NearbyStatus) {
    statusRef.current = next;
    setStatus(next);
  }

  function removeMarker() {
    markerRef.current?.remove();
    markerRef.current = null;
  }

  async function placeMarker(next: NearbyPosition) {
    const map = mapRef.current;
    if (!map || isOff()) return;
    const ml = await import("maplibre-gl");
    if (!mapRef.current || isOff()) return;
    if (markerRef.current) {
      markerRef.current.setLngLat([next.lng, next.lat]);
    } else {
      markerRef.current = new ml.Marker({ element: markerElement() })
        .setLngLat([next.lng, next.lat])
        .addTo(map);
    }
    if (firstFixRef.current) {
      firstFixRef.current = false;
      map.flyTo({
        center: [next.lng, next.lat],
        zoom: NEARBY_ZOOM,
        duration: 1600,
      });
    } else {
      map.easeTo({ center: [next.lng, next.lat], duration: 800 });
    }
  }

  function requestFix() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatusBoth("unavailable");
      return;
    }
    setStatusBoth("locating");
    navigator.geolocation.getCurrentPosition(
      (fix) => {
        // A fix that lands after the user has already left the mode is dropped.
        if (isOff()) return;
        const next: NearbyPosition = {
          lat: fix.coords.latitude,
          lng: fix.coords.longitude,
          accuracyM: Number.isFinite(fix.coords.accuracy)
            ? Math.round(fix.coords.accuracy)
            : null,
        };
        setPosition(next);
        setStatusBoth("active");
        void placeMarker(next);
      },
      (fixError) => {
        if (isOff()) return;
        setStatusBoth(
          fixError.code === fixError.PERMISSION_DENIED ? "denied" : "error",
        );
      },
      GEOLOCATION_OPTIONS,
    );
  }

  function enter() {
    if (!isOff()) return;
    firstFixRef.current = true;
    onActiveChangeRef.current?.(true);
    requestFix();
  }

  function exit() {
    if (isOff()) return;
    setStatusBoth("off");
    setPosition(null);
    removeMarker();
    onActiveChangeRef.current?.(false);
  }

  function toggle() {
    if (isOff()) enter();
    else exit();
  }

  function refresh() {
    if (isOff()) return;
    requestFix();
  }

  // Leaving the surface drops the fix with everything else.
  useEffect(() => {
    return () => {
      statusRef.current = "off";
      removeMarker();
    };
  }, []);

  return {
    status,
    // A surface that does not offer the mode can never have entered it, so
    // `enabled` gates the handle rather than being watched for changes: it is
    // fixed per host (the dashboard wires nearby, the read-only surfaces do
    // not) and flipping it mid-session is not a state this app can reach.
    active: enabled && status !== "off",
    position,
    enter,
    exit,
    toggle,
    refresh,
  };
}

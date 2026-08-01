"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import "maplibre-gl/dist/maplibre-gl.css";
import "./map.css";

import type {
  Map as MlMap,
  MapMouseEvent,
  Popup as MlPopup,
  LngLatBoundsLike,
  GeoJSONFeature,
  GeoJSONSource,
  MapGeoJSONFeature,
} from "maplibre-gl";

import { formatDateRange } from "@/lib/format";
import { boundsOfPoints, haversineKm } from "@/lib/geo";
import {
  CONTEXT_RADIUS_KM,
  PLANNED_RADIUS_KM,
  PREFILL_RADIUS_KM,
  localToday,
  nearestWithin,
  type PlannedExperiencePoint,
} from "@/lib/nearby";
import { markExperienceDoneAction } from "@/lib/actions/experiences";
import type { Category } from "@/lib/types";
import { buildReplayTimeline } from "@/lib/replay";
import { cn } from "@/lib/utils";
import { Lightbox } from "@/components/photos/lightbox";
import { FixLocationDialog } from "@/components/photos/fix-location-dialog";
import { UnlocatedPhotosModal } from "./unlocated-photos-modal";
import type { UnlocatedPhoto } from "@/lib/photo-map-data";
import { MapControls } from "./map-controls";
import {
  TRAVEL_LAYERS,
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
import { useNearby } from "./use-nearby";
import { NearbyPanel } from "./nearby-panel";
import { LogHereSheet, type LogHereDestination } from "./log-here-sheet";
import {
  BASEMAP_STORAGE_KEY,
  availableBasemaps,
  maxZoomForBasemap,
  primeCountriesCache,
  resolveBasemapStyle,
} from "./basemaps";
import {
  arcsFC,
  bucketPlacesFC,
  destinationsFC,
  escapeHtml,
  flagImgHtml,
  wrapLng,
} from "./globe-sources";
import {
  applySky as applyGlobeSky,
  installOverlays as installGlobeOverlays,
} from "./globe-layers";
import type {
  GlobeArc,
  GlobeBucketPlace,
  GlobeCountrySelection,
  GlobeDestination,
} from "./globe-types";

export type {
  GlobeArc,
  GlobeBucketPlace,
  GlobeCountrySelection,
  GlobeDestination,
};

type Projection = "globe" | "mercator";

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
  /** When provided, enables Nearby mode: the device's own position, the
   * attraction layer around it, the stop and planned experience it lands in,
   * and logging an experience at those coordinates. Authenticated surfaces
   * only, since the whole point is writing to the user's own travel record. */
  nearby?: {
    categories: Category[];
    /** Planned experiences with saved coordinates, for the checkoff prompt. */
    plannedPoints: PlannedExperiencePoint[];
    isDemo: boolean;
  };
  /** Fired when nearby mode starts or ends, so hosts can hide their overlays. */
  onNearbyActiveChange?: (active: boolean) => void;
  /** When provided, shows the fullscreen toggle in the control cluster. The
   * host owns the fullscreen state and container styling. */
  onFullscreenToggle?: () => void;
  fullscreen?: boolean;
}

// Auto-rotation pacing for the landing hero. Every colour and radius the map
// draws with lives in globe-layers.ts alongside the layers that use them.
const ROTATION_DEG_PER_SEC = 3;
const IDLE_BEFORE_RESUME_MS = 5000;

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
  nearby,
  onNearbyActiveChange,
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
  const attractionsEnableRef = useRef(attractions.enable);
  useEffect(() => {
    attractionsDisableRef.current = attractions.disable;
    attractionsEnableRef.current = attractions.enable;
  });
  useEffect(() => {
    if (photoMode.active || replay.active) attractionsDisableRef.current();
  }, [photoMode.active, replay.active]);

  // --- Nearby mode -------------------------------------------------------
  //
  // The device position lives in this hook for the life of the mode and is
  // never stored or sent anywhere. The only coordinate that leaves the session
  // is the one attached to an experience the user explicitly creates in the
  // log sheet, or to the checkoff they explicitly tap.
  const [logOpen, setLogOpen] = useState(false);
  const [checkingOff, setCheckingOff] = useState(false);
  // Planned experiences the user has waved off this session, so a "not yet"
  // stays waved off while they are still standing next to the thing.
  const [dismissedPlanned, setDismissedPlanned] = useState<string[]>([]);

  const nearbyMode = useNearby({
    mapRef,
    enabled: Boolean(nearby),
    onActiveChange: (active) => {
      onNearbyActiveChange?.(active);
      if (!active) {
        setLogOpen(false);
        setDismissedPlanned([]);
      }
    },
  });

  // Nearby borrows the attractions layer: standing somewhere, "what is around
  // me" is the whole question. It is handed back on exit unless the user had it
  // on already, and it is only switched on once a fix actually arrives, so a
  // denial never leaves markers behind.
  const attractionsWereOnRef = useRef(false);
  useEffect(() => {
    if (nearbyMode.status === "active") attractionsEnableRef.current();
  }, [nearbyMode.status]);

  function enterNearby() {
    attractionsWereOnRef.current = attractions.active;
    // Only one mode owns the globe at a time.
    photoMode.exit();
    nearbyMode.enter();
  }

  function exitNearby() {
    nearbyMode.exit();
    if (!attractionsWereOnRef.current) attractionsDisableRef.current();
  }

  function toggleNearby() {
    if (nearbyMode.active) exitNearby();
    else enterNearby();
  }

  // The stop the fix landed in, if any: "You are in Kyoto".
  const nearbyContext = useMemo(() => {
    if (!nearbyMode.position) return null;
    const match = nearestWithin(
      nearbyMode.position,
      destinations,
      CONTEXT_RADIUS_KM,
    );
    return match ? { destination: match.item, km: match.km } : null;
  }, [nearbyMode.position, destinations]);

  // The planner's payoff: a saved plan item within arm's reach.
  const plannedNear = useMemo(() => {
    if (!nearbyMode.position || !nearby) return null;
    const candidates = nearby.plannedPoints.filter(
      (point) => !dismissedPlanned.includes(point.id),
    );
    const match = nearestWithin(
      nearbyMode.position,
      candidates,
      PLANNED_RADIUS_KM,
    );
    return match ? { point: match.item, km: match.km } : null;
  }, [nearbyMode.position, nearby, dismissedPlanned]);

  // Name prefill for the log sheet, from the attraction markers already loaded
  // around the user. Only when one is close enough to plausibly be it.
  const nearbyPrefillName = useMemo(() => {
    if (!nearbyMode.position) return "";
    const match = nearestWithin(
      nearbyMode.position,
      attractions.pois,
      PREFILL_RADIUS_KM,
    );
    return match?.item.name ?? "";
  }, [nearbyMode.position, attractions.pois]);

  // Every stop, nearest first, so the log sheet's picker opens on the likely
  // answer even when the fix landed outside the context radius.
  const nearbyDestinationOptions = useMemo<LogHereDestination[]>(() => {
    const position = nearbyMode.position;
    return destinations
      .map((destination) => ({
        id: destination.id,
        name: destination.name,
        tripId: destination.tripId,
        tripName: destination.tripName,
        km: position
          ? haversineKm(
              position.lat,
              position.lng,
              destination.lat,
              destination.lng,
            )
          : null,
      }))
      .sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
  }, [destinations, nearbyMode.position]);

  async function handleCheckoff() {
    const target = plannedNear;
    if (!target || checkingOff) return;
    setCheckingOff(true);
    const result = await markExperienceDoneAction(target.point.id, {
      rating: null,
      visitedDate: localToday(),
    });
    setCheckingOff(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success(`Marked ${target.point.name} as done`);
    setDismissedPlanned((ids) => [...ids, target.point.id]);
    onRefresh?.();
  }

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

    // Sky, atmosphere, and every runtime overlay live in globe-layers.ts;
    // these thin wrappers bind them to the effect's map handle, the active
    // basemap, and the latest data props.
    function applySky() {
      if (map) applyGlobeSky(map);
    }

    function installOverlays() {
      if (!map) return;
      const data = dataRef.current;
      installGlobeOverlays(map, {
        basemapId: currentBasemapId,
        brandHex,
        brandFillCss,
        visitedCountryCodes: data.visitedCountryCodes,
        bucketCountryCodes: data.bucketCountryCodes,
        plannedCountryCodes: data.plannedCountryCodes,
        destinations: data.destinations,
        arcs: data.arcs,
        bucketPlaces: data.bucketPlaces,
      });
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
        // Bottom-centre, on the same baseline as the control cluster so the
        // map's floating chrome sits on one consistent rail.
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-black/70 px-3.5 py-1.5 text-xs font-medium text-foreground/80 shadow-md backdrop-blur-md sm:bottom-8">
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

      {/* Nearby's status card sits in the top-left status corner, the same rail
          the stats pill and photo header use, and hosts hide those while it
          runs. z-30 keeps it above the stats pills on hosts that do not. */}
      {nearby && nearbyMode.active ? (
        <NearbyPanel
          status={nearbyMode.status}
          context={nearbyContext}
          plannedNear={plannedNear}
          checkingOff={checkingOff}
          className={cn(
            "absolute left-4 right-4 z-30 sm:right-auto",
            fullscreen ? "top-[max(1rem,env(safe-area-inset-top))]" : "top-4",
          )}
          onLogHere={() => setLogOpen(true)}
          onCheckoff={() => void handleCheckoff()}
          onDismissCheckoff={() =>
            plannedNear
              ? setDismissedPlanned((ids) => [...ids, plannedNear.point.id])
              : undefined
          }
          onRetry={nearbyMode.refresh}
          onRefresh={nearbyMode.refresh}
          onExit={exitNearby}
        />
      ) : null}

      {nearby && nearbyMode.position ? (
        <LogHereSheet
          open={logOpen}
          onOpenChange={setLogOpen}
          position={nearbyMode.position}
          categories={nearby.categories}
          destinations={nearbyDestinationOptions}
          defaultDestinationId={nearbyContext?.destination.id ?? null}
          defaultName={nearbyPrefillName}
          isDemo={nearby.isDemo}
          onLogged={() => onRefresh?.()}
        />
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
          onPhotoToggle={
            photos.length > 0
              ? () => {
                  if (!photoMode.active) exitNearby();
                  photoMode.toggle();
                }
              : undefined
          }
          photoModeActive={photoMode.active}
          onReplay={
            replayTimeline
              ? () => {
                  // Only one mode owns the globe at a time.
                  photoMode.exit();
                  exitNearby();
                  replay.enter();
                }
              : undefined
          }
          onAttractionsToggle={
            // Nearby owns the attractions layer while it runs, so the standalone
            // toggle stands down alongside photo mode's.
            onOpenAttraction && !photoMode.active && !nearbyMode.active
              ? attractions.toggle
              : undefined
          }
          attractionsActive={attractions.active}
          onNearbyToggle={nearby ? toggleNearby : undefined}
          nearbyActive={nearbyMode.active}
          projection={projection}
          onToggleProjection={handleToggle}
          onRecenter={
            destinations.length > 0 ? () => fitToDestinations(900) : undefined
          }
          onRefresh={onRefresh}
          refreshing={refreshing}
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
          follow={replay.follow}
          attach={replay.attach}
          onTogglePlay={replay.togglePlay}
          onToggleSpeed={replay.toggleSpeed}
          onToggleFollow={replay.toggleFollow}
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

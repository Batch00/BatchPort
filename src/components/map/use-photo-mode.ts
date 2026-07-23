"use client";

// Photo map engine for the globe: hides the normal travel layers (the same
// mechanism replay uses), adds a MapLibre clustered GeoJSON source of photo
// locations, and renders clusters and unclustered points as HTML markers.
//
// Presentation goal (a large library reads as "grouped by the places I was",
// not a confetti scatter): clustering is aggressive and place-aware, a cluster
// shows a single representative thumbnail with a count badge rather than a pile
// of overlapping tiles, and a cluster that can no longer split routes its tap
// straight to the lightbox for the whole set instead of scattering unreadable
// points. Thumbnail point markers are capped; past the cap a small circle layer
// stays visible and clickable, so nothing becomes unreachable, only less
// pretty.

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type {
  GeoJSONSource,
  Map as MlMap,
  MapLayerMouseEvent,
  Marker as MlMarker,
} from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";

import { readBrandHex, TRAVEL_LAYERS } from "./map-utils";

/** One mappable photo with resolved coordinates and popup context. */
export interface GlobePhoto {
  id: string;
  lat: number;
  lng: number;
  thumbUrl: string;
  fullUrl: string;
  dateTaken: string | null;
  attribution: string | null;
  destinationName: string | null;
  tripName: string | null;
  /** Owner context for the lightbox's gallery link and location fixes. Null
   * ids mean the owner row is missing or the photo is trip-level. */
  ownerType: "trip" | "destination" | "experience";
  tripId: string | null;
  destinationId: string | null;
}

/** Photos stacked at (effectively) the same coordinates render as one marker. */
interface PhotoGroup {
  lat: number;
  lng: number;
  /** Indices into the photos array, in display order. */
  indices: number[];
}

const SOURCE_ID = "photo-points";
const CLUSTER_CIRCLE_LAYER = "photo-cluster-circle";
const POINT_CIRCLE_LAYER = "photo-point-circle";
// Beyond this many visible thumbnail markers the remainder render as plain
// circles. Aggressive clustering keeps the viewport count far below this in
// practice; the cap only bites when someone zooms into a dense city with dozens
// of separated stacks.
const MAX_THUMB_MARKERS = 80;
// Aggressive, place-aware clustering: a wide radius merges nearby photos into
// one place marker, and a high max zoom keeps them merged until the camera is
// genuinely close, so mid-zoom reads as a handful of places, not a scatter.
const CLUSTER_RADIUS = 64;
const CLUSTER_MAX_ZOOM = 14;
// ~1 meter: photos that fall back to the same owner coordinates stack exactly,
// and EXIF points this close are the same spot for all practical purposes.
const GROUP_PRECISION = 5;

function groupKey(lat: number, lng: number): string {
  return `${lat.toFixed(GROUP_PRECISION)}|${lng.toFixed(GROUP_PRECISION)}`;
}

interface UsePhotoModeOptions {
  mapRef: RefObject<MlMap | null>;
  photos: GlobePhoto[];
  /** Shared flag the globe's hover and click handlers check to go inert. */
  activeRef: RefObject<boolean>;
  onActiveChange?: (active: boolean) => void;
  /** Fired when a photo marker (or a terminal cluster) is opened, with the
   * stack's or set's photo indices. */
  onOpenGroup: (indices: number[]) => void;
}

export interface PhotoModeHandle {
  active: boolean;
  enter: () => void;
  exit: () => void;
  toggle: () => void;
  /** Re-add the photo source, layers, and markers after a basemap style switch
   * wiped them (the globe calls this on style reload while photo mode is on). */
  reattach: () => void;
}

export function usePhotoMode({
  mapRef,
  photos,
  activeRef,
  onActiveChange,
  onOpenGroup,
}: UsePhotoModeOptions): PhotoModeHandle {
  const [active, setActive] = useState(false);

  const groups = useMemo<PhotoGroup[]>(() => {
    const byKey = new Map<string, PhotoGroup>();
    photos.forEach((photo, index) => {
      const key = groupKey(photo.lat, photo.lng);
      const existing = byKey.get(key);
      if (existing) existing.indices.push(index);
      else byKey.set(key, { lat: photo.lat, lng: photo.lng, indices: [index] });
    });
    return Array.from(byKey.values());
  }, [photos]);

  const featureCollection = useMemo<FeatureCollection<Point>>(
    () => ({
      type: "FeatureCollection",
      features: groups.map((group, index) => ({
        type: "Feature",
        id: index,
        geometry: { type: "Point", coordinates: [group.lng, group.lat] },
        properties: { group: index, count: group.indices.length },
      })),
    }),
    [groups],
  );

  // Mirror the latest data and callbacks so the imperative map plumbing (event
  // handlers, marker builders) never closes over stale props.
  const dataRef = useRef({ photos, groups, featureCollection, onOpenGroup });
  useEffect(() => {
    dataRef.current = { photos, groups, featureCollection, onOpenGroup };
  });

  const markersRef = useRef(new Map<string, MlMarker>());
  const rafRef = useRef(0);
  // Representative thumbnail URL per cluster id, so a cluster marker recreated
  // on pan-back does not re-query its leaves.
  const clusterRepRef = useRef(new Map<number, string>());
  // The maplibre module, resolved on first enter (instant: the globe already
  // loaded it) and kept for the Marker constructor.
  const mlRef = useRef<typeof import("maplibre-gl") | null>(null);
  const listenersRef = useRef<{
    update: () => void;
    sourcedata: (event: { sourceId?: string }) => void;
    pointClick: (event: MapLayerMouseEvent) => void;
    clusterClick: (event: MapLayerMouseEvent) => void;
    pointerEnter: () => void;
    pointerLeave: () => void;
  } | null>(null);

  // A cluster tap either zooms in (if it will split) or, once it can split no
  // further, opens the whole set in the lightbox. This is what keeps a dense
  // city from ever scattering into an unreadable pile of overlapping tiles.
  function handleClusterTap(clusterId: number, center: [number, number]) {
    const map = mapRef.current;
    const source = map?.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (!map || !source) return;
    source
      .getClusterExpansionZoom(clusterId)
      .then((zoom) => {
        if (zoom > map.getMaxZoom()) {
          openCluster(clusterId);
        } else {
          map.easeTo({ center, zoom: zoom + 0.4, duration: 650 });
        }
      })
      .catch(() => {
        // The cluster may have dissolved between tap and lookup; ignore.
      });
  }

  // Open every photo under a cluster as one lightbox set (used for clusters
  // that will not split further).
  function openCluster(clusterId: number) {
    const map = mapRef.current;
    const source = map?.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (!source) return;
    source
      .getClusterLeaves(clusterId, 10000, 0)
      .then((leaves) => {
        const indices: number[] = [];
        for (const leaf of leaves) {
          const groupIndex = Number(leaf.properties?.group);
          const group = dataRef.current.groups[groupIndex];
          if (group) indices.push(...group.indices);
        }
        if (indices.length > 0) dataRef.current.onOpenGroup(indices);
      })
      .catch(() => {
        // Ignore a cluster that dissolved between tap and lookup.
      });
  }

  function openGroup(groupIndex: number) {
    const group = dataRef.current.groups[groupIndex];
    if (group) dataRef.current.onOpenGroup(group.indices);
  }

  // Resolve a cluster's representative photo (its first leaf's cover) and paint
  // it into the marker's img. Cached per cluster id.
  function fillClusterThumb(clusterId: number, img: HTMLImageElement) {
    const cached = clusterRepRef.current.get(clusterId);
    if (cached) {
      img.src = cached;
      return;
    }
    const source = mapRef.current?.getSource(SOURCE_ID) as
      | GeoJSONSource
      | undefined;
    if (!source) return;
    source
      .getClusterLeaves(clusterId, 1, 0)
      .then((leaves) => {
        const groupIndex = Number(leaves[0]?.properties?.group);
        const group = dataRef.current.groups[groupIndex];
        const photo = group
          ? dataRef.current.photos[group.indices[0]]
          : undefined;
        if (photo) {
          clusterRepRef.current.set(clusterId, photo.thumbUrl);
          img.src = photo.thumbUrl;
        }
      })
      .catch(() => {
        // Leave the placeholder tint if the leaves cannot be read.
      });
  }

  // A cluster marker: one representative thumbnail with a stacked-card look and
  // a count badge. Reads as "a place", not a pile of overlapping photos.
  function clusterElement(
    count: number,
    clusterId: number,
    center: [number, number],
  ) {
    const el = document.createElement("button");
    el.type = "button";
    el.setAttribute("aria-label", `${count} photos here`);
    const size = count >= 100 ? 64 : count >= 25 ? 58 : 52;
    // position:absolute matches the .maplibregl-marker stylesheet rule (an
    // inline position:relative would override it and drop the marker into
    // normal flow, detaching it from its map coordinates) while still acting
    // as the containing block for the count badge.
    el.style.cssText = `position:absolute;width:${size}px;height:${size}px;padding:0;border-radius:12px;border:2px solid var(--brand,#2563eb);background:#101623;cursor:pointer;box-shadow:3px 3px 0 -1px rgba(16,22,35,0.9),3px 3px 0 rgba(255,255,255,0.12),0 4px 14px rgba(0,0,0,0.55)`;

    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.draggable = false;
    img.style.cssText =
      "width:100%;height:100%;object-fit:cover;display:block;border-radius:10px";
    el.appendChild(img);
    fillClusterThumb(clusterId, img);

    const badge = document.createElement("span");
    badge.textContent = count >= 1000 ? `${Math.floor(count / 1000)}k+` : String(count);
    badge.style.cssText =
      "position:absolute;right:-6px;top:-6px;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:var(--brand,#2563eb);color:#fff;font-size:0.7rem;font-weight:700;display:flex;align-items:center;justify-content:center;line-height:1;box-shadow:0 1px 4px rgba(0,0,0,0.5)";
    el.appendChild(badge);

    el.addEventListener("click", (event) => {
      event.stopPropagation();
      handleClusterTap(clusterId, center);
    });
    return el;
  }

  function photoElement(groupIndex: number) {
    const group = dataRef.current.groups[groupIndex];
    const photo = group ? dataRef.current.photos[group.indices[0]] : undefined;
    const el = document.createElement("button");
    el.type = "button";
    el.setAttribute("aria-label", "Open photo");
    // position:absolute for the same reason as clusterElement: it must not
    // override the .maplibregl-marker rule that anchors the marker.
    el.style.cssText =
      "position:absolute;width:46px;height:46px;padding:0;border-radius:10px;overflow:hidden;border:2px solid rgba(255,255,255,0.35);background:#101623;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,0.55)";
    if (photo) {
      const img = document.createElement("img");
      img.src = photo.thumbUrl;
      img.alt = "";
      img.loading = "lazy";
      img.draggable = false;
      img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block";
      el.appendChild(img);
    }
    const count = group?.indices.length ?? 0;
    if (count > 1) {
      const badge = document.createElement("span");
      badge.textContent = String(count);
      badge.style.cssText =
        "position:absolute;right:2px;bottom:2px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--brand,#2563eb);color:#fff;font-size:0.6rem;font-weight:600;display:flex;align-items:center;justify-content:center;line-height:1";
      el.appendChild(badge);
    }
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      openGroup(groupIndex);
    });
    return el;
  }

  // Sync HTML markers to the clusters/points currently in the loaded tiles.
  // Markers are keyed and reused, so a typical frame touches no DOM at all;
  // add/remove only happens when the cluster composition actually changes.
  function updateMarkers() {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!map || !ml || !activeRef.current || !map.getSource(SOURCE_ID)) return;

    const features = map.querySourceFeatures(SOURCE_ID);
    const next = new Map<
      string,
      { coords: [number, number]; clusterId?: number; group?: number; count: number }
    >();
    for (const feature of features) {
      if (feature.geometry.type !== "Point") continue;
      const props = feature.properties ?? {};
      const coords = feature.geometry.coordinates as [number, number];
      if (props.cluster) {
        const clusterId = Number(props.cluster_id);
        next.set(`c:${clusterId}`, {
          coords,
          clusterId,
          count: Number(props.photoCount ?? props.point_count ?? 0),
        });
      } else {
        const group = Number(props.group);
        next.set(`p:${group}`, { coords, group, count: Number(props.count ?? 1) });
      }
    }

    for (const [key, marker] of markersRef.current) {
      if (!next.has(key)) {
        marker.remove();
        markersRef.current.delete(key);
      }
    }

    let thumbCount = 0;
    for (const key of markersRef.current.keys()) {
      if (key.startsWith("p:")) thumbCount += 1;
    }
    for (const [key, entry] of next) {
      if (markersRef.current.has(key)) continue;
      let el: HTMLElement;
      if (entry.clusterId !== undefined) {
        el = clusterElement(entry.count, entry.clusterId, entry.coords);
      } else {
        if (thumbCount >= MAX_THUMB_MARKERS) continue;
        thumbCount += 1;
        el = photoElement(entry.group as number);
      }
      const marker = new ml.Marker({ element: el })
        .setLngLat(entry.coords)
        .addTo(map);
      markersRef.current.set(key, marker);
    }
  }

  function scheduleUpdate() {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      updateMarkers();
    });
  }

  function clearMarkers() {
    for (const marker of markersRef.current.values()) marker.remove();
    markersRef.current.clear();
  }

  // Add (or re-add) the clustered source and the circle layers beneath the HTML
  // markers. Idempotent, so both enter() and the post-style-switch reattach()
  // can call it. The travel layers are hidden by the caller.
  function addPhotoLayers() {
    const map = mapRef.current;
    if (!map) return;
    const brandHex = readBrandHex();
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: dataRef.current.featureCollection,
        cluster: true,
        clusterRadius: CLUSTER_RADIUS,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        // Sum the per-stack photo counts so cluster badges show photos, not
        // stacks.
        clusterProperties: { photoCount: ["+", ["get", "count"]] },
      });
    }

    // A soft glow behind clusters, and a small dot per point that doubles as
    // the click target for stacks past the thumbnail marker cap.
    if (!map.getLayer(CLUSTER_CIRCLE_LAYER)) {
      map.addLayer({
        id: CLUSTER_CIRCLE_LAYER,
        type: "circle",
        source: SOURCE_ID,
        filter: ["has", "point_count"],
        paint: {
          "circle-radius": 30,
          "circle-color": brandHex,
          "circle-opacity": 0.22,
          "circle-blur": 1,
        },
      });
    }
    if (!map.getLayer(POINT_CIRCLE_LAYER)) {
      map.addLayer({
        id: POINT_CIRCLE_LAYER,
        type: "circle",
        source: SOURCE_ID,
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": 5,
          "circle-color": "#ffffff",
          "circle-stroke-color": brandHex,
          "circle-stroke-width": 2,
        },
      });
    }
  }

  function enter() {
    const map = mapRef.current;
    if (!map || activeRef.current || !map.getLayer("pins")) return;
    if (dataRef.current.photos.length === 0) return;

    activeRef.current = true;
    setActive(true);
    onActiveChange?.(true);

    for (const id of TRAVEL_LAYERS) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
    }

    addPhotoLayers();

    const listeners = {
      update: scheduleUpdate,
      sourcedata: (event: { sourceId?: string }) => {
        if (event.sourceId === SOURCE_ID) scheduleUpdate();
      },
      pointClick: (event: MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        const group = feature?.properties?.group;
        if (group !== undefined) openGroup(Number(group));
      },
      clusterClick: (event: MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        const clusterId = feature.properties?.cluster_id;
        if (clusterId === undefined) return;
        handleClusterTap(
          Number(clusterId),
          feature.geometry.coordinates as [number, number],
        );
      },
      pointerEnter: () => {
        const canvas = mapRef.current?.getCanvas();
        if (canvas) canvas.style.cursor = "pointer";
      },
      pointerLeave: () => {
        const canvas = mapRef.current?.getCanvas();
        if (canvas) canvas.style.cursor = "";
      },
    };
    listenersRef.current = listeners;
    map.on("move", listeners.update);
    map.on("moveend", listeners.update);
    map.on("sourcedata", listeners.sourcedata);
    map.on("click", POINT_CIRCLE_LAYER, listeners.pointClick);
    map.on("click", CLUSTER_CIRCLE_LAYER, listeners.clusterClick);
    map.on("mouseenter", POINT_CIRCLE_LAYER, listeners.pointerEnter);
    map.on("mouseleave", POINT_CIRCLE_LAYER, listeners.pointerLeave);
    map.on("mouseenter", CLUSTER_CIRCLE_LAYER, listeners.pointerEnter);
    map.on("mouseleave", CLUSTER_CIRCLE_LAYER, listeners.pointerLeave);

    void import("maplibre-gl").then((module) => {
      if (!activeRef.current) return;
      mlRef.current = module;
      scheduleUpdate();
    });
  }

  // Called by the globe after a basemap style switch reloads the style and
  // wipes every runtime source/layer. Re-hide the travel layers (recreated
  // visible), re-add the photo source/layers, and rebuild the markers.
  function reattach() {
    const map = mapRef.current;
    if (!map || !activeRef.current) return;
    for (const id of TRAVEL_LAYERS) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
    }
    clusterRepRef.current.clear();
    addPhotoLayers();
    clearMarkers();
    scheduleUpdate();
  }

  function exit() {
    if (!activeRef.current) return;
    activeRef.current = false;

    const map = mapRef.current;
    const listeners = listenersRef.current;
    if (map && listeners) {
      map.off("move", listeners.update);
      map.off("moveend", listeners.update);
      map.off("sourcedata", listeners.sourcedata);
      map.off("click", POINT_CIRCLE_LAYER, listeners.pointClick);
      map.off("click", CLUSTER_CIRCLE_LAYER, listeners.clusterClick);
      map.off("mouseenter", POINT_CIRCLE_LAYER, listeners.pointerEnter);
      map.off("mouseleave", POINT_CIRCLE_LAYER, listeners.pointerLeave);
      map.off("mouseenter", CLUSTER_CIRCLE_LAYER, listeners.pointerEnter);
      map.off("mouseleave", CLUSTER_CIRCLE_LAYER, listeners.pointerLeave);
    }
    listenersRef.current = null;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    clearMarkers();
    clusterRepRef.current.clear();
    if (map) {
      if (map.getLayer(CLUSTER_CIRCLE_LAYER)) map.removeLayer(CLUSTER_CIRCLE_LAYER);
      if (map.getLayer(POINT_CIRCLE_LAYER)) map.removeLayer(POINT_CIRCLE_LAYER);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      for (const id of TRAVEL_LAYERS) {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible");
      }
      map.getCanvas().style.cursor = "";
    }

    setActive(false);
    onActiveChange?.(false);
  }

  function toggle() {
    if (activeRef.current) exit();
    else enter();
  }

  // Keep the source and markers current if the photo data refreshes while the
  // mode is active (e.g. the host's refresh control re-fetched the page data).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !activeRef.current) return;
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (!source) return;
    clearMarkers();
    clusterRepRef.current.clear();
    source.setData(featureCollection);
    scheduleUpdate();
    // The imperative sync only depends on the rebuilt collection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureCollection]);

  // Stop the marker sync loop if the component unmounts mid-mode; the map
  // teardown removes the layers and markers with the map itself.
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return { active, enter, exit, toggle, reattach };
}

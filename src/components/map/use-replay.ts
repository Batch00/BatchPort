"use client";

// Replay engine for the globe: owns the dedicated replay layers, the
// requestAnimationFrame playback loop, seeking, and the gentle camera follow.
// All per-frame DOM updates (date, counter, scrubber) go through refs so the
// React tree does not re-render at 60fps; React state only tracks the coarse
// mode flags (active, playing, ended, speed).

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type {
  Map as MlMap,
  FilterSpecification,
  GeoJSONSource,
  LngLatBoundsLike,
} from "maplibre-gl";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";

import {
  replayStateAt,
  sliceLeg,
  type ReplayFrameState,
  type ReplayTimeline,
} from "@/lib/replay";
import { GROUND_ARC_COLOR, SEA_ARC_COLOR, type ArcFamily } from "@/lib/transport";
import {
  matchFilter,
  readBrandHex,
  TRAVEL_LAYERS,
  VISITED_BORDER,
} from "./map-utils";

type Projection = "globe" | "mercator";
export type ReplaySpeed = 1 | 2;

/**
 * Camera follow state.
 *
 * - "on": the camera moves to each new trip as playback reaches it.
 * - "paused": a manual pan/zoom interrupted following. The camera stays put,
 *   but the next trip boundary re-engages it automatically.
 * - "off": the viewer turned following off from the transport control. It
 *   stays off across trip boundaries until they turn it back on.
 */
export type ReplayFollow = "on" | "paused" | "off";

// Normal globe layers that step aside while the replay tells its story.
const HIDDEN_LAYERS = TRAVEL_LAYERS;

const REPLAY_LAYERS = [
  "replay-country-fill",
  "replay-country-fade",
  "replay-country-outline",
  "replay-arc-glow",
  "replay-arc-line",
  "replay-arc-ground",
  "replay-arc-sea",
  "replay-head-glow",
  "replay-head-dot",
  "replay-pin-glow",
  "replay-pin-dot",
];

const REPLAY_SOURCES = ["replay-arcs", "replay-head", "replay-pins"];

const COUNTRY_FILL_OPACITY = 0.55;
const COUNTRY_FADE_MS = 650;
// Pin pop duration in playback seconds, so seeks reconstruct mid-pop states.
const PIN_POP_SECONDS = 0.4;
const CAMERA_DURATION_MS = 1700;

function emptyFC<G extends LineString | Point>(): FeatureCollection<G> {
  return { type: "FeatureCollection", features: [] };
}

/** Match one arc family on the shared replay-arcs source. */
function familyFilter(family: ArcFamily): FilterSpecification {
  return ["==", ["get", "family"], family] as unknown as FilterSpecification;
}

/** The colour a family's arc head is tinted with. Air uses the resolved brand
 * hex, so it is passed in rather than looked up. */
function familyColor(family: ArcFamily, brandHex: string): string {
  if (family === "ground") return GROUND_ARC_COLOR;
  if (family === "sea") return SEA_ARC_COLOR;
  return brandHex;
}

// Slight overshoot so pins land with a pop rather than a linear grow.
function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}

// Ease the tip of the growing arc so each leg accelerates and settles.
function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
});

/**
 * Callback refs the overlay component attaches to its DOM nodes. The engine
 * writes to these elements imperatively each frame (date text, scrubber
 * position) so playback never re-renders the React tree.
 */
export interface ReplayOverlayAttach {
  date: (el: HTMLSpanElement | null) => void;
  counter: (el: HTMLSpanElement | null) => void;
  trip: (el: HTMLSpanElement | null) => void;
  fill: (el: HTMLDivElement | null) => void;
  thumb: (el: HTMLDivElement | null) => void;
}

interface OverlayEls {
  date: HTMLSpanElement | null;
  counter: HTMLSpanElement | null;
  trip: HTMLSpanElement | null;
  fill: HTMLDivElement | null;
  thumb: HTMLDivElement | null;
}

interface UseReplayOptions {
  mapRef: RefObject<MlMap | null>;
  timeline: ReplayTimeline | null;
  /** Mirrors the globe's projection state so the prior one can be restored. */
  projectionRef: RefObject<Projection>;
  applyProjection: (projection: Projection) => void;
  /** Shared flag the globe's hover and click handlers check to go inert. */
  activeRef: RefObject<boolean>;
  onActiveChange?: (active: boolean) => void;
}

export interface ReplayHandle {
  active: boolean;
  playing: boolean;
  ended: boolean;
  speed: ReplaySpeed;
  follow: ReplayFollow;
  enter: () => void;
  exit: () => void;
  togglePlay: () => void;
  toggleSpeed: () => void;
  toggleFollow: () => void;
  restart: () => void;
  scrubStart: () => void;
  scrubMove: (fraction: number) => void;
  scrubEnd: () => void;
  attach: ReplayOverlayAttach;
}

export function useReplay({
  mapRef,
  timeline,
  projectionRef,
  applyProjection,
  activeRef,
  onActiveChange,
}: UseReplayOptions): ReplayHandle {
  const [active, setActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const [follow, setFollow] = useState<ReplayFollow>("on");

  const timelineRef = useRef<ReplayTimeline | null>(timeline);
  timelineRef.current = timeline;

  const tRef = useRef(0);
  const rafRef = useRef(0);
  const lastFrameRef = useRef(0);
  const playingRef = useRef(false);
  const speedRef = useRef<ReplaySpeed>(1);
  const scrubbingRef = useRef(false);
  const wasPlayingRef = useRef(false);
  const followRef = useRef<ReplayFollow>("on");
  const prevProjectionRef = useRef<Projection>("globe");
  const brandHexRef = useRef("#2563eb");

  // Diff caches so a frame only touches the map when something changed.
  const revealedKeyRef = useRef("");
  const lastPinCountRef = useRef(-1);
  const pinsPoppingRef = useRef(false);
  const lastArcKeyRef = useRef("");
  const lastTripIndexRef = useRef(-1);
  const lastDateTextRef = useRef("");
  const lastCounterRef = useRef(-1);
  const lastTripNameRef = useRef<string | null | undefined>(undefined);
  const legFeatureCacheRef = useRef<Feature<LineString>[]>([]);

  const overlayEls = useRef<OverlayEls>({
    date: null,
    counter: null,
    trip: null,
    fill: null,
    thumb: null,
  });
  const attach = useMemo<ReplayOverlayAttach>(
    () => ({
      date: (el) => {
        overlayEls.current.date = el;
      },
      counter: (el) => {
        overlayEls.current.counter = el;
      },
      trip: (el) => {
        overlayEls.current.trip = el;
      },
      fill: (el) => {
        overlayEls.current.fill = el;
      },
      thumb: (el) => {
        overlayEls.current.thumb = el;
      },
    }),
    [],
  );

  function setFollowState(next: ReplayFollow) {
    if (followRef.current === next) return;
    followRef.current = next;
    setFollow(next);
  }

  // A manual pan/zoom suspends following so the camera never fights the
  // viewer, but only as a pause: the next trip boundary re-engages it. An
  // explicit "off" from the control is left alone.
  function pauseFollow() {
    if (followRef.current === "on") setFollowState("paused");
  }

  // Stable identities for map.on/map.off. Recreating the handler each render
  // would leave the enter() listeners attached after exit().
  const pauseFollowRef = useRef(pauseFollow);
  pauseFollowRef.current = pauseFollow;
  const onUserInteraction = useMemo(
    () => () => {
      pauseFollowRef.current();
    },
    [],
  );

  function resetDiffCaches() {
    revealedKeyRef.current = "";
    lastPinCountRef.current = -1;
    pinsPoppingRef.current = false;
    lastArcKeyRef.current = "";
    lastTripIndexRef.current = -1;
    lastDateTextRef.current = "";
    lastCounterRef.current = -1;
    lastTripNameRef.current = undefined;
  }

  function flyToTrip(tripIndex: number) {
    const map = mapRef.current;
    const tl = timelineRef.current;
    if (!map || !tl) return;
    const trip = tl.trips[tripIndex];
    if (!trip) return;
    const [minLng, minLat, maxLng, maxLat] = trip.bounds;
    try {
      if (minLng === maxLng && minLat === maxLat) {
        map.easeTo({
          center: [minLng, minLat],
          zoom: 3.6,
          duration: CAMERA_DURATION_MS,
        });
      } else {
        map.fitBounds(trip.bounds as LngLatBoundsLike, {
          padding: { top: 84, bottom: 108, left: 56, right: 56 },
          maxZoom: 4.5,
          duration: CAMERA_DURATION_MS,
        });
      }
    } catch {
      // A container smaller than the padding can reject the fit; skip the move.
    }
  }

  function applyFrame(state: ReplayFrameState, instant: boolean) {
    const map = mapRef.current;
    const tl = timelineRef.current;
    if (!map || !tl || !map.getLayer("replay-country-fill")) return;

    // Country fills: new codes land in a fade layer that transitions to full
    // opacity, then migrate into the static fill on the next change. Seeks
    // snap everything instantly instead.
    const revealedKey = state.revealedCodes.join(",");
    if (revealedKey !== revealedKeyRef.current) {
      const previous = new Set(revealedKeyRef.current.split(",").filter(Boolean));
      const added = state.revealedCodes.filter((code) => !previous.has(code));
      if (instant || added.length === 0) {
        map.setFilter("replay-country-fill", matchFilter(state.revealedCodes));
        map.setFilter("replay-country-fade", matchFilter([]));
        map.setPaintProperty("replay-country-fade", "fill-opacity-transition", {
          duration: 0,
          delay: 0,
        });
        map.setPaintProperty("replay-country-fade", "fill-opacity", 0);
      } else {
        const settled = state.revealedCodes.filter(
          (code) => !added.includes(code),
        );
        map.setFilter("replay-country-fill", matchFilter(settled));
        map.setFilter("replay-country-fade", matchFilter(added));
        map.setPaintProperty("replay-country-fade", "fill-opacity-transition", {
          duration: 0,
          delay: 0,
        });
        map.setPaintProperty("replay-country-fade", "fill-opacity", 0);
        map.setPaintProperty("replay-country-fade", "fill-opacity-transition", {
          duration: COUNTRY_FADE_MS,
          delay: 0,
        });
        map.setPaintProperty(
          "replay-country-fade",
          "fill-opacity",
          COUNTRY_FILL_OPACITY,
        );
      }
      map.setFilter("replay-country-outline", matchFilter(state.revealedCodes));
      revealedKeyRef.current = revealedKey;
    }

    // Pins: rebuild the tiny point set whenever the visible set changes or a
    // pop entrance is in flight. Pop scale is a function of playback age, so
    // scrubbing reconstructs mid-pop states too.
    let popping = false;
    if (!instant) {
      for (let i = 0; i < state.visiblePinCount; i += 1) {
        if (state.t - tl.pinEvents[i].time < PIN_POP_SECONDS) {
          popping = true;
          break;
        }
      }
    }
    if (
      popping ||
      pinsPoppingRef.current ||
      state.visiblePinCount !== lastPinCountRef.current
    ) {
      const features: Feature<Point>[] = [];
      for (let i = 0; i < state.visiblePinCount; i += 1) {
        const event = tl.pinEvents[i];
        const age = state.t - event.time;
        const scale =
          !instant && age < PIN_POP_SECONDS
            ? Math.max(0.05, easeOutBack(age / PIN_POP_SECONDS))
            : 1;
        features.push({
          type: "Feature",
          id: i,
          geometry: {
            type: "Point",
            coordinates: [event.stop.lng, event.stop.lat],
          },
          properties: {
            color: event.stop.color ?? brandHexRef.current,
            scale,
          },
        });
      }
      const source = map.getSource("replay-pins") as GeoJSONSource | undefined;
      source?.setData({ type: "FeatureCollection", features });
      lastPinCountRef.current = state.visiblePinCount;
      pinsPoppingRef.current = popping;
    }

    // Arcs: completed legs render whole (cached features); the active leg is
    // sliced with an eased tip, plus a bright head point while it grows.
    const arcKey = state.activeLeg
      ? `${state.completedLegs.length}:${state.activeLeg.legIndex}:${state.activeLeg.progress.toFixed(4)}`
      : `${state.completedLegs.length}:done`;
    if (arcKey !== lastArcKeyRef.current) {
      const features: Feature<LineString>[] = [];
      for (const legIndex of state.completedLegs) {
        let cached = legFeatureCacheRef.current[legIndex];
        if (!cached) {
          cached = {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: tl.legs[legIndex].coords,
            },
            properties: { family: tl.legs[legIndex].family },
          };
          legFeatureCacheRef.current[legIndex] = cached;
        }
        features.push(cached);
      }
      let head = emptyFC<Point>();
      if (state.activeLeg) {
        const leg = tl.legs[state.activeLeg.legIndex];
        const eased = easeInOutCubic(state.activeLeg.progress);
        const coords = sliceLeg(leg.coords, eased);
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
          properties: { family: leg.family },
        });
        if (eased > 0.001 && eased < 0.999) {
          head = {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: {
                  type: "Point",
                  coordinates: coords[coords.length - 1],
                },
                properties: {
                  color: familyColor(leg.family, brandHexRef.current),
                },
              },
            ],
          };
        }
      }
      const arcSource = map.getSource("replay-arcs") as GeoJSONSource | undefined;
      const headSource = map.getSource("replay-head") as GeoJSONSource | undefined;
      arcSource?.setData({ type: "FeatureCollection", features });
      headSource?.setData(head);
      lastArcKeyRef.current = arcKey;
    }

    // Overlay: direct DOM writes, no React re-render.
    const els = overlayEls.current;
    const dateText = DATE_FORMAT.format(state.dateMs);
    if (dateText !== lastDateTextRef.current && els.date) {
      els.date.textContent = dateText;
      lastDateTextRef.current = dateText;
    }
    const count = state.revealedCodes.length;
    if (count !== lastCounterRef.current && els.counter) {
      els.counter.textContent = `${count} ${count === 1 ? "country" : "countries"}`;
      lastCounterRef.current = count;
    }
    if (state.tripName !== lastTripNameRef.current && els.trip) {
      if (state.tripName === null) {
        els.trip.style.opacity = "0";
      } else {
        els.trip.textContent = state.tripName;
        els.trip.style.opacity = "1";
      }
      lastTripNameRef.current = state.tripName;
    }
    const pct = tl.duration > 0 ? (state.t / tl.duration) * 100 : 0;
    if (els.fill) els.fill.style.width = `${pct}%`;
    if (els.thumb) els.thumb.style.left = `${pct}%`;

    // Camera: fit the active (or, during a gap, the upcoming) trip once per
    // trip change. Seeks never move the camera. A trip boundary is also the
    // natural place to recover from a pause, so following re-engages here
    // unless the viewer turned it off explicitly.
    if (state.tripIndex !== lastTripIndexRef.current) {
      const first = lastTripIndexRef.current === -1;
      lastTripIndexRef.current = state.tripIndex;
      if (!instant && !first && followRef.current !== "off") {
        setFollowState("on");
        flyToTrip(state.tripIndex);
      }
    }
  }

  function tick(now: number) {
    rafRef.current = 0;
    const tl = timelineRef.current;
    if (!activeRef.current || !tl) return;
    const dt = lastFrameRef.current
      ? Math.min((now - lastFrameRef.current) / 1000, 0.1)
      : 0;
    lastFrameRef.current = now;

    if (!playingRef.current || scrubbingRef.current) return;

    tRef.current = Math.min(tRef.current + dt * speedRef.current, tl.duration);
    const state = replayStateAt(tl, tRef.current);
    applyFrame(state, false);

    if (tRef.current >= tl.duration) {
      playingRef.current = false;
      setPlaying(false);
      setEnded(true);
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  function startPlaying() {
    playingRef.current = true;
    setPlaying(true);
    lastFrameRef.current = 0;
    if (!rafRef.current) rafRef.current = requestAnimationFrame(tick);
  }

  function pausePlaying() {
    playingRef.current = false;
    setPlaying(false);
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }

  function addReplayLayers(map: MlMap) {
    const brandHex = brandHexRef.current;
    const beforeOutline = map.getLayer("country-outline")
      ? "country-outline"
      : undefined;

    map.addLayer(
      {
        id: "replay-country-fill",
        type: "fill",
        source: "countries",
        filter: matchFilter([]),
        paint: { "fill-color": brandHex, "fill-opacity": COUNTRY_FILL_OPACITY },
      },
      beforeOutline,
    );
    map.addLayer(
      {
        id: "replay-country-fade",
        type: "fill",
        source: "countries",
        filter: matchFilter([]),
        paint: { "fill-color": brandHex, "fill-opacity": 0 },
      },
      beforeOutline,
    );
    map.addLayer({
      id: "replay-country-outline",
      type: "line",
      source: "countries",
      filter: matchFilter([]),
      paint: {
        "line-color": VISITED_BORDER,
        "line-width": 1,
        "line-opacity": 0.9,
      },
    });

    map.addSource("replay-arcs", { type: "geojson", data: emptyFC<LineString>() });
    map.addSource("replay-head", { type: "geojson", data: emptyFC<Point>() });
    map.addSource("replay-pins", { type: "geojson", data: emptyFC<Point>() });

    // Arcs, split by how the hop was travelled, mirroring the static globe
    // exactly (see globe-layers.ts): air keeps the solid brand-blue line and
    // its glow, ground is thinner violet dashes, sea is cyan dots. Three
    // layers over one source rather than one data-driven layer, because
    // line-dasharray is not a data-driven paint property in MapLibre. The
    // per-feature "family" property drives the filters, and an unrecorded hop
    // is "air", so an unannotated replay animates exactly as it always did.
    map.addLayer({
      id: "replay-arc-glow",
      type: "line",
      source: "replay-arcs",
      filter: familyFilter("air"),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": brandHex,
        "line-width": 7,
        "line-opacity": 0.18,
        "line-blur": 2,
      },
    });
    map.addLayer({
      id: "replay-arc-line",
      type: "line",
      source: "replay-arcs",
      filter: familyFilter("air"),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": brandHex,
        "line-width": 2.5,
        "line-opacity": 0.9,
      },
    });
    map.addLayer({
      id: "replay-arc-ground",
      type: "line",
      source: "replay-arcs",
      filter: familyFilter("ground"),
      layout: { "line-join": "round" },
      paint: {
        "line-color": GROUND_ARC_COLOR,
        "line-width": 2,
        "line-opacity": 0.85,
        "line-dasharray": [3, 2],
      },
    });
    map.addLayer({
      id: "replay-arc-sea",
      type: "line",
      source: "replay-arcs",
      filter: familyFilter("sea"),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": SEA_ARC_COLOR,
        "line-width": 2.2,
        "line-opacity": 0.85,
        "line-dasharray": [0, 2.2],
      },
    });

    // The bright head that leads each growing arc, tinted to the family it is
    // drawing so the leading edge and the line it leaves behind agree.
    map.addLayer({
      id: "replay-head-glow",
      type: "circle",
      source: "replay-head",
      paint: {
        "circle-radius": 9,
        "circle-color": ["get", "color"],
        "circle-opacity": 0.5,
        "circle-blur": 1,
      },
    });
    map.addLayer({
      id: "replay-head-dot",
      type: "circle",
      source: "replay-head",
      paint: {
        "circle-radius": 3,
        "circle-color": "#e0ecff",
        "circle-opacity": 0.95,
      },
    });

    // Pins scale in via the per-feature "scale" property (0..~1.1 pop).
    map.addLayer({
      id: "replay-pin-glow",
      type: "circle",
      source: "replay-pins",
      paint: {
        "circle-radius": ["*", ["get", "scale"], 14],
        "circle-color": ["get", "color"],
        "circle-opacity": ["*", ["get", "scale"], 0.4],
        "circle-blur": 1,
      },
    });
    map.addLayer({
      id: "replay-pin-dot",
      type: "circle",
      source: "replay-pins",
      paint: {
        "circle-radius": ["*", ["get", "scale"], 6],
        "circle-color": "#ffffff",
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-width": ["*", ["get", "scale"], 2.5],
        "circle-opacity": ["get", "scale"],
      },
    });
  }

  function removeReplayLayers(map: MlMap) {
    for (const id of REPLAY_LAYERS) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of REPLAY_SOURCES) {
      if (map.getSource(id)) map.removeSource(id);
    }
  }

  function enter() {
    const map = mapRef.current;
    const tl = timelineRef.current;
    if (!map || !tl || activeRef.current) return;

    brandHexRef.current = readBrandHex();
    prevProjectionRef.current = projectionRef.current;
    if (projectionRef.current !== "globe") applyProjection("globe");

    for (const id of HIDDEN_LAYERS) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
    }
    addReplayLayers(map);

    followRef.current = "on";
    setFollow("on");
    map.on("mousedown", onUserInteraction);
    map.on("wheel", onUserInteraction);
    map.on("touchstart", onUserInteraction);
    map.on("dragstart", onUserInteraction);

    activeRef.current = true;
    tRef.current = 0;
    speedRef.current = 1;
    resetDiffCaches();
    setActive(true);
    setEnded(false);
    setSpeed(1);
    onActiveChange?.(true);

    applyFrame(replayStateAt(tl, 0), true);
    flyToTrip(0);
    startPlaying();
  }

  function exit() {
    if (!activeRef.current) return;
    pausePlaying();
    scrubbingRef.current = false;
    activeRef.current = false;

    const map = mapRef.current;
    if (map) {
      map.off("mousedown", onUserInteraction);
      map.off("wheel", onUserInteraction);
      map.off("touchstart", onUserInteraction);
      map.off("dragstart", onUserInteraction);
      removeReplayLayers(map);
      for (const id of HIDDEN_LAYERS) {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible");
      }
    }
    if (prevProjectionRef.current !== "globe") {
      applyProjection(prevProjectionRef.current);
    }

    setActive(false);
    setEnded(false);
    onActiveChange?.(false);
  }

  function restart() {
    const tl = timelineRef.current;
    if (!tl || !activeRef.current) return;
    tRef.current = 0;
    resetDiffCaches();
    setEnded(false);
    // A fresh run always starts following, whatever the previous run ended on.
    setFollowState("on");
    applyFrame(replayStateAt(tl, 0), true);
    flyToTrip(0);
    startPlaying();
  }

  function togglePlay() {
    const tl = timelineRef.current;
    if (!tl || !activeRef.current) return;
    if (playingRef.current) {
      pausePlaying();
    } else if (tRef.current >= tl.duration) {
      restart();
    } else {
      startPlaying();
    }
  }

  // Turning following back on catches the camera up to where playback
  // actually is, easing rather than snapping.
  function toggleFollow() {
    if (!activeRef.current) return;
    if (followRef.current === "on") {
      setFollowState("off");
      return;
    }
    setFollowState("on");
    if (lastTripIndexRef.current !== -1) flyToTrip(lastTripIndexRef.current);
  }

  function toggleSpeed() {
    const next: ReplaySpeed = speedRef.current === 1 ? 2 : 1;
    speedRef.current = next;
    setSpeed(next);
  }

  function scrubStart() {
    if (!activeRef.current) return;
    scrubbingRef.current = true;
    wasPlayingRef.current = playingRef.current;
    playingRef.current = false;
    setPlaying(false);
  }

  function scrubMove(fraction: number) {
    const tl = timelineRef.current;
    if (!tl || !activeRef.current) return;
    tRef.current = Math.min(Math.max(fraction, 0), 1) * tl.duration;
    const state = replayStateAt(tl, tRef.current);
    applyFrame(state, true);
    setEnded(state.ended);
  }

  function scrubEnd() {
    const tl = timelineRef.current;
    scrubbingRef.current = false;
    if (!tl || !activeRef.current) return;
    if (wasPlayingRef.current && tRef.current < tl.duration) {
      startPlaying();
    }
  }

  // Stop the loop if the component unmounts mid-replay; the map teardown
  // removes the layers themselves.
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return {
    active,
    playing,
    ended,
    speed,
    follow,
    enter,
    exit,
    togglePlay,
    toggleSpeed,
    toggleFollow,
    restart,
    scrubStart,
    scrubMove,
    scrubEnd,
    attach,
  };
}

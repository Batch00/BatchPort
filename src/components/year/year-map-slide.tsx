"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FastForwardIcon, Loader2Icon, RotateCcwIcon } from "lucide-react";

import { prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { loadCountryShapes } from "@/lib/poster/countries";
import { posterTheme } from "@/lib/poster/theme";
import {
  buildYearMapView,
  drawYearMapFrame,
  type YearMapArc,
  type YearMapView,
} from "@/lib/poster/year-map";
import {
  advancePlayback,
  buildReplayTimeline,
  replayStateAt,
  sliceLeg,
  type ReplayTimeline,
} from "@/lib/replay";
import type { ArcFamily } from "@/lib/transport";
import type { YearMapSlide as YearMapSlideData } from "@/lib/year-recap";

// The recap's map slide: the year drawing itself.
//
// The timeline is the globe's own replay engine (lib/replay.ts), scoped to the
// year's trips. Nothing about the model is new here: the same segments, the
// same country reveal events, the same per-family arc styling. What changes is
// the surface it plays on, a canvas rather than MapLibre, which is what lets
// the recap animate a map inside a portal without standing up a second map
// instance over the one already on the page.
//
// This is the one slide that moves on its own, and only once. It plays when it
// becomes the current slide, stops at the end, and offers a replay. Under
// prefers-reduced-motion it renders the finished year immediately: the same
// picture, without the journey to it.

/** The same ladder the globe's replay offers, plus a third step: a recap can
 * run to ninety seconds and the map is the one slide that makes somebody wait
 * for it. Skipping ahead is the fourth option and it is a button, not a speed. */
const SPEEDS = [1, 2, 4] as const;
type MapSpeed = (typeof SPEEDS)[number];

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function monthLabel(dateMs: number): string {
  const date = new Date(dateMs);
  if (Number.isNaN(date.getTime())) return "";
  return `${MONTHS_SHORT[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function YearMapSlide({
  slide,
  active,
}: {
  slide: YearMapSlideData;
  active: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<YearMapView | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [shapes, setShapes] = useState<Awaited<
    ReturnType<typeof loadCountryShapes>
  > | null>(null);
  const [failed, setFailed] = useState(false);
  const [run, setRun] = useState(0);
  const [readout, setReadout] = useState<{
    month: string;
    trip: string | null;
    countries: number;
  }>({ month: "", trip: null, countries: 0 });
  // The readout changes a few dozen times across a playback; the canvas
  // changes sixty times a second. Comparing before setting is what keeps React
  // out of the animation loop.
  const readoutRef = useRef("");
  const [ended, setEnded] = useState(false);
  // Speed and skip are refs as well as state: the animation loop reads them
  // every frame and must not be torn down and rebuilt to pick up a change,
  // which would restart the playback from zero.
  const [speed, setSpeed] = useState<MapSpeed>(1);
  const speedRef = useRef<MapSpeed>(1);
  const skipRef = useRef(false);
  // The playback clock lives OUTSIDE the animation effect, deliberately.
  //
  // The effect has to be rebuilt whenever the base picture is (a resize, the
  // outlines finishing loading), or it would keep drawing onto a stale bitmap.
  // With the clock inside it, every one of those rebuilds silently restarted
  // the year from zero, and the header above the canvas changes height the
  // moment the first trip ends (the trip name line disappears during the gap),
  // so the year could never get past its first trip. Holding the clock here
  // means a rebuild repaints where playback actually is and carries on.
  const clockRef = useRef(0);
  // Which timeline the clock above is a clock for. A new year is a new
  // playback, not a resumption of the last one.
  const clockTimelineRef = useRef<ReplayTimeline | null>(null);

  const cycleSpeed = useCallback(() => {
    setSpeed((current) => {
      const next = SPEEDS[(SPEEDS.indexOf(current) + 1) % SPEEDS.length];
      speedRef.current = next;
      return next;
    });
  }, []);

  const replay = useCallback(() => {
    clockRef.current = 0;
    skipRef.current = false;
    readoutRef.current = "";
    setEnded(false);
    setRun((current) => current + 1);
  }, []);

  const timeline = useMemo<ReplayTimeline | null>(
    () => buildReplayTimeline(slide.stops),
    [slide.stops],
  );
  const points = useMemo(
    () => slide.stops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
    [slide.stops],
  );
  const theme = useMemo(() => posterTheme("midnight"), []);

  // The outlines are a precached static file, so this is a cache read on any
  // device that has opened the app before.
  useEffect(() => {
    if (!active || shapes || failed) return;
    let cancelled = false;
    loadCountryShapes()
      .then((loaded) => {
        if (!cancelled) setShapes(loaded);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [active, shapes, failed]);

  // Adjusting state to a changed prop, the React-documented way: during
  // render, never from an effect. The clock and the skip flag are refs and are
  // reset inside the animation effect below, where mutating them is safe.
  const [prevTimeline, setPrevTimeline] = useState(timeline);
  if (prevTimeline !== timeline) {
    setPrevTimeline(timeline);
    setEnded(false);
  }

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    // Only a real change in dimensions counts. A fresh object with the same
    // numbers would still be a new identity, which rebuilds the base picture
    // and the animation loop for nothing.
    const measure = () => {
      const rect = element.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      setSize((current) =>
        current && current.width === width && current.height === height
          ? current
          : { width, height },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Build the static base whenever the surface or the data changes. The base
  // is the expensive half of the picture and it never changes during playback.
  useEffect(() => {
    if (!shapes || !size) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    viewRef.current = buildYearMapView(
      shapes,
      theme,
      points,
      size.width,
      size.height,
      dpr,
    );
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = Math.round(size.width * dpr);
      canvas.height = Math.round(size.height * dpr);
      canvas.style.width = `${size.width}px`;
      canvas.style.height = `${size.height}px`;
    }
  }, [shapes, size, points, theme]);

  // Playback. It depends on the base's own inputs as well as on `run`, so a
  // resize rebuilds the base (in the effect above, which runs first) and then
  // redraws onto it rather than leaving the old bitmap on screen. The clock
  // itself lives in a ref outside this effect, so a rebuild resumes where
  // playback was instead of starting the year again.
  //
  // It also depends on `active`, which means playback PAUSES when the slide is
  // not the current one and picks up where it left off on the way back. A year
  // quietly finishing off screen would be worse than either.
  useEffect(() => {
    if (!active || !timeline) return;
    const view = viewRef.current;
    const canvas = canvasRef.current;
    if (!view || !canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    if (clockTimelineRef.current !== timeline) {
      clockTimelineRef.current = timeline;
      clockRef.current = 0;
      skipRef.current = false;
      readoutRef.current = "";
    }

    const reduced = prefersReducedMotion();
    let frame = 0;
    let previous = 0;

    const paint = (t: number) => {
      const state = replayStateAt(timeline, t);
      const legs: YearMapArc[] = state.completedLegs.map((index) => ({
        coords: timeline.legs[index].coords,
        family: timeline.legs[index].family,
      }));
      let activeArc: YearMapArc | null = null;
      let head: { point: { lat: number; lng: number }; family: ArcFamily } | null =
        null;
      if (state.activeLeg) {
        const leg = timeline.legs[state.activeLeg.legIndex];
        const coords = sliceLeg(leg.coords, state.activeLeg.progress);
        activeArc = { coords, family: leg.family };
        const tip = coords[coords.length - 1];
        head = { point: { lng: tip[0], lat: tip[1] }, family: leg.family };
      }
      const pins = timeline.pinEvents
        .slice(0, state.visiblePinCount)
        .map((event) => ({ lat: event.stop.lat, lng: event.stop.lng }));

      drawYearMapFrame(context, view, {
        revealedCodes: new Set(state.revealedCodes),
        legs,
        active: activeArc,
        pins,
        head,
      });
      const next = {
        month: monthLabel(state.dateMs),
        trip: state.tripName,
        countries: state.revealedCodes.length,
      };
      const signature = `${next.month}|${next.trip ?? ""}|${next.countries}`;
      if (signature !== readoutRef.current) {
        readoutRef.current = signature;
        setReadout(next);
      }
      return state.ended;
    };

    // Reduced motion still schedules one frame: it paints the finished year
    // rather than the journey to it. Going through the same loop keeps the
    // end state in one place instead of two.
    const tick = (now: number) => {
      if (previous === 0) previous = now;
      const dt = (now - previous) / 1000;
      previous = now;
      const step = advancePlayback(
        clockRef.current,
        dt,
        speedRef.current,
        timeline.duration,
        reduced || skipRef.current ? "skip" : "play",
      );
      clockRef.current = step.clock;
      paint(step.clock);
      // Same value on every frame until the last one, which React bails on,
      // so this costs one render at the start and one at the end.
      setEnded(step.ended);
      if (!step.ended) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, timeline, run, shapes, size]);

  const pill =
    "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/[0.12]";

  return (
    <div className="relative flex size-full flex-col bg-[#0a0a0a]">
      {/* The header is IN the column, not floating over it, and its top
          padding clears the recap's own chrome: the progress bar, and the year
          picker and close button that sit one safe-area inset below it. Sized
          absolutely against the viewport it was cut off on any phone with a
          notch, because the chrome above it grows with the inset and this did
          not. It also shrinks its own type on short screens rather than
          pushing the map off the bottom. */}
      <div className="z-10 flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-[calc(3.5rem+env(safe-area-inset-top))] sm:px-8 sm:pb-4">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.22em] text-white/45 sm:text-[11px]">
            {slide.label} on the map
          </p>
          <p className="mt-0.5 truncate text-xl font-semibold tabular-nums tracking-tight text-white sm:mt-1 sm:text-3xl">
            {readout.month || slide.label}
          </p>
          {/* Always rendered, empty or not. The trip name drops out during
              the gap between two trips, and letting the line collapse changed
              the header's height, which resized the canvas below it. */}
          <p className="mt-0.5 truncate text-xs text-white/60 sm:text-sm">
            {readout.trip || " "}
          </p>
        </div>
        <p className="mt-0.5 shrink-0 rounded-full bg-white/[0.06] px-3 py-1 text-xs tabular-nums text-white/70">
          {readout.countries} {readout.countries === 1 ? "country" : "countries"}
        </p>
      </div>

      <div ref={containerRef} className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Map of your travels in ${slide.year}`}
          className="absolute inset-0"
        />
        {!shapes && !failed ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/40">
            <Loader2Icon className="mr-2 size-4 animate-spin" />
            Drawing the year
          </div>
        ) : null}
        {failed ? (
          <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-white/40">
            The map outlines could not be loaded.
          </div>
        ) : null}
      </div>

      {/* Pace and skip. Both are gone once the year is drawn: there is nothing
          left to hurry, and the row becomes the single replay button. */}
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 p-5 pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:pb-[calc(5rem+env(safe-area-inset-bottom))]">
        {ended ? (
          <button
            type="button"
            onClick={replay}
            className={pill}
          >
            <RotateCcwIcon className="size-3.5" />
            Play again
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={cycleSpeed}
              aria-label={`Drawing speed ${speed}x. Tap to change.`}
              className={cn(pill, "tabular-nums")}
            >
              {speed}x
            </button>
            <button
              type="button"
              onClick={() => {
                skipRef.current = true;
              }}
              className={pill}
            >
              <FastForwardIcon className="size-3.5" />
              Skip to the end
            </button>
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2Icon, RotateCcwIcon } from "lucide-react";

import { prefersReducedMotion } from "@/lib/motion";
import { loadCountryShapes } from "@/lib/poster/countries";
import { posterTheme } from "@/lib/poster/theme";
import {
  buildYearMapView,
  drawYearMapFrame,
  type YearMapArc,
  type YearMapView,
} from "@/lib/poster/year-map";
import {
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

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize({
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      });
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
  // redraws onto it rather than leaving the old bitmap on screen.
  useEffect(() => {
    if (!active || !timeline) return;
    const view = viewRef.current;
    const canvas = canvasRef.current;
    if (!view || !canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const reduced = prefersReducedMotion();
    let frame = 0;
    let start = 0;

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
      if (start === 0) start = now;
      const elapsed = reduced ? timeline.duration : (now - start) / 1000;
      const done = paint(Math.min(elapsed, timeline.duration));
      // Same value on every frame until the last one, which React bails on,
      // so this costs one render at the start and one at the end.
      setEnded(done);
      if (!done) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, timeline, run, shapes, size]);

  return (
    <div className="relative flex size-full flex-col bg-[#0a0a0a]">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-5 pt-12 sm:p-8 sm:pt-14">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-white/45">
            {slide.label} on the map
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-white sm:text-3xl">
            {readout.month || slide.label}
          </p>
          {readout.trip ? (
            <p className="mt-1 max-w-[16rem] truncate text-sm text-white/60">
              {readout.trip}
            </p>
          ) : null}
        </div>
        <p className="shrink-0 rounded-full bg-white/[0.06] px-3 py-1 text-xs tabular-nums text-white/70">
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

      <div className="flex items-center justify-center p-5 pb-16 sm:pb-20">
        {ended ? (
          <button
            type="button"
            onClick={() => setRun((current) => current + 1)}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/[0.12]"
          >
            <RotateCcwIcon className="size-3.5" />
            Play again
          </button>
        ) : (
          <span className="text-xs text-white/35">Drawing your year</span>
        )}
      </div>
    </div>
  );
}

// The animated map the year recap plays in place.
//
// It draws the same geometry the poster and the share card do, through the
// same projection and the same painter, so the year's map is recognisably the
// same object as the one that prints. What it adds is time: the replay
// timeline decides which countries have filled in, which legs have been drawn,
// and how far along the leg in flight is, and this paints that state.
//
// The one performance decision worth knowing: the ocean, the graticule, and
// the neutral land never change, so they are painted once into an offscreen
// canvas and blitted each frame. Re-projecting every country outline sixty
// times a second is the difference between this running on a phone and not.
// Only the handful of countries the traveller reached, the arcs, and the pins
// are redrawn per frame.

import type { CountryShape } from "@/lib/poster/countries";
import {
  drawMap,
  familyArcColor,
  familyArcDash,
} from "@/lib/poster/draw-map";
import {
  boundsOfProjectedPoints,
  fitProjectionToBounds,
  projectPath,
  robinsonProjection,
  tracePath,
  traceOutline,
  type MapFrame,
} from "@/lib/poster/projection";
import type { PosterTheme } from "@/lib/poster/theme";
import { type ArcFamily } from "@/lib/transport";

export interface YearMapPoint {
  lat: number;
  lng: number;
}

export interface YearMapArc {
  /** [lng, lat] positions, already densified. */
  coords: [number, number][];
  family: ArcFamily;
}

export interface YearMapView {
  frame: MapFrame;
  /** Ocean, graticule, and neutral land, painted once. */
  base: HTMLCanvasElement;
  width: number;
  height: number;
  dpr: number;
  shapeByCode: Map<string, CountryShape[]>;
  theme: PosterTheme;
}

/** Graticule spacing that stays a grid rather than becoming noise or a single
 * line, given how much of the world the frame is showing. Mirrors
 * graticuleStepForRadius, which does the same job for the globe framings. */
function graticuleStepForSpan(spanX: number): number {
  if (spanX > 3.5) return 30;
  if (spanX > 1.6) return 15;
  if (spanX > 0.9) return 10;
  return 5;
}

/**
 * A flat Robinson map rather than a globe, deliberately. A year is a set of
 * places that can be anywhere, and half of them falling off the back of a
 * sphere would be a worse answer than a projection that shows all of them at
 * once.
 *
 * Framed to the year rather than to the planet, for the same reason the share
 * card's inset is: a year spent in Iceland on a whole-world map is a four
 * pixel route in the corner of an empty ocean. A year that genuinely spans
 * everything gets the whole map back, because the bounds are clamped to what
 * the projection can draw.
 */
export function buildYearMapView(
  shapes: CountryShape[],
  theme: PosterTheme,
  points: YearMapPoint[],
  width: number,
  height: number,
  dpr: number,
): YearMapView | null {
  if (width <= 0 || height <= 0) return null;
  const base = document.createElement("canvas");
  base.width = Math.round(width * dpr);
  base.height = Math.round(height * dpr);
  const context = base.getContext("2d");
  if (!context) return null;
  context.scale(dpr, dpr);

  const projection = robinsonProjection();
  const bounds = boundsOfProjectedPoints(projection, points);
  const frame = fitProjectionToBounds(projection, bounds, 0, 0, width, height);
  const graticuleStep = graticuleStepForSpan(bounds[2] - bounds[0]);

  drawMap(context, frame, {
    shapes,
    theme,
    visitedCodes: new Set<string>(),
    bucketCodes: new Set<string>(),
    legs: [],
    pins: [],
    unit: width,
    graticuleStep,
  });

  const shapeByCode = new Map<string, CountryShape[]>();
  for (const shape of shapes) {
    if (!shape.code) continue;
    const list = shapeByCode.get(shape.code) ?? [];
    list.push(shape);
    shapeByCode.set(shape.code, list);
  }

  return { frame, base, width, height, dpr, shapeByCode, theme };
}

export interface YearMapFrameState {
  /** Countries filled in so far. */
  revealedCodes: Set<string>;
  /** Legs already drawn, in full. */
  legs: YearMapArc[];
  /** The leg currently drawing, already sliced to its progress. */
  active: YearMapArc | null;
  pins: YearMapPoint[];
  /** The leading tip of the active leg, tinted to its family. */
  head: { point: YearMapPoint; family: ArcFamily } | null;
}

/** Paint one frame of the year. The context is expected to be untransformed;
 * the device pixel ratio is applied here. */
export function drawYearMapFrame(
  context: CanvasRenderingContext2D,
  view: YearMapView,
  state: YearMapFrameState,
): void {
  const { frame, theme, width, height, dpr } = view;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, Math.round(width * dpr), Math.round(height * dpr));
  context.drawImage(view.base, 0, 0);
  context.scale(dpr, dpr);
  context.lineJoin = "round";
  context.lineCap = "round";

  const hairline = Math.max(0.5, width * 0.0007);
  const arcWidth = Math.max(1, width * 0.0028);
  const pinRadius = Math.max(1.6, width * 0.0055);

  // Everything below is inside the projection's boundary: a country outline
  // running past the crop must not spill onto the slide.
  context.save();
  context.beginPath();
  traceOutline(context, frame);
  context.clip();

  // 1. Countries reached so far.
  for (const code of state.revealedCodes) {
    for (const shape of view.shapeByCode.get(code) ?? []) {
      context.beginPath();
      for (const ring of shape.rings) {
        tracePath(context, projectPath(frame, ring), true);
      }
      context.fillStyle = theme.visited;
      context.fill("evenodd");
      context.strokeStyle = theme.visitedStroke;
      context.lineWidth = hairline * 1.8;
      context.stroke();
    }
  }

  // 2. Arcs, one pass per family so each keeps its own dash pattern. Three
  // passes rather than one for the same reason the globe uses three layers:
  // a dash pattern is a property of the stroke, not of the path.
  const byFamily = new Map<ArcFamily, [number, number][][]>();
  const collect = (arc: YearMapArc) => {
    const runs = byFamily.get(arc.family) ?? [];
    runs.push(arc.coords);
    byFamily.set(arc.family, runs);
  };
  for (const leg of state.legs) collect(leg);
  if (state.active) collect(state.active);

  for (const [family, coordRuns] of byFamily) {
    const runs = coordRuns.flatMap((coords) => projectPath(frame, coords));
    if (runs.length === 0) continue;
    const color = familyArcColor(family, theme);
    if (family === "air" && theme.arcGlow) {
      context.beginPath();
      tracePath(context, runs, false);
      context.setLineDash([]);
      context.strokeStyle = theme.arcGlow;
      context.lineWidth = arcWidth * 3.6;
      context.stroke();
    }
    context.beginPath();
    tracePath(context, runs, false);
    context.setLineDash(familyArcDash(family, arcWidth));
    context.strokeStyle = color;
    context.lineWidth = arcWidth;
    context.stroke();
    context.setLineDash([]);
  }

  // 3. Pins, then the moving head on top of them.
  for (const pin of state.pins) {
    const point = frame.point(pin.lng, pin.lat);
    if (!point) continue;
    context.beginPath();
    context.arc(point[0], point[1], pinRadius, 0, Math.PI * 2);
    context.fillStyle = theme.pin;
    context.fill();
    context.strokeStyle = theme.pinStroke;
    context.lineWidth = pinRadius * 0.42;
    context.stroke();
  }

  if (state.head) {
    const point = frame.point(state.head.point.lng, state.head.point.lat);
    if (point) {
      const color = familyArcColor(state.head.family, theme);
      context.beginPath();
      context.arc(point[0], point[1], pinRadius * 1.5, 0, Math.PI * 2);
      context.fillStyle = color;
      context.globalAlpha = 0.28;
      context.fill();
      context.globalAlpha = 1;
      context.beginPath();
      context.arc(point[0], point[1], pinRadius * 0.7, 0, Math.PI * 2);
      context.fillStyle = color;
      context.fill();
    }
  }

  context.restore();

  // 4. The frame of the map, outside the clip so the stroke is not half eaten.
  context.beginPath();
  traceOutline(context, frame);
  context.strokeStyle = theme.sphere;
  context.lineWidth = hairline * 2;
  context.stroke();

  context.restore();
}

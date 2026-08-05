// The map itself: country fills, arcs, and pins, painted into a fitted frame.
//
// Shared by the poster and the share card so the two never drift into looking
// like different products. Everything is drawn from geometry at whatever size
// the frame was given, which is the whole reason the poster can be a print
// file rather than an upscaled screenshot.

import { greatCirclePoints } from "@/lib/geo";
import type { CountryShape } from "@/lib/poster/countries";
import {
  graticule,
  projectPath,
  traceOutline,
  tracePath,
  type MapFrame,
} from "@/lib/poster/projection";
import type { PosterTheme } from "@/lib/poster/theme";

export interface MapPin {
  lat: number;
  lng: number;
}

export interface MapLeg {
  from: [number, number];
  to: [number, number];
}

export interface DrawMapOptions {
  shapes: CountryShape[];
  theme: PosterTheme;
  visitedCodes: Set<string>;
  bucketCodes: Set<string>;
  legs: MapLeg[];
  pins: MapPin[];
  /**
   * The reference length line weights and pin sizes scale against, so a 3600px
   * poster and a 400px inset card carry visually identical hairlines. Defaults
   * to the frame's own width.
   */
  unit?: number;
  graticuleStep?: number | null;
  /** Pin radius as a fraction of the unit. */
  pinScale?: number;
  /**
   * Multiplier on every line weight. Weights are a fraction of `unit`, which
   * keeps a poster's hairlines hairline, but an inset disc is small enough
   * that the same fraction lands under a pixel and the route disappears. The
   * inset asks for thicker lines relative to its size; the poster leaves this
   * at 1.
   */
  lineScale?: number;
}

/** Segments per arc. Enough that a transatlantic curve has no visible facets
 * at 3600px, cheap enough that a few hundred arcs cost nothing. */
const ARC_SEGMENTS = 96;

function fillRings(
  context: CanvasRenderingContext2D,
  frame: MapFrame,
  shape: CountryShape,
  fill: string,
  stroke: string | null,
  strokeWidth: number,
): void {
  context.beginPath();
  for (const ring of shape.rings) {
    tracePath(context, projectPath(frame, ring), true);
  }
  context.fillStyle = fill;
  context.fill("evenodd");
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = strokeWidth;
    context.stroke();
  }
}

/**
 * Paint the map into the frame. The caller has already placed the frame and,
 * for a globe, should clip to its disc: this function draws inside whatever
 * clip is active but sets none of its own.
 */
export function drawMap(
  context: CanvasRenderingContext2D,
  frame: MapFrame,
  options: DrawMapOptions,
): void {
  const {
    shapes,
    theme,
    visitedCodes,
    bucketCodes,
    legs,
    pins,
    graticuleStep = 30,
    pinScale = 0.0042,
    lineScale = 1,
  } = options;
  const unit = options.unit ?? frame.box[2];
  const hairline = Math.max(0.5, unit * 0.0007 * lineScale);

  context.save();
  context.lineJoin = "round";
  context.lineCap = "round";

  // 1. The projected world, as a ground for everything else. Clipping to it
  // as well as filling it is what stops a coastline running past the edge of
  // a cropped map, or off the limb of a globe, from spilling onto the page.
  context.beginPath();
  traceOutline(context, frame);
  context.fillStyle = theme.ocean;
  context.fill();
  context.clip();

  // 2. Graticule, under the land so it reads as a grid the world sits on.
  if (graticuleStep) {
    context.beginPath();
    for (const line of graticule(graticuleStep)) {
      tracePath(context, projectPath(frame, line), false);
    }
    context.strokeStyle = theme.graticule;
    context.lineWidth = hairline;
    context.stroke();
  }

  // 3. Land, in three passes so the fills never overpaint each other's edges.
  for (const shape of shapes) {
    if (visitedCodes.has(shape.code) || bucketCodes.has(shape.code)) continue;
    fillRings(context, frame, shape, theme.land, theme.landStroke, hairline);
  }
  for (const shape of shapes) {
    if (!shape.code || !bucketCodes.has(shape.code)) continue;
    if (visitedCodes.has(shape.code)) continue;
    fillRings(
      context,
      frame,
      shape,
      theme.bucket,
      theme.bucketStroke,
      hairline * 1.4,
    );
  }
  for (const shape of shapes) {
    if (!shape.code || !visitedCodes.has(shape.code)) continue;
    fillRings(
      context,
      frame,
      shape,
      theme.visited,
      theme.visitedStroke,
      hairline * 1.8,
    );
  }

  // 4. Arcs. The glow is a second wider stroke rather than a shadowBlur:
  // blurring a path across a 39 megapixel canvas costs seconds, and a
  // translucent underlay is indistinguishable at print size.
  if (legs.length > 0) {
    const runs = legs.flatMap((leg) =>
      projectPath(frame, greatCirclePoints(leg.from, leg.to, ARC_SEGMENTS)),
    );
    const arcWidth = Math.max(0.7, unit * 0.0013 * lineScale);
    if (theme.arcGlow) {
      context.beginPath();
      tracePath(context, runs, false);
      context.strokeStyle = theme.arcGlow;
      // Tied to the arc rather than to the unit, so the halo stays in
      // proportion to the line it is haloing at any line scale.
      context.lineWidth = arcWidth * 3.6;
      context.stroke();
    }
    context.beginPath();
    tracePath(context, runs, false);
    context.strokeStyle = theme.arc;
    context.lineWidth = arcWidth;
    context.stroke();
  }

  // 5. Pins last: they are the point of the whole picture.
  const radius = Math.max(1.2, unit * pinScale);
  for (const pin of pins) {
    const point = frame.point(pin.lng, pin.lat);
    if (!point) continue;
    context.beginPath();
    context.arc(point[0], point[1], radius, 0, Math.PI * 2);
    context.fillStyle = theme.pin;
    context.fill();
    context.strokeStyle = theme.pinStroke;
    context.lineWidth = radius * 0.42;
    context.stroke();
  }

  context.restore();

  // 6. The boundary of the projection, outside the clip so the stroke is not
  // half-eaten by it: the edge of the world should be a clean line rather
  // than a stack of clipped coastlines.
  context.save();
  context.beginPath();
  traceOutline(context, frame);
  context.strokeStyle = theme.sphere;
  context.lineWidth = hairline * 2;
  context.stroke();
  context.restore();
}

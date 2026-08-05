// Map projections for the exported image compositions.
//
// Pure, client-safe, and deliberately independent of MapLibre. A poster does
// not need basemap tiles: it needs country shapes, arcs, and pins, all of
// which are geometry the app already ships (public/data/countries.geojson).
// Projecting that geometry directly is what lets the poster render at print
// resolution, since nothing in the pipeline is pixel-bound.
//
// Two projections, because they answer two different questions:
//
//   - Robinson, the flat world map. The classic wall-map compromise: neither
//     equal-area nor conformal, chosen because it is the one that looks right.
//     Equirectangular was the alternative and it stretches the poles into a
//     band of nonsense across the top of a poster.
//   - Orthographic, the globe. A view from infinitely far away, centred on
//     wherever the traveller has actually been, so the hemisphere that fills
//     the disc is the one with their life on it.

/** A point in the projection's own unit space, y increasing downward. */
export type UnitPoint = [number, number];

export interface Projection {
  /** Project [lng, lat] into unit space, or null when it is not visible. */
  project(lng: number, lat: number): UnitPoint | null;
  /** [minX, minY, maxX, maxY] of everything this projection can draw. */
  extent: [number, number, number, number];
  /**
   * True when the projection repeats east to west, so a path stepping across
   * the antimeridian must be cut rather than drawn straight back across the
   * whole map.
   */
  cylindrical: boolean;
  /**
   * Signed visibility: positive is in front of the horizon, negative behind.
   * Flat projections return a constant, so callers never special-case them.
   * Used to interpolate the exact point a path crosses the limb of a globe.
   */
  horizon(lng: number, lat: number): number;
  /** The boundary of the projected world, as unit-space rings. */
  outline(): UnitPoint[][];
}

const DEG = Math.PI / 180;

// --- Robinson ---------------------------------------------------------------

// The published Robinson table, one entry per 5 degrees of latitude from the
// equator to the pole. AA scales the parallel's length, BB its distance from
// the equator. Values between table rows are interpolated linearly, which is
// how the projection is defined in practice (it has no closed form).
const ROBINSON_AA = [
  1.0, 0.9986, 0.9954, 0.99, 0.9822, 0.973, 0.96, 0.9427, 0.9216, 0.8962,
  0.8679, 0.835, 0.7986, 0.7597, 0.7186, 0.6732, 0.6213, 0.5722, 0.5322,
];
const ROBINSON_BB = [
  0.0, 0.062, 0.124, 0.186, 0.248, 0.31, 0.372, 0.434, 0.4958, 0.5571, 0.6176,
  0.6769, 0.7346, 0.7903, 0.8435, 0.8936, 0.9394, 0.9761, 1.0,
];
const ROBINSON_X = 0.8487;
const ROBINSON_Y = 1.3523;

function robinsonFactors(absLat: number): [number, number] {
  const clamped = Math.min(90, absLat);
  const index = Math.min(17, Math.floor(clamped / 5));
  const t = (clamped - index * 5) / 5;
  return [
    ROBINSON_AA[index] + (ROBINSON_AA[index + 1] - ROBINSON_AA[index]) * t,
    ROBINSON_BB[index] + (ROBINSON_BB[index + 1] - ROBINSON_BB[index]) * t,
  ];
}

function robinsonY(lat: number): number {
  const [, bb] = robinsonFactors(Math.abs(lat));
  // Canvas y grows downward, so northern latitudes get the negative half.
  return -ROBINSON_Y * bb * Math.sign(lat);
}

/**
 * Robinson, optionally cropped to a latitude band.
 *
 * The crop is not a compromise, it is the point. A full 90 to -90 world map is
 * a third empty: a band of Arctic ocean across the top and an Antarctic mass
 * across the bottom that nobody's travel history touches. Cutting them makes
 * the map wider relative to its height, which is what lets it run the full
 * width of the poster instead of floating in the middle of it. The caller
 * widens the band to cover any stop that falls outside it, so cropping can
 * never lose a pin.
 */
export function robinsonProjection(
  latRange: [number, number] = [-90, 90],
): Projection {
  const halfWidth = ROBINSON_X * Math.PI;
  const [latMin, latMax] = latRange;
  return {
    cylindrical: true,
    extent: [-halfWidth, robinsonY(latMax), halfWidth, robinsonY(latMin)],
    horizon: () => 1,
    project(lng, lat) {
      const [aa] = robinsonFactors(Math.abs(lat));
      return [ROBINSON_X * aa * lng * DEG, robinsonY(lat)];
    },
    outline() {
      const ring: UnitPoint[] = [];
      for (let lat = latMin; lat <= latMax; lat += 1) {
        ring.push(this.project(180, lat) as UnitPoint);
      }
      ring.push(this.project(180, latMax) as UnitPoint);
      for (let lat = latMax; lat >= latMin; lat -= 1) {
        ring.push(this.project(-180, lat) as UnitPoint);
      }
      ring.push(this.project(-180, latMin) as UnitPoint);
      return [ring];
    },
  };
}

/**
 * The latitude band a flat poster should draw: the default crop, widened to
 * include every stop with a little air around it. A traveller with a stop in
 * Antarctica gets a taller map rather than a missing pin.
 */
export function posterLatitudeRange(
  points: { lat: number }[],
  defaultRange: [number, number] = [-58, 84],
): [number, number] {
  let min = defaultRange[0];
  let max = defaultRange[1];
  for (const point of points) {
    if (point.lat - 4 < min) min = Math.max(-90, point.lat - 4);
    if (point.lat + 4 > max) max = Math.min(90, point.lat + 4);
  }
  return [min, max];
}

// --- Orthographic -----------------------------------------------------------

/**
 * Orthographic, optionally cropped to a disc smaller than the full hemisphere.
 *
 * `radius` is in projected units, where 1 is the limb of the sphere: a point
 * an angular distance c from the centre lands at sin(c), so radius 0.3 shows a
 * cap about 17 degrees across. Anything below 1 is a zoom, and the visible
 * boundary stops being the limb and becomes the crop, which is why `outline`
 * reports the smaller circle. Everything downstream (the ocean fill, the clip,
 * the ring) follows from that one number.
 *
 * The poster uses radius 1 and draws a whole planet. The share card's inset
 * fits the radius to the trip, because a Europe trip on a full hemisphere is a
 * cluster of dots nobody can read.
 */
export function orthographicProjection(
  centerLng: number,
  centerLat: number,
  radius = 1,
): Projection {
  const lambda0 = centerLng * DEG;
  const phi0 = centerLat * DEG;
  const sinPhi0 = Math.sin(phi0);
  const cosPhi0 = Math.cos(phi0);

  const cosC = (lng: number, lat: number): number => {
    const phi = lat * DEG;
    const delta = lng * DEG - lambda0;
    return sinPhi0 * Math.sin(phi) + cosPhi0 * Math.cos(phi) * Math.cos(delta);
  };

  return {
    cylindrical: false,
    extent: [-radius, -radius, radius, radius],
    horizon: cosC,
    project(lng, lat) {
      if (cosC(lng, lat) < 0) return null;
      const phi = lat * DEG;
      const delta = lng * DEG - lambda0;
      return [
        Math.cos(phi) * Math.sin(delta),
        -(cosPhi0 * Math.sin(phi) - sinPhi0 * Math.cos(phi) * Math.cos(delta)),
      ];
    },
    outline() {
      const ring: UnitPoint[] = [];
      for (let i = 0; i <= 360; i += 1) {
        const angle = i * DEG;
        ring.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
      }
      return [ring];
    },
  };
}

/**
 * The projected radius that fits a set of points inside an orthographic disc,
 * with air around them.
 *
 * Two clamps matter. `min` stops a single-city trip from becoming a
 * meaningless close-up of one dot on a featureless disc: below roughly a tenth
 * of the sphere's radius there is no coastline left to recognise. And a point
 * more than 90 degrees away is behind the horizon and cannot be fitted at all,
 * so a globe-spanning trip falls back to the full hemisphere rather than to
 * some radius that pretends to contain it.
 */
export function fitOrthographicRadius(
  center: { lng: number; lat: number },
  points: { lat: number; lng: number }[],
  { padding = 0.35, min = 0.17 }: { padding?: number; min?: number } = {},
): number {
  if (points.length === 0) return min;
  const lambda0 = center.lng * DEG;
  const phi0 = center.lat * DEG;
  const sinPhi0 = Math.sin(phi0);
  const cosPhi0 = Math.cos(phi0);

  let furthest = 0;
  for (const point of points) {
    const phi = point.lat * DEG;
    const delta = point.lng * DEG - lambda0;
    const cosC =
      sinPhi0 * Math.sin(phi) + cosPhi0 * Math.cos(phi) * Math.cos(delta);
    if (cosC < 0) return 1;
    // sin(c) from cos(c), which is the projected distance from the centre.
    furthest = Math.max(furthest, Math.sqrt(Math.max(0, 1 - cosC * cosC)));
  }
  return Math.min(1, Math.max(min, furthest * (1 + padding)));
}

/** Graticule spacing that stays a grid rather than becoming noise or a single
 * line, given how much of the sphere a disc is showing. */
export function graticuleStepForRadius(radius: number): number {
  if (radius > 0.6) return 30;
  if (radius > 0.32) return 15;
  if (radius > 0.2) return 10;
  return 5;
}

/**
 * The centre a globe framing should use for a set of points: the direction of
 * their average position on the sphere. Averaging degrees instead would put a
 * traveller with stops either side of the antimeridian in the middle of
 * Africa. Falls back to a view of the land hemisphere when there is nothing.
 *
 * `clampLatitude` tilts a polar view back toward the equator, which is right
 * for the poster (a whole globe centred at 68N is mostly ice, and the arcs
 * that matter fall off the limb) and wrong for the share card's zoomed inset,
 * where tilting away would push an Iceland trip off its own map.
 */
export function globeCenter(
  points: { lat: number; lng: number }[],
  { clampLatitude = true }: { clampLatitude?: boolean } = {},
): { lng: number; lat: number } {
  if (points.length === 0) return { lng: 10, lat: 25 };
  let x = 0;
  let y = 0;
  let z = 0;
  for (const point of points) {
    const phi = point.lat * DEG;
    const lambda = point.lng * DEG;
    x += Math.cos(phi) * Math.cos(lambda);
    y += Math.cos(phi) * Math.sin(lambda);
    z += Math.sin(phi);
  }
  const length = Math.hypot(x, y, z);
  if (length < 1e-9) return { lng: 10, lat: 25 };
  const lat = (Math.asin(z / length) * 180) / Math.PI;
  return {
    lng: (Math.atan2(y, x) * 180) / Math.PI,
    lat: clampLatitude ? Math.max(-60, Math.min(60, lat)) : lat,
  };
}

// --- Canvas placement -------------------------------------------------------

export interface MapFrame {
  projection: Projection;
  /** Unit space to canvas pixels. */
  toCanvas(point: UnitPoint): UnitPoint;
  /** Project straight to canvas pixels, or null when not visible. */
  point(lng: number, lat: number): UnitPoint | null;
  /** The box the map actually occupies: [x, y, width, height]. */
  box: [number, number, number, number];
  scale: number;
}

/**
 * Fit a projection into a box, preserving its aspect and centring it. The box
 * is what the poster's layout allocated; the frame is the part of it the map
 * fills.
 */
export function fitProjection(
  projection: Projection,
  x: number,
  y: number,
  width: number,
  height: number,
): MapFrame {
  const [minX, minY, maxX, maxY] = projection.extent;
  const unitWidth = maxX - minX;
  const unitHeight = maxY - minY;
  const scale = Math.min(width / unitWidth, height / unitHeight);
  const drawWidth = unitWidth * scale;
  const drawHeight = unitHeight * scale;
  const offsetX = x + (width - drawWidth) / 2 - minX * scale;
  const offsetY = y + (height - drawHeight) / 2 - minY * scale;

  const toCanvas = (point: UnitPoint): UnitPoint => [
    offsetX + point[0] * scale,
    offsetY + point[1] * scale,
  ];

  return {
    projection,
    toCanvas,
    scale,
    box: [
      x + (width - drawWidth) / 2,
      y + (height - drawHeight) / 2,
      drawWidth,
      drawHeight,
    ],
    point(lng, lat) {
      const projected = projection.project(lng, lat);
      return projected ? toCanvas(projected) : null;
    },
  };
}

// --- Path construction ------------------------------------------------------

// Where a segment crosses the horizon of a globe, to within a pixel. Ten
// bisections over a segment that is at most a few degrees long is far finer
// than the output resolution, and it is what stops coastlines from ending in
// a visible step short of the limb.
function horizonCrossing(
  projection: Projection,
  visible: [number, number],
  hidden: [number, number],
): UnitPoint | null {
  let near = visible;
  let far = hidden;
  for (let i = 0; i < 10; i += 1) {
    const mid: [number, number] = [
      (near[0] + far[0]) / 2,
      (near[1] + far[1]) / 2,
    ];
    if (projection.horizon(mid[0], mid[1]) >= 0) near = mid;
    else far = mid;
  }
  return projection.project(near[0], near[1]);
}

/**
 * Turn a run of [lng, lat] positions into canvas-space polylines, cut wherever
 * the path leaves the visible hemisphere or jumps the antimeridian seam.
 * Returns one array per continuous stretch; a caller strokes or fills each.
 */
export function projectPath(
  frame: MapFrame,
  positions: [number, number][],
): UnitPoint[][] {
  const { projection } = frame;
  const seamLimit = (projection.extent[2] - projection.extent[0]) / 2;
  const runs: UnitPoint[][] = [];
  let current: UnitPoint[] = [];
  let previousUnit: UnitPoint | null = null;
  let previousPosition: [number, number] | null = null;

  const flush = () => {
    if (current.length > 1) runs.push(current);
    current = [];
  };

  for (const position of positions) {
    const [lng, lat] = position;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const unit = projection.project(lng, lat);

    if (!unit) {
      // Leaving the visible hemisphere: finish on the limb rather than in
      // mid-air, then start a new run when the path comes back.
      if (previousUnit && previousPosition) {
        const crossing = horizonCrossing(projection, previousPosition, position);
        if (crossing) current.push(frame.toCanvas(crossing));
      }
      flush();
      previousUnit = null;
      previousPosition = position;
      continue;
    }

    if (previousUnit && Math.abs(unit[0] - previousUnit[0]) > seamLimit) {
      // A cylindrical seam crossing. Cutting is the only honest answer: the
      // alternative is a line straight back across the entire map.
      flush();
    } else if (!previousUnit && previousPosition) {
      // Re-entering: pick the path back up at the limb.
      const crossing = horizonCrossing(projection, position, previousPosition);
      if (crossing) current.push(frame.toCanvas(crossing));
    }

    current.push(frame.toCanvas(unit));
    previousUnit = unit;
    previousPosition = position;
  }

  flush();
  return runs;
}

/** Trace a set of polylines onto a context as one path. */
export function tracePath(
  context: CanvasRenderingContext2D,
  runs: UnitPoint[][],
  close: boolean,
): void {
  for (const run of runs) {
    if (run.length < 2) continue;
    context.moveTo(run[0][0], run[0][1]);
    for (let i = 1; i < run.length; i += 1) {
      context.lineTo(run[i][0], run[i][1]);
    }
    if (close) context.closePath();
  }
}

/**
 * Trace the projection's boundary into the current path, in canvas space.
 * Callers clip to it before drawing the map: a coastline that runs past the
 * limb of a globe, or past a cropped map's edge, must not spill onto the page.
 */
export function traceOutline(
  context: CanvasRenderingContext2D,
  frame: MapFrame,
): void {
  for (const ring of frame.projection.outline()) {
    tracePath(context, [ring.map((point) => frame.toCanvas(point))], true);
  }
}

/** Meridians and parallels at a fixed spacing, as [lng, lat] runs. */
export function graticule(stepDegrees: number): [number, number][][] {
  const lines: [number, number][][] = [];
  for (let lng = -180; lng <= 180; lng += stepDegrees) {
    const line: [number, number][] = [];
    for (let lat = -90; lat <= 90; lat += 2) line.push([lng, lat]);
    lines.push(line);
  }
  for (let lat = -90 + stepDegrees; lat < 90; lat += stepDegrees) {
    const line: [number, number][] = [];
    for (let lng = -180; lng <= 180; lng += 2) line.push([lng, lat]);
    lines.push(line);
  }
  return lines;
}

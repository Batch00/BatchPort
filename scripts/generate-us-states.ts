// Generate src/lib/us-states-geometry.ts: the 50 states and DC as projected,
// simplified SVG paths for the stats page's states map.
//
// Run with: npm run generate-us-states
//
// WHY A GENERATED FILE. The map never pans or zooms, so projecting it at run
// time would ship 7MB of Census boundaries (or a projection library) to draw
// a picture that is identical on every visit. Projecting once, here, turns
// that into a few dozen KB of path strings and no runtime geometry at all.
//
// THE SOURCE IS THE SAME FILE admin1_boundaries WAS LOADED FROM
// (scripts/data/us-admin1.geojson, Census cb_2023_us_state_500k). So the
// shapes on screen are the shapes v_state_coverage resolves points against,
// simplified for drawing. A state that fills is a state the SQL put a point
// in; there is no second boundary set to disagree with it.
//
// PROJECTION: Albers equal-area conic, the composite "Albers USA" layout.
// The lower 48 use standard parallels 29.5 and 45.5 centred on 96W; Alaska and
// Hawaii are projected with their own parallels and inset bottom-left, Alaska
// at 0.35 scale (the convention, and the only way it fits), Hawaii at 1:1.
// Equal-area matters for a choropleth: a visited state's share of the ink is
// its share of the land, so Texas is not inflated and New England is not
// shrunk more than it already is.
//
// Do not hand-edit the output. Change this script and re-run it.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Ring = [number, number][];
type Polygon = Ring[];

interface Feature {
  properties: { name: string; postal: string };
  geometry:
    | { type: "Polygon"; coordinates: Polygon }
    | { type: "MultiPolygon"; coordinates: Polygon[] };
}

interface Conic {
  lon0: number;
  lat0: number;
  p1: number;
  p2: number;
}

const RAD = Math.PI / 180;

// Albers equal-area conic on the unit sphere. Returns SVG orientation (y
// grows downward).
function albers(c: Conic): (lon: number, lat: number) => [number, number] {
  const phi1 = c.p1 * RAD;
  const phi2 = c.p2 * RAD;
  const n = (Math.sin(phi1) + Math.sin(phi2)) / 2;
  const C = Math.cos(phi1) ** 2 + 2 * n * Math.sin(phi1);
  const rho0 = Math.sqrt(C - 2 * n * Math.sin(c.lat0 * RAD)) / n;
  return (lon, lat) => {
    // Wrap into [-180, 180) around the central meridian, which is what keeps
    // the Aleutians past 180 degrees attached to the rest of Alaska.
    let dLon = lon - c.lon0;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    const rho = Math.sqrt(C - 2 * n * Math.sin(lat * RAD)) / n;
    const theta = n * dLon * RAD;
    return [rho * Math.sin(theta), -(rho0 - rho * Math.cos(theta))];
  };
}

const LOWER48: Conic = { lon0: -96, lat0: 38, p1: 29.5, p2: 45.5 };
const ALASKA: Conic = { lon0: -154, lat0: 58.5, p1: 55, p2: 65 };
const HAWAII: Conic = { lon0: -157, lat0: 19.9, p1: 8, p2: 18 };

// The drawing's width in viewBox units. Every tolerance below is in these
// units, so they are pixels at the desktop size and a fraction of a pixel on
// a phone.
const WIDTH = 960;
const PAD = 8;
const ALASKA_SCALE = 0.35;
// Douglas-Peucker tolerance. Half a unit keeps coastlines recognisable at the
// full width and is a sixth of a pixel at phone width.
const TOLERANCE = 0.5;
// Rings smaller than this (square units) are dropped unless they are the
// state's largest, which is how thousands of coastal islets go and every
// state keeps its body. Hawaii's inhabited islands are all far above it.
const MIN_RING_AREA = 2;

// The Census Hawaii polygon includes the Northwestern Hawaiian Islands, which
// run 1,900km out to Kure Atoll. Kept, they stretch Hawaii's inset across a
// third of the drawing to show specks nobody can see; the Albers USA
// convention draws the main islands only, and so does this. A place logged on
// one of them would still resolve to HI in SQL (the boundary table is not
// simplified) and the HI shape would still fill.
const HAWAII_WEST_LIMIT = -161;

function polygonsOf(f: Feature): Polygon[] {
  return f.geometry.type === "Polygon"
    ? [f.geometry.coordinates]
    : f.geometry.coordinates;
}

function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  }
  return Math.abs(a / 2);
}

function simplify(points: Ring, tol: number): Ring {
  if (points.length <= 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let max = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      // A closed ring's first chord runs from a point to itself, so there is
      // no line to measure against: distance to the point is the measure.
      const d =
        len === 0
          ? Math.hypot(points[i][0] - ax, points[i][1] - ay)
          : Math.abs(dy * points[i][0] - dx * points[i][1] + bx * ay - by * ax) / len;
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (max > tol && idx !== -1) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

function bbox(rings: Ring[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rings) {
    for (const [x, y] of r) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return [x0, y0, x1, y1];
}

function main(): void {
  const raw = JSON.parse(
    readFileSync(join(process.cwd(), "scripts/data/us-admin1.geojson"), "utf8"),
  ) as { features: Feature[] };

  // 1. Project every outer and inner ring with its region's conic.
  const projected = raw.features.map((f) => {
    const code = f.properties.postal;
    const conic = code === "AK" ? ALASKA : code === "HI" ? HAWAII : LOWER48;
    const project = albers(conic);
    const rings: Ring[] = [];
    for (const poly of polygonsOf(f)) {
      if (code === "HI" && poly[0].every(([lon]) => lon < HAWAII_WEST_LIMIT)) continue;
      for (const ring of poly) rings.push(ring.map(([lon, lat]) => project(lon, lat)));
    }
    return { code, name: f.properties.name, rings };
  });

  // 2. Scale: the lower 48 fill the width; Alaska and Hawaii are placed
  //    against the lower 48's bottom-left corner.
  const l48 = projected.filter((s) => s.code !== "AK" && s.code !== "HI");
  const [lx0, ly0, lx1, ly1] = bbox(l48.flatMap((s) => s.rings));
  const k = (WIDTH - 2 * PAD) / (lx1 - lx0);
  const place = (rings: Ring[], scale: number, dx: number, dy: number): Ring[] =>
    rings.map((r) => r.map(([x, y]) => [x * scale + dx, y * scale + dy] as [number, number]));

  const out: { code: string; name: string; rings: Ring[] }[] = [];
  for (const s of l48) {
    out.push({ ...s, rings: place(s.rings, k, PAD - lx0 * k, PAD - ly0 * k) });
  }
  const bottom = PAD + (ly1 - ly0) * k;

  const ak = projected.find((s) => s.code === "AK")!;
  const [ax0, , ax1, ay1] = bbox(ak.rings);
  const akScale = k * ALASKA_SCALE;
  out.push({
    ...ak,
    rings: place(ak.rings, akScale, PAD - ax0 * akScale, bottom - ay1 * akScale),
  });
  const akRight = PAD + (ax1 - ax0) * akScale;

  const hi = projected.find((s) => s.code === "HI")!;
  const [hx0, , , hy1] = bbox(hi.rings);
  out.push({
    ...hi,
    rings: place(hi.rings, k, akRight + 12 - hx0 * k, bottom - hy1 * k),
  });

  // 3. Simplify, drop slivers, and serialise.
  const [, , , vy1] = bbox(out.flatMap((s) => s.rings));
  const height = Math.ceil(vy1 + PAD);
  const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

  const states = out
    .map((s) => {
      // A ring the tolerance would collapse below a triangle keeps its own
      // vertices instead. That is DC (under two units across), which must
      // still exist as a shape even though its marker does the visible work.
      const simplified = s.rings
        .map((r) => {
          const simple = simplify(r, TOLERANCE);
          return simple.length >= 4 ? simple : r;
        })
        .filter((r) => r.length >= 4);
      const largest = Math.max(...simplified.map(ringArea));
      const kept = simplified.filter(
        (r) => ringArea(r) >= MIN_RING_AREA || ringArea(r) === largest,
      );
      const d = kept
        .map((r) => {
          const pts = r.slice(0, -1);
          return (
            "M" +
            pts.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join("L") +
            "Z"
          );
        })
        .join("");
      // Area-weighted centre of the largest ring: where DC's marker goes,
      // and a stable anchor for anything else that needs one.
      const body = kept.reduce((a, r) => (ringArea(r) > ringArea(a) ? r : a));
      const [bx0, by0, bx1, by1] = bbox([body]);
      return {
        code: s.code,
        name: s.name,
        d,
        cx: Math.round(((bx0 + bx1) / 2) * 10) / 10,
        cy: Math.round(((by0 + by1) / 2) * 10) / 10,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const body = `// GENERATED by scripts/generate-us-states.ts from scripts/data/us-admin1.geojson.
// Do not hand-edit: change the script and run \`npm run generate-us-states\`.
//
// Albers USA composite (Alaska at 0.35 and Hawaii inset bottom-left), equal
// area, simplified for drawing. The source is the same Census file that
// batchport.admin1_boundaries was loaded from.

export interface UsStateShape {
  /** Postal code, the same value as admin1_boundaries.code. */
  code: string;
  name: string;
  /** SVG path in US_STATES_VIEWBOX units. */
  d: string;
  /** Centre of the state's largest ring, in the same units. */
  cx: number;
  cy: number;
}

export const US_STATES_WIDTH = ${WIDTH};
export const US_STATES_HEIGHT = ${height};
export const US_STATES_VIEWBOX = "0 0 ${WIDTH} ${height}";

export const US_STATE_SHAPES: UsStateShape[] = ${JSON.stringify(states, null, 2)};
`;
  const target = join(process.cwd(), "src/lib/us-states-geometry.ts");
  writeFileSync(target, body);
  console.log(
    `us-states-geometry: ${states.length} shapes, viewBox 0 0 ${WIDTH} ${height}, ${(body.length / 1024).toFixed(1)} KB`,
  );
}

main();

// The year card: one year, composed as something postable.
//
// Same pipeline as the per-trip share card (canvas over projected geometry,
// same ratios, same 2160px short edge) and it reuses that card's own parts for
// the places line, the stats row, and the highlights. What it does differently
// is lead with the map instead of a photograph, and the reason is that a year
// has no single cover: picking one trip's photograph to stand for twelve
// months would be an editorial claim the data does not support. The map is the
// one image that is genuinely about the whole year.
//
// Everything it draws comes from a YearRecap, which the recap view already
// built, so the card costs no query on any surface and the read-only ones can
// offer it too.

import { countryName } from "@/lib/format";
import { formatKm } from "@/lib/stats-format";
import {
  appFontStack,
  canvasToBlob,
  drawTracked,
  ensureFonts,
  releaseCanvas,
  roundedRectPath,
  setFont,
} from "@/lib/poster/canvas";
import {
  drawHighlights,
  layoutPlaces,
  planHighlights,
  statTileWidth,
  type CardHighlight,
} from "@/lib/poster/card-parts";
import { loadCountryShapes } from "@/lib/poster/countries";
import { drawMap, type MapLeg, type MapPin } from "@/lib/poster/draw-map";
import {
  boundsOfProjectedPoints,
  fitProjectionToBounds,
  robinsonProjection,
} from "@/lib/poster/projection";
import { posterTheme } from "@/lib/poster/theme";
import {
  shareCardRatio,
  type ShareCardRatio,
  type ShareCardRatioInfo,
} from "@/lib/poster/share-card";
import { arcFamily } from "@/lib/transport";
import type { YearRecap } from "@/lib/year-recap";

export interface YearCardData {
  year: number;
  /** "2024", or "2026" with the "so far" note carried separately. */
  yearLabel: string;
  /** The eyebrow above the year. */
  eyebrow: string;
  places: string[];
  pins: MapPin[];
  legs: MapLeg[];
  countryCodes: string[];
  tiles: { value: string; label: string }[];
  highlights: CardHighlight[];
}

/** At most four numbers. A fifth turns a headline into a table. */
const MAX_TILES = 4;

/** Fold a recap into the card's inputs. Pure. */
export function yearCardFromRecap(recap: YearRecap): YearCardData {
  const pins: MapPin[] = recap.mapStops.map((stop) => ({
    lat: stop.lat,
    lng: stop.lng,
  }));

  // Legs run between consecutive stops of the same trip, which is the same
  // rule the globe's arcs follow. Grouping rather than zipping the flat list
  // is what stops a line being drawn from the end of one trip to the start of
  // the next.
  //
  // Each carries its transport family, so the card draws the same three arc
  // languages as the globe, the recap's animated map slide, and the trip share
  // card: air solid blue, ground violet dashed, sea cyan dotted. There is no
  // legend and there is no room for one, which is fine: the families read as
  // texture rather than as a code to look up, and the arriving stop's mode is
  // where a leg lives, so an unannotated year is uniform blue as before.
  const legs: MapLeg[] = [];
  let previous: (typeof recap.mapStops)[number] | null = null;
  for (const stop of recap.mapStops) {
    if (previous && previous.tripId === stop.tripId) {
      legs.push({
        from: [previous.lng, previous.lat],
        to: [stop.lng, stop.lat],
        family: arcFamily(stop.transportMode ?? null),
      });
    }
    previous = stop;
  }

  const tiles: { value: string; label: string }[] = [];
  const { stats } = recap;
  if (stats.countries > 0) {
    tiles.push({
      value: String(stats.countries),
      label: stats.countries === 1 ? "Country" : "Countries",
    });
  }
  if (stats.trips > 0) {
    tiles.push({
      value: String(stats.trips),
      label: stats.trips === 1 ? "Trip" : "Trips",
    });
  }
  if (stats.days > 0) tiles.push({ value: String(stats.days), label: "Days away" });
  if (stats.distanceKm > 0) {
    tiles.push({ value: formatKm(stats.distanceKm), label: "Travelled" });
  }
  if (tiles.length < MAX_TILES && stats.stops > 0) {
    tiles.push({
      value: String(stats.stops),
      label: stats.stops === 1 ? "Stop" : "Stops",
    });
  }

  return {
    year: recap.year,
    yearLabel: String(recap.year),
    eyebrow: recap.inProgress ? "The year so far" : "Year in travel",
    // Country names, for the same reason the trip card uses them: Windows has
    // no colour flag glyphs and a canvas has no image fallback to reach for.
    places: stats.countryCodes.map(countryName),
    pins,
    legs,
    countryCodes: stats.countryCodes,
    tiles: tiles.slice(0, MAX_TILES),
    highlights: recap.moments.map((moment) => ({
      name: moment.name,
      rating: moment.rating,
    })),
  };
}

export interface YearCardAssets {
  shapes: Awaited<ReturnType<typeof loadCountryShapes>>;
  stack: string;
}

export async function loadYearCardAssets(): Promise<YearCardAssets> {
  const stack = appFontStack();
  const [shapes] = await Promise.all([loadCountryShapes(), ensureFonts(stack)]);
  return { shapes, stack };
}

export interface YearCardResult {
  blob: Blob;
  width: number;
  height: number;
}

export async function renderYearCard(
  data: YearCardData,
  ratio: ShareCardRatio,
  assets: YearCardAssets,
): Promise<YearCardResult> {
  const size = shareCardRatio(ratio);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) {
    releaseCanvas(canvas);
    throw new Error("This browser cannot render to a canvas.");
  }
  try {
    drawYearCard(context, size, data, assets);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const blob = await canvasToBlob(canvas, "image/png");
    return { blob, width: size.width, height: size.height };
  } finally {
    releaseCanvas(canvas);
  }
}

/** Draw the card at a smaller size for the dialog's live preview. Same code
 * path as the export, so the preview cannot drift from the output. */
export function drawYearCardPreview(
  context: CanvasRenderingContext2D,
  ratio: ShareCardRatio,
  width: number,
  height: number,
  data: YearCardData,
  assets: YearCardAssets,
): void {
  drawYearCard(
    context,
    { ...shareCardRatio(ratio), width, height },
    data,
    assets,
  );
}

function drawYearCard(
  context: CanvasRenderingContext2D,
  size: ShareCardRatioInfo,
  data: YearCardData,
  assets: YearCardAssets,
): void {
  const { shapes, stack } = assets;
  const { width, height } = size;
  const tall = size.id === "story";
  const theme = posterTheme("midnight");
  const unit = width;
  const margin = unit * 0.078;
  const contentWidth = width - margin * 2;
  const lead = tall ? 1.18 : 1;

  context.textBaseline = "alphabetic";

  // --- Backdrop ------------------------------------------------------------
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#0d1424");
  gradient.addColorStop(0.55, "#080a12");
  gradient.addColorStop(1, "#0a0f1c");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  // A soft brand wash behind the map, the same depth cue the poster uses.
  const glow = context.createRadialGradient(
    width / 2,
    height * 0.46,
    0,
    width / 2,
    height * 0.46,
    width * 0.72,
  );
  glow.addColorStop(0, "rgba(37, 99, 235, 0.16)");
  glow.addColorStop(1, "rgba(37, 99, 235, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  // --- Wordmark ------------------------------------------------------------
  const markSize = unit * 0.019;
  const dotRadius = markSize * 0.34;
  setFont(context, 600, markSize, stack);
  context.beginPath();
  context.arc(margin + dotRadius, margin * 0.92, dotRadius, 0, Math.PI * 2);
  context.fillStyle = theme.accent;
  context.fill();
  context.fillStyle = "rgba(255, 255, 255, 0.78)";
  drawTracked(
    context,
    "BATCHPORT",
    margin + dotRadius * 3.2,
    margin * 0.92 + markSize * 0.36,
    markSize * 0.24,
    "left",
  );

  // --- Header: the eyebrow and the year ------------------------------------
  //
  // Laid out from the top, because the year numeral is the fixed thing on this
  // card and everything else fits around it.
  const eyebrowSize = unit * 0.0215;
  const eyebrowBaseline = margin + markSize * 2.9;
  setFont(context, 500, eyebrowSize, stack);
  context.textAlign = "left";
  context.fillStyle = "rgba(255, 255, 255, 0.55)";
  drawTracked(
    context,
    data.eyebrow.toUpperCase(),
    margin,
    eyebrowBaseline,
    eyebrowSize * 0.2,
    "left",
  );

  // A square has less height to spend and the map is the point, so the numeral
  // gives some of it back there rather than squeezing the map into a strip.
  const yearSize = unit * (tall ? 0.19 : 0.145);
  const yearBaseline = eyebrowBaseline + yearSize * 1.02;
  setFont(context, 600, yearSize, stack);
  context.fillStyle = "#ffffff";
  context.fillText(data.yearLabel, margin, yearBaseline);

  const headerBottom = yearBaseline + yearSize * 0.16;

  // --- Bottom block, measured before anything is painted -------------------
  //
  // Same technique as the trip card: rows carry the distance from their own
  // baseline up to the next one, so the map can be told exactly how much room
  // is left rather than being given a guessed fraction of the height.
  interface Row {
    height: number;
    draw: (baseline: number) => void;
  }
  const rows: Row[] = [];
  const bottomInset = margin * (tall ? 1 : 1.1);
  const blockBaseline = height - bottomInset;

  if (data.highlights.length > 0) {
    const plan = planHighlights(
      context,
      data.highlights,
      contentWidth,
      unit,
      stack,
    );
    rows.push({
      height: plan.labelRise + plan.labelSize * 2.6 * lead,
      draw: (baseline) => {
        drawHighlights(context, plan, margin, baseline, stack, "BEST OF THE YEAR");
      },
    });
  }

  const tileValueSize = unit * 0.046;
  const tileLabelSize = unit * 0.0165;
  const tileGap = unit * 0.06;
  const tileWidths = data.tiles.map((tile) =>
    statTileWidth(context, tile, tileValueSize, tileLabelSize, stack),
  );
  const statsValueRise = tileLabelSize * 1.95;
  const statsRuleRise = statsValueRise + tileValueSize * 1.2;

  if (data.tiles.length > 0) {
    rows.push({
      height: statsRuleRise + unit * 0.05 * lead,
      draw: (baseline) => {
        const valueBaseline = baseline - statsValueRise;
        let cursor = margin;
        data.tiles.forEach((tile, index) => {
          setFont(context, 600, tileValueSize, stack);
          context.textAlign = "left";
          context.fillStyle = "#ffffff";
          context.fillText(tile.value, cursor, valueBaseline);
          setFont(context, 500, tileLabelSize, stack);
          context.fillStyle = "rgba(255, 255, 255, 0.55)";
          drawTracked(
            context,
            tile.label.toUpperCase(),
            cursor,
            baseline,
            tileLabelSize * 0.22,
            "left",
          );
          cursor += tileWidths[index] + tileGap;
        });

        const ruleY = baseline - statsRuleRise;
        context.beginPath();
        context.moveTo(margin, ruleY);
        context.lineTo(margin + contentWidth, ruleY);
        context.strokeStyle = "rgba(255, 255, 255, 0.20)";
        context.lineWidth = Math.max(1, unit * 0.0012);
        context.stroke();
      },
    });
  }

  // The countries line, never truncated: it shrinks, then wraps between names.
  if (data.places.length > 0) {
    const places = layoutPlaces(
      context,
      data.places,
      contentWidth,
      unit * 0.0235,
      stack,
    );
    rows.push({
      height:
        places.size * 1.35 * (places.lines.length - 1) + places.size * 2.1 * lead,
      draw: (baseline) => {
        setFont(context, 500, places.size, stack);
        context.textAlign = "left";
        context.fillStyle = "rgba(255, 255, 255, 0.68)";
        let y = baseline - places.size * 1.35 * (places.lines.length - 1);
        for (const line of places.lines) {
          context.fillText(line, margin, y);
          y += places.size * 1.35;
        }
      },
    });
  }

  const blockHeight = rows.reduce((total, row) => total + row.height, 0);
  const blockTop = blockBaseline - blockHeight;

  // --- The map, in whatever is left ----------------------------------------
  //
  // Map-first, the same rule the poster follows: the chrome is fitted around
  // the map rather than the map being given the leftovers of the chrome. Here
  // that means the full content width and every pixel between the header and
  // the measured block.
  const mapTop = headerBottom + unit * 0.03;
  const mapBottom = blockTop - unit * 0.045;
  const mapHeight = mapBottom - mapTop;

  if (mapHeight > unit * 0.12 && data.pins.length > 0) {
    // Framed to the year, not to the planet, the same call the recap's
    // animated map makes: a year spent in one region on a whole-world map is a
    // few pixels of route in the corner of an empty ocean.
    const projection = robinsonProjection();
    const bounds = boundsOfProjectedPoints(projection, data.pins);
    const frame = fitProjectionToBounds(
      projection,
      bounds,
      margin,
      mapTop,
      contentWidth,
      mapHeight,
    );
    const radius = unit * 0.03;

    // The map is a panel on the card rather than a shape floating in the
    // gradient, and because the frame is cropped its ocean and coastlines run
    // past the panel, so the clip is doing real work here.
    context.save();
    roundedRectPath(context, margin, mapTop, contentWidth, mapHeight, radius);
    context.fillStyle = "rgba(255, 255, 255, 0.03)";
    context.fill();
    context.clip();
    drawMap(context, frame, {
      shapes,
      theme: { ...theme, ocean: "rgba(10, 14, 24, 0.55)" },
      visitedCodes: new Set(data.countryCodes),
      bucketCodes: new Set(),
      legs: data.legs,
      pins: data.pins,
      unit: contentWidth,
      graticuleStep: bounds[2] - bounds[0] > 1.6 ? 30 : 15,
      // Generous for the same reason the trip card's inset is: at a third of
      // the card's height the poster's proportions put the route under a pixel.
      pinScale: 0.0085,
      lineScale: 2.2,
    });
    context.restore();

    roundedRectPath(context, margin, mapTop, contentWidth, mapHeight, radius);
    context.strokeStyle = "rgba(255, 255, 255, 0.10)";
    context.lineWidth = Math.max(1, unit * 0.0012);
    context.stroke();
  }

  // --- Text block ----------------------------------------------------------
  let baseline = blockBaseline;
  for (const row of rows) {
    row.draw(baseline);
    baseline -= row.height;
  }
}

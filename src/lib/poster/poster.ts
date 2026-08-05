// The printable travel poster.
//
// Rendering approach, and why: the composition is drawn straight onto a canvas
// sized in inches at print DPI, from projected vector geometry. There are no
// map tiles anywhere in it. A poster does not need a basemap, only country
// shapes, arcs, and pins, and once that is true the alternatives all lose:
//
//   - Reading back a MapLibre canvas caps the output at the on-screen size
//     times the device pixel ratio, so a laptop yields roughly 3000px on its
//     long edge and calls it a poster. It also drags in raster basemap tiles,
//     which are blurry when enlarged and carry licensing obligations.
//   - Composing an SVG and rasterising it through an <img> is resolution
//     independent, which is the right instinct, but an SVG loaded that way is
//     cut off from the document: it cannot see the page's @font-face rules, so
//     every label would silently fall back to a system face. Embedding the
//     font as a base64 data URI to fix that is a lot of machinery to arrive
//     where canvas already is.
//
// Canvas draws the same geometry at whatever size we ask for, uses the page's
// real typeface, and hands back a blob. The only ceiling is the browser's
// canvas limit, which resolvePrintSize probes and steps down through.
//
// The poster's orientation follows its framing rather than being a third thing
// to choose: a world map is a landscape object and a globe is a square one, so
// the flat map prints 18x12 and the globe prints 12x18.

import {
  appFontStack,
  canvasToBlob,
  drawTracked,
  ensureFonts,
  fitFontSize,
  releaseCanvas,
  resolvePrintSize,
  setFont,
  trackedWidth,
  wrapText,
  type ResolvedSize,
} from "@/lib/poster/canvas";
import { loadCountryShapes } from "@/lib/poster/countries";
import { drawMap, type MapLeg, type MapPin } from "@/lib/poster/draw-map";
import { jpegToPdf } from "@/lib/poster/pdf";
import {
  fitProjection,
  globeCenter,
  orthographicProjection,
  posterLatitudeRange,
  robinsonProjection,
} from "@/lib/poster/projection";
import { posterTheme, type PosterThemeId } from "@/lib/poster/theme";

export type PosterFraming = "flat" | "globe";

/** Everything the poster draws, assembled server-side from the map data. */
export interface PosterData {
  visitedCountryCodes: string[];
  bucketCountryCodes: string[];
  pins: MapPin[];
  legs: MapLeg[];
  countries: number;
  continents: number;
  trips: number;
  destinations: number;
  distanceKm: number;
  /** Earliest and latest year with a recorded date, for the default subtitle. */
  firstYear: number | null;
  lastYear: number | null;
}

/**
 * PNG is the lossless artefact and the one to keep. PDF exists because a PNG
 * carries no physical size, so a print shop has to be told what to do with it;
 * the PDF states the page is 18 by 12 inches and comes back that size.
 */
export type PosterFormat = "png" | "pdf";

export interface PosterOptions {
  framing: PosterFraming;
  theme: PosterThemeId;
  showStats: boolean;
  title: string;
  subtitle: string;
  format: PosterFormat;
}

export interface PosterResult {
  blob: Blob;
  format: PosterFormat;
  width: number;
  height: number;
  dpi: number;
  widthInches: number;
  heightInches: number;
}

/**
 * Physical size per framing. A world map is a landscape object and a globe is
 * a square one, so the orientation follows the framing rather than being a
 * third thing to choose. Both are 12 by 16 inches, an off-the-shelf frame
 * size, and they print as a matched pair because the short edge (which every
 * type size is measured against) is the same in both.
 */
export function posterInches(framing: PosterFraming): [number, number] {
  return framing === "flat" ? [16, 12] : [12, 16];
}

export function defaultPosterTitle(): string {
  return "Travels";
}

/**
 * How many stops fall on the hidden half of the globe framing. A sphere shows
 * one hemisphere, so a traveller who has been to both Peru and Japan will lose
 * some pins over the limb whichever way it is turned. The dialog says the
 * number out loud rather than letting someone print a poster and count the
 * missing dots afterwards; the flat framing has no such problem, which is what
 * the note points them at.
 */
export function pinsBehindGlobe(data: PosterData): number {
  if (data.pins.length === 0) return 0;
  const center = globeCenter(data.pins);
  const projection = orthographicProjection(center.lng, center.lat);
  return data.pins.filter(
    (pin) => projection.project(pin.lng, pin.lat) === null,
  ).length;
}

export function defaultPosterSubtitle(data: PosterData): string {
  if (data.firstYear && data.lastYear) {
    return data.firstYear === data.lastYear
      ? String(data.firstYear)
      : `${data.firstYear} to ${data.lastYear}`;
  }
  if (data.countries > 0) {
    return `${data.countries} ${data.countries === 1 ? "country" : "countries"}`;
  }
  return "";
}

const ATTRIBUTION =
  "Country outlines: Natural Earth  ·  Made with BatchPort";

interface StatEntry {
  value: string;
  label: string;
}

function statEntries(data: PosterData): StatEntry[] {
  const entries: StatEntry[] = [
    { value: String(data.countries), label: "Countries" },
  ];
  if (data.continents > 0) {
    entries.push({ value: String(data.continents), label: "Continents" });
  }
  entries.push({ value: String(data.trips), label: "Trips" });
  if (data.distanceKm > 0) {
    entries.push({
      value: Math.round(data.distanceKm).toLocaleString("en-US"),
      label: "Kilometres",
    });
  } else {
    entries.push({ value: String(data.destinations), label: "Stops" });
  }
  return entries;
}

/**
 * Render the poster. `onProgress` reports coarse phases: a 19 megapixel canvas
 * takes a visible moment to fill and another to encode, and a button that
 * looks stuck is worse than one that says what it is doing.
 */
export interface PosterAssets {
  shapes: Awaited<ReturnType<typeof loadCountryShapes>>;
  stack: string;
}

/** Fetched once by the dialog and shared by the preview and every export. */
export async function loadPosterAssets(): Promise<PosterAssets> {
  const stack = appFontStack();
  const [shapes] = await Promise.all([loadCountryShapes(), ensureFonts(stack)]);
  return { shapes, stack };
}

export async function renderPoster(
  data: PosterData,
  options: PosterOptions,
  assets: PosterAssets,
  onProgress?: (message: string) => void,
): Promise<PosterResult> {
  const { shapes, stack } = assets;
  const [widthInches, heightInches] = posterInches(options.framing);
  const size: ResolvedSize = resolvePrintSize(widthInches, heightInches);
  onProgress?.(`Drawing at ${size.width} by ${size.height}`);

  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) {
    releaseCanvas(canvas);
    throw new Error("This browser cannot render to a canvas.");
  }

  try {
    drawPoster(context, size, data, options, shapes, stack);
    onProgress?.("Encoding the image");
    // Yield once so the progress line paints before the encode blocks.
    await new Promise((resolve) => setTimeout(resolve, 0));

    let blob: Blob;
    if (options.format === "pdf") {
      const jpeg = await canvasToBlob(canvas, "image/jpeg", 0.94);
      blob = jpegToPdf(
        new Uint8Array(await jpeg.arrayBuffer()),
        size.width,
        size.height,
        widthInches,
        heightInches,
        options.title.trim() || defaultPosterTitle(),
      );
    } else {
      blob = await canvasToBlob(canvas, "image/png");
    }

    return {
      blob,
      format: options.format,
      width: size.width,
      height: size.height,
      dpi: size.dpi,
      widthInches,
      heightInches,
    };
  } finally {
    releaseCanvas(canvas);
  }
}

/**
 * Draw the poster into a caller-owned canvas at an arbitrary size. The dialog
 * uses this for its live preview: it is the same code path as the export, so
 * what is on screen is what downloads, and there is no second layout to keep
 * in step.
 */
export function drawPosterPreview(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  data: PosterData,
  options: PosterOptions,
  shapes: Awaited<ReturnType<typeof loadCountryShapes>>,
  stack: string,
): void {
  drawPoster(context, { width, height, dpi: 0 }, data, options, shapes, stack);
}

/** The preview's pixel size for a framing: the print ratio at a screen size. */
export function posterPreviewSize(framing: PosterFraming): {
  width: number;
  height: number;
} {
  const [widthInches, heightInches] = posterInches(framing);
  const longest = 1080;
  const scale = longest / Math.max(widthInches, heightInches);
  return {
    width: Math.round(widthInches * scale),
    height: Math.round(heightInches * scale),
  };
}

function drawPoster(
  context: CanvasRenderingContext2D,
  size: ResolvedSize,
  data: PosterData,
  options: PosterOptions,
  shapes: Awaited<ReturnType<typeof loadCountryShapes>>,
  stack: string,
): void {
  const { width, height } = size;
  const theme = posterTheme(options.theme);
  // Type and spacing scale off the short edge. Both posters are 12 inches on
  // that edge, so a landscape and a portrait print carry identical margins and
  // an identical title size: they read as a pair.
  const unit = Math.min(width, height);
  const margin = unit * 0.058;
  const contentX = margin;
  const contentWidth = width - margin * 2;
  const centerX = width / 2;

  context.fillStyle = theme.background;
  context.fillRect(0, 0, width, height);
  context.textBaseline = "alphabetic";

  // --- Measure everything before drawing anything --------------------------
  //
  // The layout is map-first: the map takes the full content width and every
  // other block is fitted around it, rather than the map taking whatever was
  // left over. Sizing the chrome first is what produced a poster with a
  // postage stamp floating in the middle of it.

  const title = options.title.trim() || defaultPosterTitle();
  let titleSize = fitFontSize(
    context,
    title,
    contentWidth,
    600,
    unit * 0.088,
    unit * 0.05,
    stack,
  );
  const titleLines = wrapText(context, title, contentWidth, 2);
  if (titleLines.length > 1) {
    titleSize = Math.min(titleSize, unit * 0.066);
    setFont(context, 600, titleSize, stack);
  }
  const subtitle = options.subtitle.trim();
  const subtitleSize = unit * 0.021;
  const headerHeight =
    titleSize * 0.82 +
    (titleLines.length - 1) * titleSize * 1.05 +
    (subtitle ? subtitleSize * 2.1 : 0);

  const entries = statEntries(data);
  const statValueSize = unit * 0.04;
  const statLabelSize = unit * 0.0135;
  const statsBlock = options.showStats
    ? unit * 0.028 + statValueSize + unit * 0.02 + statLabelSize
    : 0;

  const showLegend = data.bucketCountryCodes.length > 0;
  const legendSize = unit * 0.0135;
  const legendBlock = showLegend ? legendSize * 3 : 0;

  const footerSize = unit * 0.0115;
  const footerBlock = unit * 0.042;

  const minGapAbove = unit * 0.032;
  const minGapBelow = unit * 0.036;

  // --- Map -----------------------------------------------------------------
  const visitedCodes = new Set(data.visitedCountryCodes);
  const bucketCodes = new Set(
    data.bucketCountryCodes.filter((code) => !visitedCodes.has(code)),
  );

  const projection =
    options.framing === "flat"
      ? robinsonProjection(posterLatitudeRange(data.pins))
      : (() => {
          const center = globeCenter(data.pins);
          return orthographicProjection(center.lng, center.lat);
        })();
  const [minX, minY, maxX, maxY] = projection.extent;
  const mapAspect = (maxX - minX) / (maxY - minY);

  const verticalBudget = Math.max(
    unit * 0.2,
    height -
      margin * 2 -
      headerHeight -
      statsBlock -
      legendBlock -
      footerBlock -
      minGapAbove -
      minGapBelow,
  );
  let mapHeight = contentWidth / mapAspect;
  if (mapHeight > verticalBudget) mapHeight = verticalBudget;
  // Leftover height is split above and below the map rather than pooled at
  // one end, so the map sits optically centred in what is left of the page.
  const slack = Math.max(0, verticalBudget - mapHeight);
  const gapAbove = minGapAbove + slack * 0.44;

  const mapTop = margin + headerHeight + gapAbove;

  // --- Header --------------------------------------------------------------
  setFont(context, 600, titleSize, stack);
  let cursorY = margin + titleSize * 0.82;
  context.textAlign = "center";
  context.fillStyle = theme.title;
  for (const line of titleLines) {
    context.fillText(line, centerX, cursorY);
    cursorY += titleSize * 1.05;
  }
  cursorY -= titleSize * 1.05;

  if (subtitle) {
    setFont(context, 500, subtitleSize, stack);
    context.fillStyle = theme.muted;
    cursorY += subtitleSize * 2.1;
    drawTracked(
      context,
      subtitle.toUpperCase(),
      centerX,
      cursorY,
      subtitleSize * 0.2,
      "center",
    );
  }

  // A short centred rule closes the header and separates it from the map.
  const ruleY = (margin + headerHeight + mapTop) / 2;
  context.beginPath();
  context.moveTo(centerX - unit * 0.042, ruleY);
  context.lineTo(centerX + unit * 0.042, ruleY);
  context.strokeStyle = theme.rule;
  context.lineWidth = Math.max(1, unit * 0.0016);
  context.stroke();

  const frame = fitProjection(
    projection,
    contentX,
    mapTop,
    contentWidth,
    mapHeight,
  );

  drawMap(context, frame, {
    shapes,
    theme,
    visitedCodes,
    bucketCodes,
    legs: data.legs,
    pins: data.pins,
    unit,
    graticuleStep: 30,
    pinScale: options.framing === "globe" ? 0.0046 : 0.0034,
  });

  // A one-sided wash across the globe reads as a lit sphere rather than a
  // flat circle. Skipped on paper, where it would print as a grey smudge.
  if (options.framing === "globe" && theme.vignette) {
    const [boxX, boxY, boxWidth] = frame.box;
    const radius = boxWidth / 2;
    context.save();
    context.beginPath();
    context.arc(boxX + radius, boxY + radius, radius, 0, Math.PI * 2);
    context.clip();
    const gradient = context.createRadialGradient(
      boxX + boxWidth * 0.36,
      boxY + boxWidth * 0.32,
      radius * 0.1,
      boxX + radius,
      boxY + radius,
      radius,
    );
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.05)");
    gradient.addColorStop(0.55, "rgba(0, 0, 0, 0)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0.45)");
    context.fillStyle = gradient;
    context.fillRect(boxX, boxY, boxWidth, boxWidth);
    context.restore();
  }

  // --- Legend --------------------------------------------------------------
  // Two fills mean two things, and a poster leaves the app: without this the
  // amber countries are unexplained. Only drawn when there are any.
  const belowMap = mapTop + mapHeight;
  if (showLegend) {
    const legendY = belowMap + legendBlock * 0.66;
    setFont(context, 500, legendSize, stack);
    const swatch = legendSize * 0.85;
    const items: { color: string; stroke: string; label: string }[] = [
      { color: theme.visited, stroke: theme.visitedStroke, label: "VISITED" },
      { color: theme.bucket, stroke: theme.bucketStroke, label: "ON THE LIST" },
    ];
    const tracking = legendSize * 0.18;
    const gap = legendSize * 0.7;
    const itemWidths = items.map(
      (item) => swatch + gap + trackedWidth(context, item.label, tracking),
    );
    const totalWidth =
      itemWidths.reduce((sum, value) => sum + value, 0) + legendSize * 2.4;
    let cursor = centerX - totalWidth / 2;
    for (const item of items) {
      context.fillStyle = item.color;
      context.fillRect(cursor, legendY - swatch, swatch, swatch);
      context.strokeStyle = item.stroke;
      context.lineWidth = Math.max(1, unit * 0.0009);
      context.strokeRect(cursor, legendY - swatch, swatch, swatch);
      cursor += swatch + gap;
      context.fillStyle = theme.muted;
      context.textAlign = "left";
      drawTracked(context, item.label, cursor, legendY, tracking, "left");
      cursor += trackedWidth(context, item.label, tracking) + legendSize * 2.4;
    }
  }

  // --- Stats ---------------------------------------------------------------
  if (options.showStats) {
    const ruleTop = belowMap + legendBlock + minGapBelow + slack * 0.56;
    const statsTop = ruleTop + unit * 0.032;
    context.beginPath();
    context.moveTo(contentX, ruleTop);
    context.lineTo(contentX + contentWidth, ruleTop);
    context.strokeStyle = theme.rule;
    context.lineWidth = Math.max(1, unit * 0.0012);
    context.stroke();

    const columnWidth = contentWidth / entries.length;
    entries.forEach((entry, index) => {
      const x = contentX + columnWidth * (index + 0.5);
      setFont(context, 600, statValueSize, stack);
      context.textAlign = "center";
      context.fillStyle = theme.title;
      context.fillText(entry.value, x, statsTop + statValueSize * 0.86);

      setFont(context, 500, statLabelSize, stack);
      context.fillStyle = theme.muted;
      drawTracked(
        context,
        entry.label.toUpperCase(),
        x,
        statsTop + statValueSize + unit * 0.024,
        statLabelSize * 0.22,
        "center",
      );
    });
  }

  // --- Footer --------------------------------------------------------------
  setFont(context, 400, footerSize, stack);
  context.fillStyle = theme.muted;
  drawTracked(
    context,
    ATTRIBUTION.toUpperCase(),
    centerX,
    height - margin * 0.6,
    footerSize * 0.16,
    "center",
  );
}

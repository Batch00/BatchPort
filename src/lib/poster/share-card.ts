// The per-trip share card: one trip, composed as something postable.
//
// It is the same renderer as the poster (canvas over projected geometry) at a
// social aspect ratio, with two things the poster does not have: a photograph
// behind it, and a route drawn as a porthole globe centred on the trip itself.
//
// The card is derived entirely from a StoryTrip, which the trip page, /demo,
// and /share/[slug] all already build. That is deliberate: it means the card
// costs no query anywhere, and every surface that can open the story can also
// export the card.

import { durationDays, formatDateRange, formatDuration } from "@/lib/format";
import { formatKm } from "@/lib/stats-format";
import { storyClosingStats, type StoryTrip } from "@/lib/story";
import {
  appFontStack,
  canvasToBlob,
  drawImageCover,
  drawTracked,
  ensureFonts,
  fitFontSize,
  loadImage,
  releaseCanvas,
  setFont,
  trackedWidth,
  wrapText,
} from "@/lib/poster/canvas";
import { loadCountryShapes } from "@/lib/poster/countries";
import { drawMap, type MapLeg, type MapPin } from "@/lib/poster/draw-map";
import {
  fitProjection,
  globeCenter,
  orthographicProjection,
} from "@/lib/poster/projection";
import { posterTheme } from "@/lib/poster/theme";

export type ShareCardRatio = "square" | "story";

export interface ShareCardRatioInfo {
  id: ShareCardRatio;
  label: string;
  note: string;
  width: number;
  height: number;
}

// 2x the 1080 baseline every social surface asks for: sharp on a 3x phone
// screen, and 2160 x 3840 is 8.3 megapixels, comfortably inside the tightest
// canvas limit any browser imposes.
export const SHARE_CARD_RATIOS: ShareCardRatioInfo[] = [
  {
    id: "square",
    label: "Square",
    note: "1:1, for a feed post",
    width: 2160,
    height: 2160,
  },
  {
    id: "story",
    label: "Story",
    note: "9:16, for a story or a reel",
    width: 2160,
    height: 3840,
  },
];

export function shareCardRatio(id: ShareCardRatio): ShareCardRatioInfo {
  return SHARE_CARD_RATIOS.find((ratio) => ratio.id === id) ?? SHARE_CARD_RATIOS[0];
}

export interface ShareCardData {
  name: string;
  dateLabel: string;
  routeLabel: string;
  coverUrl: string | null;
  /**
   * The credit line the cover's licence requires. Wikimedia covers are
   * CC BY-SA or similar and carry an attribution condition that does not stop
   * applying because the image was redrawn onto a canvas, so the card prints
   * it. Uploads have none and the line is simply absent.
   */
  coverAttribution: string | null;
  pins: MapPin[];
  legs: MapLeg[];
  countryCodes: string[];
  stops: number;
  countries: number;
  distanceKm: number | null;
  experiences: number;
  best: { name: string; rating: number } | null;
}

const MAX_ROUTE_NAMES = 3;

/** Fold a StoryTrip into the card's inputs. Pure. */
export function shareCardFromStoryTrip(trip: StoryTrip): ShareCardData {
  const stats = storyClosingStats(trip);
  const located = trip.destinations.filter(
    (destination) =>
      destination.latitude !== null && destination.longitude !== null,
  );
  const pins: MapPin[] = located.map((destination) => ({
    lat: destination.latitude as number,
    lng: destination.longitude as number,
  }));
  const legs: MapLeg[] = [];
  for (let i = 1; i < located.length; i += 1) {
    legs.push({
      from: [
        located[i - 1].longitude as number,
        located[i - 1].latitude as number,
      ],
      to: [located[i].longitude as number, located[i].latitude as number],
    });
  }

  const names = trip.destinations.map((destination) => destination.name);
  const routeLabel =
    names.length <= MAX_ROUTE_NAMES
      ? names.join("  ·  ")
      : `${names.slice(0, MAX_ROUTE_NAMES).join("  ·  ")}  +${
          names.length - MAX_ROUTE_NAMES
        }`;

  const days = durationDays(trip.startDate, trip.endDate);
  const dateParts = [formatDateRange(trip.startDate, trip.endDate)];
  if (days) dateParts.push(formatDuration(days));

  // The cover has no attribution of its own, but the photo it came from does,
  // and the trip carries both. Matching on the url is what connects them.
  const coverPhoto = trip.coverUrl
    ? trip.photos.find((photo) => photo.url === trip.coverUrl)
    : undefined;

  return {
    name: trip.name,
    dateLabel: dateParts.join("  ·  "),
    routeLabel,
    coverUrl: trip.coverUrl,
    coverAttribution: coverPhoto?.attribution ?? null,
    pins,
    legs,
    countryCodes: Array.from(
      new Set(
        trip.destinations
          .map((destination) => destination.countryCode)
          .filter((code): code is string => Boolean(code)),
      ),
    ),
    stops: stats.destinations,
    countries: stats.countries,
    distanceKm: stats.distanceKm,
    experiences: stats.experiences,
    best: stats.best
      ? { name: stats.best.name, rating: stats.best.rating }
      : null,
  };
}

export interface ShareCardResult {
  blob: Blob;
  width: number;
  height: number;
}

function starPath(
  context: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
): void {
  context.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const r = i % 2 === 0 ? radius : radius * 0.45;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
}

/** Everything the card needs that has to be fetched. Loaded once by the
 * dialog and reused for the preview and every export, so switching ratio or
 * pressing download twice never refetches the photograph. */
export interface ShareCardAssets {
  shapes: Awaited<ReturnType<typeof loadCountryShapes>>;
  cover: Awaited<ReturnType<typeof loadImage>>;
  stack: string;
  /** True when there is a cover to draw but it would not load. The dialog
   * says so rather than silently showing the gradient. */
  coverFailed: boolean;
}

export async function loadShareCardAssets(
  data: ShareCardData,
): Promise<ShareCardAssets> {
  const stack = appFontStack();
  const [shapes, cover] = await Promise.all([
    loadCountryShapes(),
    data.coverUrl ? loadImage(data.coverUrl) : Promise.resolve(null),
    ensureFonts(stack),
  ]);
  return {
    shapes,
    cover,
    stack,
    coverFailed: Boolean(data.coverUrl) && cover === null,
  };
}

export async function renderShareCard(
  data: ShareCardData,
  ratio: ShareCardRatio,
  assets: ShareCardAssets,
): Promise<ShareCardResult> {
  const { shapes, cover, stack } = assets;
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
    drawShareCard(context, size, data, cover, shapes, stack);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const blob = await canvasToBlob(canvas, "image/png");
    return { blob, width: size.width, height: size.height };
  } finally {
    releaseCanvas(canvas);
  }
}

/** Draw the card at a smaller size for the dialog's live preview. Same code
 * path as the export, so the preview cannot drift from the output. */
export function drawShareCardPreview(
  context: CanvasRenderingContext2D,
  ratio: ShareCardRatio,
  width: number,
  height: number,
  data: ShareCardData,
  cover: Awaited<ReturnType<typeof loadImage>>,
  shapes: Awaited<ReturnType<typeof loadCountryShapes>>,
  stack: string,
): void {
  drawShareCard(
    context,
    { ...shareCardRatio(ratio), width, height },
    data,
    cover,
    shapes,
    stack,
  );
}

function drawShareCard(
  context: CanvasRenderingContext2D,
  size: ShareCardRatioInfo,
  data: ShareCardData,
  cover: Awaited<ReturnType<typeof loadImage>>,
  shapes: Awaited<ReturnType<typeof loadCountryShapes>>,
  stack: string,
): void {
  const { width, height } = size;
  const tall = size.id === "story";
  const theme = posterTheme("midnight");
  const unit = width;
  const margin = unit * 0.082;
  const contentWidth = width - margin * 2;

  context.textBaseline = "alphabetic";

  // --- Backdrop ------------------------------------------------------------
  context.fillStyle = "#070810";
  context.fillRect(0, 0, width, height);

  if (cover) {
    drawImageCover(
      context,
      cover.image,
      cover.width,
      cover.height,
      0,
      0,
      width,
      height,
    );
    // A flat wash so the type reads at any exposure, then a gradient that
    // grounds the bottom third where the text block actually sits. Either one
    // alone leaves the title fighting the photograph.
    context.fillStyle = "rgba(6, 8, 14, 0.34)";
    context.fillRect(0, 0, width, height);
  } else {
    // No cover is a designed state, not a broken one: the brand gradient the
    // globe already sits on.
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#0d1424");
    gradient.addColorStop(0.55, "#080a12");
    gradient.addColorStop(1, "#0a0f1c");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }

  const topScrim = context.createLinearGradient(0, 0, 0, height * 0.3);
  topScrim.addColorStop(0, "rgba(4, 5, 10, 0.72)");
  topScrim.addColorStop(1, "rgba(4, 5, 10, 0)");
  context.fillStyle = topScrim;
  context.fillRect(0, 0, width, height * 0.3);

  const bottomScrim = context.createLinearGradient(0, height * 0.32, 0, height);
  bottomScrim.addColorStop(0, "rgba(4, 5, 10, 0)");
  bottomScrim.addColorStop(0.45, "rgba(4, 5, 10, 0.72)");
  bottomScrim.addColorStop(1, "rgba(4, 5, 10, 0.96)");
  context.fillStyle = bottomScrim;
  context.fillRect(0, height * 0.32, width, height * 0.68);

  // --- Wordmark ------------------------------------------------------------
  const markSize = unit * 0.019;
  setFont(context, 600, markSize, stack);
  const dotRadius = markSize * 0.34;
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

  // --- Route porthole ------------------------------------------------------
  // A dark disc behind the globe so the route reads over any photograph, and
  // a thin brand ring so it reads as an object placed on the card rather than
  // a hole cut in it.
  const discDiameter = tall ? unit * 0.56 : unit * 0.38;
  const discCenterX = tall ? width / 2 : width - margin - discDiameter / 2;
  const discCenterY = tall ? height * 0.3 : margin + markSize * 2.4 + discDiameter / 2;
  const discRadius = discDiameter / 2;

  context.save();
  context.beginPath();
  context.arc(discCenterX, discCenterY, discRadius, 0, Math.PI * 2);
  context.fillStyle = "rgba(6, 8, 14, 0.66)";
  context.fill();
  context.clip();

  const center = globeCenter(data.pins);
  const frame = fitProjection(
    orthographicProjection(center.lng, center.lat),
    discCenterX - discRadius,
    discCenterY - discRadius,
    discDiameter,
    discDiameter,
  );
  drawMap(context, frame, {
    shapes,
    theme: { ...theme, ocean: "rgba(11, 15, 24, 0.85)" },
    visitedCodes: new Set(data.countryCodes),
    bucketCodes: new Set(),
    legs: data.legs,
    pins: data.pins,
    unit: discDiameter,
    // A 30 degree grid on a disc this small is noise, not structure.
    graticuleStep: null,
    pinScale: 0.019,
  });
  context.restore();

  context.beginPath();
  context.arc(discCenterX, discCenterY, discRadius, 0, Math.PI * 2);
  context.strokeStyle = "rgba(122, 173, 255, 0.42)";
  context.lineWidth = Math.max(2, unit * 0.0022);
  context.stroke();

  // --- Text block, measured from the bottom up -----------------------------
  let baseline = height - margin * 0.72;

  if (data.coverAttribution) {
    const creditSize = unit * 0.0155;
    setFont(context, 400, creditSize, stack);
    context.textAlign = "left";
    context.fillStyle = "rgba(255, 255, 255, 0.42)";
    const credit = wrapText(
      context,
      `Photo: ${data.coverAttribution}`,
      contentWidth,
      1,
    )[0];
    if (credit) context.fillText(credit, margin, baseline);
    baseline -= creditSize * 2.1;
  }

  if (data.best) {
    const bestSize = unit * 0.0235;
    setFont(context, 500, bestSize, stack);
    context.textAlign = "left";
    const starRadius = bestSize * 0.55;
    const label = wrapText(
      context,
      data.best.name,
      contentWidth - starRadius * 3.4 - bestSize * 2.6,
      1,
    )[0];
    starPath(context, margin + starRadius, baseline - bestSize * 0.3, starRadius);
    context.fillStyle = "#fbbf24";
    context.fill();
    context.fillStyle = "rgba(255, 255, 255, 0.72)";
    context.fillText(
      `${(data.best.rating / 2).toFixed(1)}   ${label ?? ""}`,
      margin + starRadius * 2.6,
      baseline,
    );
    baseline -= bestSize * 2.4;
  }

  // Stats row.
  const tiles: { value: string; label: string }[] = [
    { value: String(data.stops), label: data.stops === 1 ? "Stop" : "Stops" },
  ];
  if (data.countries > 0) {
    tiles.push({
      value: String(data.countries),
      label: data.countries === 1 ? "Country" : "Countries",
    });
  }
  if (data.distanceKm !== null && data.distanceKm > 0) {
    tiles.push({ value: formatKm(data.distanceKm), label: "Travelled" });
  } else if (data.experiences > 0) {
    tiles.push({ value: String(data.experiences), label: "Experiences" });
  }

  const tileValueSize = unit * 0.046;
  const tileLabelSize = unit * 0.0165;
  const tileGap = unit * 0.075;
  setFont(context, 600, tileValueSize, stack);
  const tileWidths = tiles.map((tile) => {
    setFont(context, 600, tileValueSize, stack);
    const valueWidth = context.measureText(tile.value).width;
    setFont(context, 500, tileLabelSize, stack);
    const labelWidth = trackedWidth(
      context,
      tile.label.toUpperCase(),
      tileLabelSize * 0.22,
    );
    return Math.max(valueWidth, labelWidth);
  });

  const labelBaseline = baseline;
  const valueBaseline = labelBaseline - tileLabelSize * 1.9;
  let cursor = margin;
  tiles.forEach((tile, index) => {
    setFont(context, 600, tileValueSize, stack);
    context.textAlign = "left";
    context.fillStyle = "#ffffff";
    context.fillText(tile.value, cursor, valueBaseline);
    setFont(context, 500, tileLabelSize, stack);
    context.fillStyle = "rgba(255, 255, 255, 0.5)";
    drawTracked(
      context,
      tile.label.toUpperCase(),
      cursor,
      labelBaseline,
      tileLabelSize * 0.22,
      "left",
    );
    cursor += tileWidths[index] + tileGap;
  });

  // A hairline over the stats separates them from the title without a box.
  const ruleY = valueBaseline - tileValueSize * 1.25;
  context.beginPath();
  context.moveTo(margin, ruleY);
  context.lineTo(margin + contentWidth, ruleY);
  context.strokeStyle = "rgba(255, 255, 255, 0.18)";
  context.lineWidth = Math.max(1, unit * 0.0012);
  context.stroke();

  baseline = ruleY - unit * 0.038;

  // Route line.
  if (data.routeLabel) {
    const routeSize = unit * 0.0235;
    setFont(context, 500, routeSize, stack);
    context.textAlign = "left";
    context.fillStyle = "rgba(255, 255, 255, 0.62)";
    const line = wrapText(context, data.routeLabel, contentWidth, 1)[0];
    if (line) context.fillText(line, margin, baseline);
    baseline -= routeSize * 2.1;
  }

  // Title, wrapped upward so a long trip name grows into the space above it.
  const titleSize = fitFontSize(
    context,
    data.name,
    contentWidth,
    600,
    unit * 0.088,
    unit * 0.05,
    stack,
  );
  const titleLines = wrapText(context, data.name, contentWidth, tall ? 3 : 2);
  context.textAlign = "left";
  context.fillStyle = "#ffffff";
  let titleBaseline = baseline - (titleLines.length - 1) * titleSize * 1.08;
  for (const line of titleLines) {
    context.fillText(line, margin, titleBaseline);
    titleBaseline += titleSize * 1.08;
  }

  // Dates, above the title as an eyebrow.
  const dateSize = unit * 0.0195;
  setFont(context, 500, dateSize, stack);
  context.fillStyle = "rgba(255, 255, 255, 0.66)";
  drawTracked(
    context,
    data.dateLabel.toUpperCase(),
    margin,
    baseline - (titleLines.length - 1) * titleSize * 1.08 - titleSize * 1.05,
    dateSize * 0.2,
    "left",
  );
}

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

import { compareCurated } from "@/lib/curation";
import {
  countryName,
  durationDays,
  formatDateRange,
  formatDuration,
} from "@/lib/format";
import { formatKm } from "@/lib/stats-format";
import {
  storyClosingStats,
  storyHeroPhoto,
  type StoryTrip,
} from "@/lib/story";
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
  wrapText,
} from "@/lib/poster/canvas";
import {
  drawHighlights,
  layoutPlaces,
  planHighlights,
  statTileWidth,
} from "@/lib/poster/card-parts";
import { loadCountryShapes } from "@/lib/poster/countries";
import { drawMap, type MapLeg, type MapPin } from "@/lib/poster/draw-map";
import {
  fitOrthographicRadius,
  fitProjection,
  globeCenter,
  graticuleStepForRadius,
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
  /**
   * The places line, already decided and never truncated. Countries for a trip
   * that crossed borders (seven of those fit on a line where eleven cities do
   * not, and "France, Spain, Portugal" tells the story better than the first
   * three cities plus a "+8"), the stops themselves for a single-country trip,
   * where the country name alone would say almost nothing.
   */
  places: string[];
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
  /**
   * The trip's best-rated experiences, highest first, at most three. A single
   * one on a line left the foot of the card looking unfinished; three fill the
   * area and read as a list somebody meant to put there. Empty when nothing on
   * the trip was rated, in which case the block is absent rather than blank.
   */
  highlights: { name: string; rating: number }[];
}

/**
 * Country names rather than flag emoji, deliberately. Windows ships no colour
 * flag glyphs, so a regional indicator pair renders as the bare letters "GB"
 * (the reason CountryFlag uses SVG images on the web). A canvas has no image
 * fallback to reach for, and pulling in remote flag SVGs would put seven
 * network fetches and a third party inside an export that otherwise works
 * offline and is entirely self-contained. Names are unambiguous everywhere.
 */
function placesFor(trip: StoryTrip): string[] {
  const codes = Array.from(
    new Set(
      trip.destinations
        .map((destination) => destination.countryCode)
        .filter((code): code is string => Boolean(code)),
    ),
  );
  if (codes.length > 1) return codes.map(countryName);
  // One country, or none recorded: the stops say more than the country would.
  const names = trip.destinations.map((destination) => destination.name);
  if (names.length > 0) return names;
  return codes.map(countryName);
}

const MAX_HIGHLIGHTS = 3;

/**
 * What the card says was good about the trip: the experiences the traveller
 * featured, in the order they featured them, then the best-rated of whatever
 * is left. Ties break on the name so the same trip always produces the same
 * card, and an uncurated trip produces exactly the card it did before
 * featuring existed.
 *
 * Rated only, in both halves. The row prints a star and a number beside each
 * name, so an unrated pick has nothing to print there; featuring something is
 * a statement about order, not a substitute for rating it.
 */
function highlightsFor(trip: StoryTrip): { name: string; rating: number }[] {
  return trip.destinations
    .flatMap((destination) => destination.experiences)
    .filter(
      (experience): experience is typeof experience & { rating: number } =>
        experience.rating !== null,
    )
    .sort(compareCurated)
    .slice(0, MAX_HIGHLIGHTS)
    .map((experience) => ({ name: experience.name, rating: experience.rating }));
}

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

  const days = durationDays(trip.startDate, trip.endDate);
  const dateParts = [formatDateRange(trip.startDate, trip.endDate)];
  if (days) dateParts.push(formatDuration(days));

  // The backdrop is the photo elected into the trip's hero slot, and the trip
  // cover only when nothing was elected. A cover is chosen to crop well into a
  // banner; a card is a portrait of the trip, and those are not always the
  // same picture, which is the whole reason the hero slot exists.
  //
  // The cover has no attribution of its own, but the photo it came from does,
  // and the trip carries both. Matching on the url is what connects them.
  const hero = storyHeroPhoto(trip);
  const coverUrl = hero?.url ?? trip.coverUrl;
  const coverPhoto =
    hero ??
    (coverUrl ? trip.photos.find((photo) => photo.url === coverUrl) : undefined);

  return {
    name: trip.name,
    dateLabel: dateParts.join("  ·  "),
    places: placesFor(trip),
    coverUrl,
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
    highlights: highlightsFor(trip),
  };
}

export interface ShareCardResult {
  blob: Blob;
  width: number;
  height: number;
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
  const margin = unit * 0.078;
  const contentWidth = width - margin * 2;
  // A story has vertical room to spend and reads as cramped without it; a
  // square does not. One factor rather than two sets of numbers.
  const lead = tall ? 1.18 : 1;

  context.textBaseline = "alphabetic";

  // --- Inset globe geometry ------------------------------------------------
  //
  // Corner-anchored, top-right, in both ratios. The centre is where a photo
  // puts its subject, and a disc parked there reads as a sticker over the
  // picture rather than a part of it. The text block owns the bottom-left, so
  // the top-right is the one corner that is free in both crops.
  //
  // The inset sits on a tighter margin than the text (a little over half),
  // which is what makes it read as anchored to the corner rather than merely
  // near it, while still leaving enough air that the ring is not crowding the
  // edge. It stays clear of the wordmark by a wide margin, since that sits at
  // the opposite corner.
  //
  // Measured up here rather than next to its drawing, because both the scrim
  // and the title need to know where it is.
  const discInset = margin * 0.55;
  const discDiameter = unit * (tall ? 0.32 : 0.31);
  const discRadius = discDiameter / 2;
  const discCenterX = width - discInset - discRadius;
  const discCenterY = discInset + discRadius;
  const discBottom = discCenterY + discRadius;
  const discLeft = discCenterX - discRadius;

  // The bottom edge the text block sits on, and with it how low the block
  // sits overall. It keeps a shade more clearance than the side margins, which
  // is enough to stop the last line crowding the edge; anything more and the
  // block floats up into the middle of the frame, leaving the inset stranded
  // at the top and squeezing the photograph between them. Known before the
  // block is measured because the title's fit depends on where it lands.
  const bottomInset = margin * (tall ? 1 : 1.1);
  const blockBaseline = height - bottomInset;

  // --- Measure the text block before drawing anything ----------------------
  //
  // The block is laid out bottom-up, but the scrim behind it has to be drawn
  // first and has to know where the block starts. So everything is measured
  // into rows, each carrying the distance from its own baseline up to the next
  // one, and only then is anything painted. Guessing the scrim's extent from a
  // fraction of the height was what left a title fighting a bright photo.

  interface Row {
    height: number;
    draw: (baseline: number) => void;
  }
  const rows: Row[] = [];

  const markSize = unit * 0.019;

  if (data.coverAttribution) {
    const creditSize = unit * 0.0155;
    rows.push({
      height: creditSize * 2.4 * lead,
      draw: (baseline) => {
        setFont(context, 400, creditSize, stack);
        context.textAlign = "left";
        context.fillStyle = "rgba(255, 255, 255, 0.45)";
        const credit = wrapText(
          context,
          `Photo: ${data.coverAttribution}`,
          contentWidth,
          1,
        )[0];
        if (credit) context.fillText(credit, margin, baseline);
      },
    });
  }

  // Highlights: the trip's best-rated experiences, run along a single line and
  // separated the way the places line is. Stacked rows spent three times the
  // vertical space on content that sits comfortably across the width, and the
  // photograph has more use for that room. Absent entirely when nothing was
  // rated, so the block shortens instead of leaving a hole.
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
        drawHighlights(
          context,
          plan,
          margin,
          baseline,
          stack,
          data.highlights.length === 1 ? "HIGHLIGHT" : "HIGHLIGHTS",
        );
      },
    });
  }

  // Stats row, with a hairline above it.
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
  const tileWidths = tiles.map((tile) =>
    statTileWidth(context, tile, tileValueSize, tileLabelSize, stack),
  );
  const statsValueRise = tileLabelSize * 1.95;
  const statsRuleRise = statsValueRise + tileValueSize * 1.2;

  rows.push({
    height: statsRuleRise + unit * 0.05 * lead,
    draw: (baseline) => {
      const valueBaseline = baseline - statsValueRise;
      let cursor = margin;
      tiles.forEach((tile, index) => {
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

  // The places line. Never truncated: it shrinks, then wraps.
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

  // Title.
  //
  // Measured against the inset, because it is the only element in the block
  // both wide enough and tall enough to reach that corner: on a square card a
  // long enough name wraps to two lines and the upper one runs straight under
  // the disc. Everything below the title is shorter or sits lower, and the
  // dates eyebrow above it is a narrow line that never gets near.
  //
  // So: fit it across the full width, work out where its top would land, and
  // only if that is level with the inset re-fit it into the column beside it.
  // A name that never rises that far keeps the whole width, which is almost
  // always the case and is why this is a second pass rather than a permanent
  // narrowing.
  const titleMax = unit * 0.088;
  const titleMin = unit * 0.05;
  const fitTitle = (
    available: number,
    maxLines: number,
  ): { size: number; lines: string[] } => {
    const size = fitFontSize(
      context,
      data.name,
      available,
      600,
      titleMax,
      titleMin,
      stack,
    );
    return { size, lines: wrapText(context, data.name, available, maxLines) };
  };

  let title = fitTitle(contentWidth, tall ? 3 : 2);
  const heightBelowTitle = rows.reduce((total, row) => total + row.height, 0);
  const titleTopFor = (candidate: { size: number; lines: string[] }): number =>
    blockBaseline -
    heightBelowTitle -
    candidate.size * 1.1 * (candidate.lines.length - 1) -
    candidate.size * 0.75;

  if (titleTopFor(title) < discBottom + unit * 0.02) {
    // One more line is allowed here: the constraint is the narrower column,
    // and a third short line clears the inset where a shrunken second would
    // still be fighting it.
    title = fitTitle(discLeft - margin - unit * 0.03, 3);
  }
  const titleSize = title.size;
  const titleLines = title.lines;

  rows.push({
    // The trailing multiplier is the gap up to the dates line. Kept tight so
    // the date reads as a label attached to the title rather than a separate
    // element floating above it.
    height: titleSize * 1.1 * (titleLines.length - 1) + titleSize * 1.18,
    draw: (baseline) => {
      setFont(context, 600, titleSize, stack);
      context.textAlign = "left";
      context.fillStyle = "#ffffff";
      let y = baseline - titleSize * 1.1 * (titleLines.length - 1);
      for (const line of titleLines) {
        context.fillText(line, margin, y);
        y += titleSize * 1.1;
      }
    },
  });

  // Dates, the eyebrow that closes the block at the top.
  const dateSize = unit * 0.0195;
  rows.push({
    height: dateSize * 1.2,
    draw: (baseline) => {
      setFont(context, 500, dateSize, stack);
      context.fillStyle = "rgba(255, 255, 255, 0.7)";
      drawTracked(
        context,
        data.dateLabel.toUpperCase(),
        margin,
        baseline,
        dateSize * 0.2,
        "left",
      );
    },
  });

  const blockHeight = rows.reduce((total, row) => total + row.height, 0);
  const blockTop = blockBaseline - blockHeight;

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
    // A flat wash so the type reads at any exposure, then the gradients below.
    // Either one alone leaves the title fighting the photograph.
    context.fillStyle = "rgba(6, 8, 14, 0.30)";
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

  // Top scrim, sized to clear the wordmark and the inset rather than to a
  // fixed fraction of the height.
  const topScrimEnd = discCenterY + discRadius + unit * 0.06;
  const topScrim = context.createLinearGradient(0, 0, 0, topScrimEnd);
  topScrim.addColorStop(0, "rgba(4, 5, 10, 0.62)");
  topScrim.addColorStop(0.55, "rgba(4, 5, 10, 0.24)");
  topScrim.addColorStop(1, "rgba(4, 5, 10, 0)");
  context.fillStyle = topScrim;
  context.fillRect(0, 0, width, topScrimEnd);

  // Bottom scrim, anchored to the measured block so the text always lands in
  // the dark part of it whatever the photo and however long the trip name.
  const fadeStart = Math.max(height * 0.2, blockTop - unit * 0.3);
  const bottomScrim = context.createLinearGradient(0, fadeStart, 0, height);
  bottomScrim.addColorStop(0, "rgba(4, 5, 10, 0)");
  bottomScrim.addColorStop(0.5, "rgba(4, 5, 10, 0.72)");
  bottomScrim.addColorStop(0.75, "rgba(4, 5, 10, 0.9)");
  bottomScrim.addColorStop(1, "rgba(4, 5, 10, 0.97)");
  context.fillStyle = bottomScrim;
  context.fillRect(0, fadeStart, width, height - fadeStart);

  // --- Wordmark ------------------------------------------------------------
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

  // --- Inset route map -----------------------------------------------------
  // Framed to the trip, not to the planet: the radius is fitted to the stops
  // so a Europe trip fills the disc and a globe-spanning one falls back to a
  // whole hemisphere. The centre is the trip's true centroid, untilted, or an
  // Iceland trip would slide off its own map.
  const center = globeCenter(data.pins, { clampLatitude: false });
  const radius = fitOrthographicRadius(center, data.pins);

  // A soft drop shadow lifts the disc off the photograph, which is what makes
  // it read as an inset rather than a hole punched in the image.
  context.save();
  context.shadowColor = "rgba(0, 0, 0, 0.55)";
  context.shadowBlur = discDiameter * 0.08;
  context.shadowOffsetY = discDiameter * 0.022;
  context.beginPath();
  context.arc(discCenterX, discCenterY, discRadius, 0, Math.PI * 2);
  context.fillStyle = "rgba(6, 8, 14, 0.74)";
  context.fill();
  context.restore();

  context.save();
  context.beginPath();
  context.arc(discCenterX, discCenterY, discRadius, 0, Math.PI * 2);
  context.clip();
  const frame = fitProjection(
    orthographicProjection(center.lng, center.lat, radius),
    discCenterX - discRadius,
    discCenterY - discRadius,
    discDiameter,
    discDiameter,
  );
  drawMap(context, frame, {
    shapes,
    theme: {
      ...theme,
      ocean: "rgba(11, 15, 24, 0.88)",
      graticule: "rgba(255, 255, 255, 0.07)",
    },
    visitedCodes: new Set(data.countryCodes),
    bucketCodes: new Set(),
    legs: data.legs,
    pins: data.pins,
    unit: discDiameter,
    graticuleStep: graticuleStepForRadius(radius),
    // Both are generous for the disc's size on purpose: at a quarter of the
    // card the poster's proportions put the route under a pixel.
    pinScale: 0.024,
    lineScale: 3.2,
  });
  context.restore();

  context.beginPath();
  context.arc(discCenterX, discCenterY, discRadius, 0, Math.PI * 2);
  context.strokeStyle = "rgba(163, 199, 255, 0.5)";
  context.lineWidth = Math.max(2, unit * 0.002);
  context.stroke();

  // --- Text block ----------------------------------------------------------
  let baseline = blockBaseline;
  for (const row of rows) {
    row.draw(baseline);
    baseline -= row.height;
  }
}

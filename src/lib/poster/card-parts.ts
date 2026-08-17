// Pieces shared by the two social cards: the per-trip share card and the year
// card.
//
// These moved out of share-card.ts unchanged when the year card needed them.
// The alternative was a second copy of the places line and the highlights row,
// and two copies of "never truncate, shrink then wrap, break between places
// and never inside one" would have drifted the first time either was touched.

import {
  drawTracked,
  setFont,
  trackedWidth,
  wrapText,
} from "@/lib/poster/canvas";
import {
  MIN_PLACE_FACTOR,
  PLACE_SEPARATOR,
  layoutPlaceLines,
} from "@/lib/place-lines";

// The separator and the wrapping rule itself now live in lib/place-lines.ts,
// because the full-screen surfaces print the same list and had their own
// truncating version of it. Re-exported so the canvas callers keep importing
// it from where they always have.
export { PLACE_SEPARATOR };

/**
 * Fit the places line. Every size is tried on one line before a second line is
 * considered at all, because a slightly smaller single line reads better than
 * a full-size line with an orphan under it. Showing everything beats showing a
 * "+8", so the ellipsis at the end is a last resort for a trip that cannot
 * exist (thirty countries whose names still overflow three lines of small
 * type).
 */
export function layoutPlaces(
  context: CanvasRenderingContext2D,
  places: string[],
  maxWidth: number,
  baseSize: number,
  stack: string,
): { size: number; lines: string[] } {
  const measure = (text: string, size: number): number => {
    setFont(context, 500, size, stack);
    return context.measureText(text).width;
  };
  const fitted = layoutPlaceLines(measure, places, maxWidth, baseSize);
  if (fitted) {
    setFont(context, 500, fitted.size, stack);
    return {
      size: fitted.size,
      lines: fitted.lines.map((line) => line.join(PLACE_SEPARATOR)),
    };
  }
  const size = baseSize * MIN_PLACE_FACTOR;
  setFont(context, 500, size, stack);
  return {
    size,
    lines: wrapText(context, places.join(PLACE_SEPARATOR), maxWidth, 3),
  };
}

export function starPath(
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

// --- Highlights row ---------------------------------------------------------

export interface CardHighlight {
  name: string;
  /** Raw smallint 1-10; halved for display, as everywhere else. */
  rating: number;
}

export interface HighlightsPlan {
  nameSize: number;
  ratingSize: number;
  starRadius: number;
  innerGap: number;
  starGap: number;
  sepWidth: number;
  names: string[];
  ratings: string[];
  /** The rise from the row's baseline to the small caps label above it. */
  labelRise: number;
  labelSize: number;
}

/**
 * Lay out the best-rated experiences as one line: name, star, rating, repeat.
 * Stacked rows spent three times the vertical space on content that sits
 * comfortably across the width, and a photograph has more use for that room.
 *
 * Shrinks through the same ladder the places line uses, and only shortens a
 * name once the smallest step still overflows.
 */
export function planHighlights(
  context: CanvasRenderingContext2D,
  highlights: CardHighlight[],
  contentWidth: number,
  unit: number,
  stack: string,
): HighlightsPlan {
  const count = highlights.length;
  const labelSize = unit * 0.0145;
  const steps = [1, 0.94, 0.88, 0.82, 0.76, 0.7];
  let fitted: HighlightsPlan | null = null;

  for (const factor of steps) {
    const nameSize = unit * 0.0215 * factor;
    const ratingSize = nameSize * 0.9;
    const starRadius = ratingSize * 0.42;
    const innerGap = nameSize * 0.38;
    const starGap = ratingSize * 0.32;
    const ratings = highlights.map((item) => (item.rating / 2).toFixed(1));

    setFont(context, 600, ratingSize, stack);
    const ratingWidths = ratings.map((text) => context.measureText(text).width);
    setFont(context, 500, nameSize, stack);
    const sepWidth = context.measureText(PLACE_SEPARATOR).width;
    const names = highlights.map((item) => item.name);
    const nameTotal = names.reduce(
      (total, name) => total + context.measureText(name).width,
      0,
    );
    const fixed =
      ratingWidths.reduce((total, width) => total + width, 0) +
      count * (innerGap + starRadius * 2 + starGap) +
      sepWidth * (count - 1);

    fitted = {
      nameSize,
      ratingSize,
      starRadius,
      innerGap,
      starGap,
      sepWidth,
      names,
      ratings,
      // The label sits just clear of the line's cap height, and the gap above
      // it is wide enough that it does not read as another line of the stats
      // row's labels, which are small tracked caps at almost the same size.
      labelRise: nameSize * 0.75 + labelSize * 0.9,
      labelSize,
    };
    if (fixed + nameTotal <= contentWidth) return fitted;
    if (factor === steps[steps.length - 1]) {
      const budget = Math.max(unit * 0.045, (contentWidth - fixed) / count);
      fitted.names = names.map(
        (name) => wrapText(context, name, budget, 1)[0] ?? name,
      );
    }
  }
  return fitted as HighlightsPlan;
}

/** Draw the planned highlights row, with its label above it. */
export function drawHighlights(
  context: CanvasRenderingContext2D,
  plan: HighlightsPlan,
  x: number,
  baseline: number,
  stack: string,
  label: string,
): void {
  const count = plan.names.length;
  let cursor = x;
  context.textAlign = "left";
  for (let i = 0; i < count; i += 1) {
    setFont(context, 500, plan.nameSize, stack);
    context.fillStyle = "rgba(255, 255, 255, 0.86)";
    context.fillText(plan.names[i], cursor, baseline);
    cursor += context.measureText(plan.names[i]).width + plan.innerGap;

    starPath(
      context,
      cursor + plan.starRadius,
      baseline - plan.ratingSize * 0.32,
      plan.starRadius,
    );
    context.fillStyle = "#fbbf24";
    context.fill();
    cursor += plan.starRadius * 2 + plan.starGap;

    setFont(context, 600, plan.ratingSize, stack);
    context.fillStyle = "rgba(255, 255, 255, 0.8)";
    context.fillText(plan.ratings[i], cursor, baseline);
    cursor += context.measureText(plan.ratings[i]).width;

    if (i < count - 1) {
      setFont(context, 500, plan.nameSize, stack);
      context.fillStyle = "rgba(255, 255, 255, 0.35)";
      context.fillText(PLACE_SEPARATOR, cursor, baseline);
      cursor += plan.sepWidth;
    }
  }

  setFont(context, 500, plan.labelSize, stack);
  context.fillStyle = "rgba(255, 255, 255, 0.45)";
  drawTracked(
    context,
    label,
    x,
    baseline - plan.labelRise,
    plan.labelSize * 0.22,
    "left",
  );
}

/** A stats tile's measured width, used to lay a row of them out. */
export function statTileWidth(
  context: CanvasRenderingContext2D,
  tile: { value: string; label: string },
  valueSize: number,
  labelSize: number,
  stack: string,
): number {
  setFont(context, 600, valueSize, stack);
  const valueWidth = context.measureText(tile.value).width;
  setFont(context, 500, labelSize, stack);
  const labelWidth = trackedWidth(
    context,
    tile.label.toUpperCase(),
    labelSize * 0.22,
  );
  return Math.max(valueWidth, labelWidth);
}

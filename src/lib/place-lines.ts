// Laying a list of place names out without ever truncating it.
//
// This is the house pattern, and it was built for the share card's country
// line: a "+8" hid most of the trip, so the rule became "show everything,
// shrink the type before wrapping, wrap between places and never inside one".
// It lived in poster/card-parts.ts, which meant it could only be used by the
// two canvas cards. Every full-screen surface that prints a route (the trip
// story's opener, the recap's trip slides) had its own "and N more" instead.
//
// So the algorithm moved here and takes a MEASURE FUNCTION rather than a
// canvas context. The cards pass a canvas measurer, the DOM component passes
// one backed by an offscreen canvas reading the element's own font, and both
// get the same breaks. Nothing here touches the DOM or a canvas itself, so it
// is pure and testable.

/** The separator between places. Wide spaces rather than a comma: at card
 * sizes a comma disappears, and the same mark reads the same everywhere. */
export const PLACE_SEPARATOR = "  ·  ";

/** How wide `text` is when set at `size` pixels, in the caller's own type. */
export type MeasurePlaces = (text: string, size: number) => number;

/** Places grouped into the lines they will be drawn on. */
export type PlaceLines = string[][];

export interface PlaceLayout {
  /** The font size that fit, in px. */
  size: number;
  lines: PlaceLines;
}

/**
 * Shrink further before accepting a wrap, but not without limit: past about
 * three quarters the line stops being readable, and two balanced lines at a
 * legible size are the better trade.
 */
export const ONE_LINE_STEPS = [1, 0.94, 0.88, 0.82, 0.76];
export const WRAPPED_STEPS = [1, 0.94, 0.88, 0.82, 0.76, 0.7];

/** The smallest step either ladder reaches, so a caller can spell its own
 * last-resort pass at the same size the ladder ended on. */
export const MIN_PLACE_FACTOR = 0.7;

function lineWidth(
  measure: MeasurePlaces,
  places: string[],
  size: number,
): number {
  return measure(places.join(PLACE_SEPARATOR), size);
}

/**
 * Greedy wrap that breaks between places and never inside one, and reports
 * failure instead of ellipsizing.
 *
 * Wrapping on spaces would be wrong here: "United States" and "New Zealand"
 * are single items, and a line ending in "New" with "Zealand" below it is a
 * different kind of broken from the truncation this replaced.
 */
export function greedyPlaceLines(
  measure: MeasurePlaces,
  places: string[],
  limit: number,
  size: number,
): PlaceLines | null {
  const lines: PlaceLines = [];
  let line: string[] = [];
  for (const place of places) {
    // A single place wider than the limit: no wrapping saves this.
    if (measure(place, size) > limit) return null;
    const candidate = [...line, place];
    if (lineWidth(measure, candidate, size) <= limit) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = [place];
  }
  if (line.length > 0) lines.push(line);
  return lines.length > 0 ? lines : null;
}

/**
 * Wrap into balanced lines rather than greedy ones.
 *
 * Greedy filling packs line one to the edge and leaves whatever is left over
 * below it, which is how seven countries ended up as six and then "Spain"
 * alone. Squeezing the allowed width down until the line count is about to
 * rise finds the narrowest width that still fits in the same number of lines,
 * and that is exactly the balanced split: bisection over the width rather than
 * any special case for two lines versus three.
 */
export function balancedPlaceLines(
  measure: MeasurePlaces,
  places: string[],
  maxWidth: number,
  maxLines: number,
  size: number,
): PlaceLines | null {
  const fitted = greedyPlaceLines(measure, places, maxWidth, size);
  if (!fitted || fitted.length > maxLines) return null;
  if (fitted.length === 1) return fitted;

  let tooNarrow = 0;
  let wide = maxWidth;
  for (let i = 0; i < 22; i += 1) {
    const mid = (tooNarrow + wide) / 2;
    const attempt = greedyPlaceLines(measure, places, mid, size);
    if (attempt && attempt.length <= fitted.length) wide = mid;
    else tooNarrow = mid;
  }
  return greedyPlaceLines(measure, places, wide, size) ?? fitted;
}

/**
 * Fit the places into at most `maxLines` lines, or report that they do not.
 *
 * EVERY SIZE IS TRIED ON ONE LINE BEFORE A SECOND LINE IS CONSIDERED AT ALL.
 * The loops are line count outer, size inner, and reversing them is what put
 * six countries on line one and "Spain" alone underneath: a slightly smaller
 * single line reads better than a full-size line with an orphan below it.
 *
 * Returns null when even the smallest step overflows the allowed lines, which
 * is the caller's cue to widen the budget rather than to start cutting names.
 */
export function layoutPlaceLines(
  measure: MeasurePlaces,
  places: string[],
  maxWidth: number,
  baseSize: number,
  maxLines: number[] = [1, 2, 3],
): PlaceLayout | null {
  if (places.length === 0 || maxWidth <= 0 || baseSize <= 0) return null;
  for (const limit of maxLines) {
    const steps = limit === 1 ? ONE_LINE_STEPS : WRAPPED_STEPS;
    for (const factor of steps) {
      const size = baseSize * factor;
      const lines = balancedPlaceLines(measure, places, maxWidth, limit, size);
      if (lines) return { size, lines };
    }
  }
  return null;
}

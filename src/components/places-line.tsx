"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  MIN_PLACE_FACTOR,
  PLACE_SEPARATOR,
  greedyPlaceLines,
  layoutPlaceLines,
  type MeasurePlaces,
  type PlaceLines,
} from "@/lib/place-lines";
import { cn } from "@/lib/utils";

// A list of places that never truncates.
//
// The rule and the reason are in lib/place-lines.ts: a "+8" hides most of the
// trip, so everything is shown, the type shrinks before a wrap is accepted,
// and a wrap breaks between places and never inside one. This is the DOM half
// of it; the canvas cards are the other half, and both call the same function,
// so a nine-country trip breaks the same way on a slide and on a share card.
//
// TWO THINGS THAT LOOK INCIDENTAL AND ARE NOT
//
//   1. The type is scaled on an INNER span, never on the measured element.
//      Writing the fitted size onto the frame would make the next measurement
//      read the shrunken size as the base, so every resize would shrink the
//      line again until it vanished.
//   2. Measurement is canvas, not DOM. Laying out a hidden copy per candidate
//      size, per line count, inside a bisection is a hundred forced reflows
//      for one line of text. Canvas metrics for the same font and size agree
//      with the browser's own well inside the slack the fit already carries.

/** Joins the places into one dependency string. A newline, because a place
 * name cannot contain one, so splitting it back apart is exact. */
const KEY_SEPARATOR = "\n";

/** Where the measuring context lives. One per document, not one per line. */
let scratch: CanvasRenderingContext2D | null = null;

function measuringContext(): CanvasRenderingContext2D | null {
  if (scratch) return scratch;
  if (typeof document === "undefined") return null;
  scratch = document.createElement("canvas").getContext("2d");
  return scratch;
}

/** A measurer in the element's own typeface. Null when there is no canvas to
 * measure with, in which case the caller falls back to plain CSS wrapping. */
function measurerFor(
  element: HTMLElement,
): { measure: MeasurePlaces; baseSize: number } | null {
  const context = measuringContext();
  if (!context) return null;
  const style = window.getComputedStyle(element);
  const baseSize = Number.parseFloat(style.fontSize);
  if (!Number.isFinite(baseSize) || baseSize <= 0) return null;
  const family = style.fontFamily || "sans-serif";
  const weight = style.fontWeight || "400";
  // Tracking is part of the width. Where it was authored in em it has to scale
  // with the size the ladder is trying, so it is normalised to a ratio here.
  const spacing = Number.parseFloat(style.letterSpacing);
  const spacingEm = Number.isFinite(spacing) ? spacing / baseSize : 0;
  const measure: MeasurePlaces = (text, size) => {
    context.font = `${weight} ${size}px ${family}`;
    const width = context.measureText(text).width;
    return spacingEm === 0 ? width : width + spacingEm * size * text.length;
  };
  return { measure, baseSize };
}

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

interface Fit {
  scale: number;
  lines: PlaceLines;
}

function sameFit(a: Fit | null, b: Fit): boolean {
  if (!a || a.scale !== b.scale || a.lines.length !== b.lines.length) {
    return false;
  }
  return a.lines.every(
    (line, index) =>
      line.join(KEY_SEPARATOR) === b.lines[index].join(KEY_SEPARATOR),
  );
}

export function PlacesLine({
  places,
  className,
  align = "left",
  /**
   * Line counts to try, in order, before the last resort. Three is what the
   * cards allow; a full-screen slide has the room for a fourth.
   */
  maxLines = [1, 2, 3, 4],
}: {
  places: string[];
  className?: string;
  align?: "left" | "center";
  maxLines?: number[];
}) {
  const frame = useRef<HTMLParagraphElement>(null);
  const [fit, setFit] = useState<Fit | null>(null);

  // Both arrays are rebuilt by the caller on every render, so both are rebuilt
  // HERE from a string of their contents. The effect then re-runs when the
  // places actually change rather than once per render of the slide around it.
  const key = places.join(KEY_SEPARATOR);
  const linesKey = maxLines.join(",");
  const list = useMemo(() => key.split(KEY_SEPARATOR), [key]);
  const limits = useMemo(() => linesKey.split(",").map(Number), [linesKey]);

  useIsomorphicLayoutEffect(() => {
    const element = frame.current;
    if (!element || list.length === 0) return;

    const measureFit = () => {
      const width = element.clientWidth;
      const context = measurerFor(element);
      if (!context || width <= 0) return;
      const { measure, baseSize } = context;
      // A hair under the full width, so a rounded-up subpixel is not the thing
      // that pushes the last place onto a line of its own.
      const limit = width * 0.995;
      const fitted = layoutPlaceLines(measure, list, limit, baseSize, limits);
      const next: Fit = fitted
        ? { scale: fitted.size / baseSize, lines: fitted.lines }
        : // Nothing fit the allowed lines. AS MANY LINES AS IT TAKES, then, at
          // the smallest size the ladder reaches: this is a list of places, and
          // there is no count of them at which hiding some becomes right.
          {
            scale: MIN_PLACE_FACTOR,
            lines:
              greedyPlaceLines(
                measure,
                list,
                limit,
                baseSize * MIN_PLACE_FACTOR,
              ) ??
              // One place is wider than the whole column. Give it a line of its
              // own and let the browser break inside it, which is the only
              // remaining way to show the name at all.
              list.map((place) => [place]),
          };
      setFit((current) => (sameFit(current, next) ? current : next));
    };

    measureFit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measureFit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [list, limits]);

  if (places.length === 0) return null;

  return (
    <p ref={frame} className={cn(align === "center" && "text-center", className)}>
      <span
        className="block"
        style={
          fit && fit.scale < 1
            ? { fontSize: `${(fit.scale * 100).toFixed(2)}%` }
            : undefined
        }
      >
        {/* Before the first measurement (and wherever canvas metrics are not
            available) this is a plain wrapping line, which is already right
            for the trips that never needed shrinking. */}
        {(fit?.lines ?? [places]).map((line, index) => (
          <span
            key={index}
            className={cn("block", fit ? "whitespace-nowrap" : undefined)}
          >
            {line.map((place, position) => (
              <span key={`${place}-${position}`}>
                {position > 0 ? (
                  <span className="opacity-45">{PLACE_SEPARATOR}</span>
                ) : null}
                {place}
              </span>
            ))}
          </span>
        ))}
      </span>
    </p>
  );
}

"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

// One line of text that shrinks rather than wraps.
//
// It exists for the slide eyebrows: "TRIP 1 OF 2 · MAY 12, 2025 TO JUN 10,
// 2025" is a single fact, and on a phone it broke after the comma and left
// "2025" alone on a second line, which reads as a second fact. Wrapping is the
// wrong repair for a line that is already one idea; shrinking it slightly is
// invisible, and the line stays one line.
//
// The measuring technique is ScoreValue's, and for the same reasons: an
// invisible full-size copy inside a zero-height clipped wrapper, measured with
// getBoundingClientRect (never scrollWidth, which never reports less than the
// element it sits in and so measures every fitting line as exactly its own
// column), and the visible line set to a percentage of its own font size so
// the box shrinks with the type instead of a transform leaving the row as tall
// as a size nobody can see.
//
// Children are rendered twice, so they must be static text. A control in here
// would be duplicated into the aria-hidden copy.

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function FitLine({
  children,
  className,
  /** Past this the line is too small to read, so it is allowed to wrap after
   * all. A line that cannot fit at 60% is not a line, it is a paragraph. */
  minScale = 0.6,
}: {
  children: React.ReactNode;
  className?: string;
  minScale?: number;
}) {
  const frame = useRef<HTMLSpanElement>(null);
  const rule = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(1);

  useIsomorphicLayoutEffect(() => {
    const frameEl = frame.current;
    const ruleEl = rule.current;
    if (!frameEl || !ruleEl) return;
    const fit = () => {
      const available = frameEl.clientWidth;
      const natural = ruleEl.getBoundingClientRect().width;
      if (available <= 0 || natural <= 0) return;
      // A hair under one, so a rounded-up subpixel is not what wraps the line
      // after all this.
      const next = Math.min(1, (available * 0.995) / natural);
      setScale((current) => (Math.abs(current - next) < 0.002 ? current : next));
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(frameEl);
    return () => observer.disconnect();
  });

  const wraps = scale < minScale;
  const applied = wraps ? minScale : scale;

  // A span rather than a paragraph, so a caller can put one inside a line that
  // already has an icon on it without nesting block elements illegally.
  return (
    <span ref={frame} className={cn("relative block", className)}>
      {/* The measuring copy, at full size. The wrapper is zero-height and
          clipped so a line wider than its column cannot widen the page while
          it is being measured. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 block h-0 overflow-hidden"
      >
        <span ref={rule} className="invisible inline-block whitespace-nowrap">
          {children}
        </span>
      </span>
      <span
        className={cn("block", wraps ? "whitespace-normal" : "whitespace-nowrap")}
        style={
          applied < 1
            ? { fontSize: `${(applied * 100).toFixed(2)}%` }
            : undefined
        }
      >
        {children}
      </span>
    </span>
  );
}

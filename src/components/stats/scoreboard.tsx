"use client";

import { useEffect, useRef, useState } from "react";

import { AnimatedNumber } from "@/components/stats/count-up";
import { cn } from "@/lib/utils";

// The scoreboard a trip story and a year recap both close on: one or two
// numbers at real scale, then a quiet strip of everything else. They are the
// same composition deliberately (see CLAUDE.md), so they are also the same two
// components, and a fix to how a number sits applies to both.
//
// Two layout rules live here, both of them things a plain grid gets wrong on
// real data:
//
//   1. A NUMBER AND ITS UNIT ARE ONE LINE. "4,660" over "km" is two facts
//      stacked, and it reads as a second statistic. So the line is measured
//      against the column it has to fit and the type is scaled down until it
//      does, rather than being allowed to wrap. The unit rides in `em`, which
//      keeps it subordinate and on the same baseline at every size.
//   2. A ROW THAT MUST WRAP WRAPS EVENLY. Four across and a fifth alone
//      underneath reads as a mistake. Five fit on one row where there is width
//      for them, and where there is not the split is balanced (see
//      balancedColumns), the same principle the share card's places line uses.

/** How many supporting tiles will sit on one row once there is room for them.
 * The strip is capped at six by what buildScoreboard can produce. */
const WIDE_MAX = 6;

/** How many fit on a phone before the row has to wrap. */
const NARROW_MAX = 3;

/**
 * Columns for a row that has to wrap: the widest split up to `max` that does
 * not leave one tile alone on the last row.
 *
 * Pure, and the whole of the wrap policy. Five over three columns is 3 + 2,
 * which is balanced; five over four would be 4 + 1, which is the orphan this
 * exists to prevent.
 */
export function balancedColumns(count: number, max: number): number {
  if (count <= 0) return 1;
  if (count <= max) return count;
  let best = max;
  let bestScore = -1;
  for (let columns = max; columns >= 2; columns -= 1) {
    const remainder = count % columns;
    // A full last row wins outright; past that, the fuller the last row the
    // better, and a wider split breaks the tie.
    const score = remainder === 0 ? columns + 1 : remainder;
    if (score > bestScore) {
      bestScore = score;
      best = columns;
    }
  }
  return best;
}

// Written out rather than interpolated, because Tailwind reads the source for
// the class names it generates.
const NARROW_COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
};

const WIDE_COLUMNS: Record<number, string> = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
  5: "sm:grid-cols-5",
  6: "sm:grid-cols-6",
};

/**
 * One number, with its unit beside it, scaled to stay on a single line.
 *
 * The line is measured at full size in an invisible copy carrying the FINAL
 * value, so a count-up cannot change the fit as it runs, and the visible line
 * is then set to a percentage of its own font size. Percentage rather than a
 * transform because the box has to shrink with the type: a scaled transform
 * leaves the row as tall as the size nobody can see.
 */
export function ScoreValue({
  value,
  unit,
  animate = false,
  className,
}: {
  value: number;
  /** Rendered small and muted beside the number, e.g. "km". */
  unit?: string | null;
  /** Count up from zero when the group becomes active. */
  animate?: boolean;
  /** The type scale and colour of the number itself. */
  className?: string;
}) {
  const frame = useRef<HTMLSpanElement>(null);
  const rule = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(1);
  const text = value.toLocaleString("en-US");

  useEffect(() => {
    const frameEl = frame.current;
    const ruleEl = rule.current;
    if (!frameEl || !ruleEl) return;
    const fit = () => {
      const available = frameEl.clientWidth;
      // The rule is a shrink-to-fit line, so its own box IS the natural width.
      // scrollWidth was the obvious reading and it is the wrong one: it never
      // reports less than the element it sits in, so a line that already fits
      // measures as exactly its container and every value scales by the same
      // meaningless fraction.
      const natural = ruleEl.getBoundingClientRect().width;
      if (available <= 0 || natural <= 0) return;
      // A hair under one, so a rounded-up subpixel is not the thing that puts
      // the unit on its own line after all this.
      setScale(Math.min(1, (available * 0.995) / natural));
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(frameEl);
    return () => observer.disconnect();
  }, [text, unit]);

  const mark = unit ? (
    <span className="ml-[0.14em] align-baseline text-[0.4em] font-medium text-white/45">
      {unit}
    </span>
  ) : null;

  return (
    <span ref={frame} className={cn("relative block tabular-nums", className)}>
      {/* The measuring copy, at full size and carrying the final value. The
          wrapper is zero-height and clipped so a line wider than its column
          cannot widen the page while it is being measured. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 block h-0 overflow-hidden"
      >
        <span ref={rule} className="invisible inline-block whitespace-nowrap">
          {text}
          {mark}
        </span>
      </span>
      <span
        className="block whitespace-nowrap"
        style={
          scale < 1 ? { fontSize: `${(scale * 100).toFixed(2)}%` } : undefined
        }
      >
        {animate ? <AnimatedNumber value={value} /> : text}
        {mark}
      </span>
    </span>
  );
}

export interface ScoreTile {
  label: string;
  value: string;
  /** The same value as a number where it is one, for the count-up. */
  numeric?: number | null;
}

/**
 * The supporting numbers: one strip, read as a group or not at all.
 *
 * The column count follows the number of tiles rather than being fixed, which
 * is what keeps five of them on one row instead of four and an orphan, and the
 * type steps down once the row is five or six wide so the labels still fit the
 * column they are in.
 */
export function ScoreStrip({
  tiles,
  animate = false,
  className,
}: {
  tiles: ScoreTile[];
  animate?: boolean;
  className?: string;
}) {
  if (tiles.length === 0) return null;
  const wide = Math.min(tiles.length, WIDE_MAX);
  const narrow = balancedColumns(tiles.length, NARROW_MAX);
  const tight = wide >= 5;

  return (
    <dl
      className={cn(
        "grid w-full gap-y-4 rounded-2xl border border-white/[0.09] bg-white/[0.03] px-2 py-4 sm:py-5",
        NARROW_COLUMNS[narrow] ?? "grid-cols-3",
        WIDE_COLUMNS[wide] ?? "sm:grid-cols-4",
        className,
      )}
    >
      {tiles.map((tile) => (
        <div key={tile.label} className={cn("px-2", tight && "sm:px-1.5")}>
          <dd
            className={cn(
              "font-medium tabular-nums text-white/90",
              tight ? "text-lg sm:text-base" : "text-lg",
            )}
          >
            {animate && tile.numeric !== null && tile.numeric !== undefined ? (
              <AnimatedNumber value={tile.numeric} />
            ) : (
              tile.value
            )}
          </dd>
          <dt
            className={cn(
              "mt-0.5 uppercase tracking-wide text-white/40",
              tight ? "text-[10px] sm:text-[9px]" : "text-[10px]",
            )}
          >
            {tile.label}
          </dt>
        </div>
      ))}
    </dl>
  );
}

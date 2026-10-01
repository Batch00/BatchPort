"use client";

import { useId, useMemo, useState } from "react";

import { formatDate } from "@/lib/format";
import { posterTheme } from "@/lib/poster/theme";
import {
  DC,
  SMALL_STATES,
  buildStateMap,
  visitedInOrder,
  type MapState,
  type StateCoverageRow,
} from "@/lib/state-map";
import {
  US_STATES_VIEWBOX,
  US_STATE_SHAPES,
} from "@/lib/us-states-geometry";
import { cn } from "@/lib/utils";

// The states choropleth on the stats page. Inline SVG, not MapLibre: it never
// pans or zooms, so tiles and a projection at run time buy nothing. The paths
// are pre-projected by scripts/generate-us-states.ts.
//
// Colours are the Midnight poster palette, read from posterTheme rather than
// restated, because that palette already answers "visited country on dark
// land" and the exported poster and this card should not drift apart. The map
// sits on the palette's OCEAN tone rather than directly on the card: the card
// (oklch 0.205) is lighter than the land tone, so land drawn straight onto it
// reads as holes cut in the card, which is the exact figure-ground failure
// theme.ts documents for the ocean.
//
// Phone legibility is carried by three things, not by the map alone:
//
//  * Strokes are non-scaling, so borders stay a hairline at 360px instead of
//    thinning to nothing with the viewBox.
//  * The small eastern states (and DC) get labelled chips under the map. On a
//    phone Rhode Island is about four pixels wide; a chip is a real target.
//  * Visited states are also NAMED, in the order they were reached, so the
//    answer never depends on recognising a shape.
//
// Paths are not focusable: fifty-one tab stops to reach the rest of the page
// is a worse keyboard experience than the chips plus the named list, which
// carry the same information.

const theme = posterTheme("midnight");

export function StatesMap({ rows }: { rows: StateCoverageRow[] }) {
  const model = useMemo(() => buildStateMap(rows), [rows]);
  const visited = useMemo(() => visitedInOrder(model), [model]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const smallStatesId = useId();

  const focus = hovered ?? selected;
  const focusState = focus ? model.states[focus] : null;
  const dc = US_STATE_SHAPES.find((s) => s.code === DC);
  const empty = model.visitedCount === 0 && !model.dcVisited;

  const toggle = (code: string) =>
    setSelected((current) => (current === code ? null : code));

  // The focused shape is drawn again on top, so its highlight is not
  // half-covered by whichever neighbour happens to come later in the list.
  const focusShape = focus ? US_STATE_SHAPES.find((s) => s.code === focus) : null;

  return (
    <div className="min-w-0 rounded-2xl bg-card p-5 ring-1 ring-foreground/10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <h3 className="text-sm font-medium text-foreground/80">US states</h3>
          <p className="mt-0.5 text-xs text-foreground/45">
            Trip stops and places both count
          </p>
        </div>
        <p className="text-sm text-foreground/60">
          <span className="text-2xl font-semibold tabular-nums text-foreground">
            {model.visitedCount}
          </span>{" "}
          of {model.total}
          {model.dcVisited ? <span className="text-foreground/45">, plus DC</span> : null}
        </p>
      </div>

      <div
        className="rounded-xl p-2 sm:p-4"
        style={{ backgroundColor: theme.ocean }}
      >
        <svg
          viewBox={US_STATES_VIEWBOX}
          className={cn("block h-auto w-full", empty && "opacity-80")}
          role="img"
          aria-label={`Map of US states, ${model.visitedCount} of ${model.total} visited`}
          onPointerLeave={() => setHovered(null)}
        >
          {US_STATE_SHAPES.map((shape) => (
            <StatePath
              key={shape.code}
              d={shape.d}
              state={model.states[shape.code]}
              onSelect={toggle}
              onHover={setHovered}
            />
          ))}
          {focusShape ? (
            <path
              d={focusShape.d}
              fill="none"
              stroke="#ffffff"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ) : null}
          {/* DC is under two units across at this scale, so it is drawn as a
              marker. The shape underneath still exists; this is what makes
              it visible and tappable. */}
          {dc ? (
            <circle
              cx={dc.cx}
              cy={dc.cy}
              r={6}
              fill={model.dcVisited ? theme.visitedStroke : theme.land}
              stroke={focus === DC ? "#ffffff" : theme.ocean}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              className="cursor-pointer"
              onClick={() => toggle(DC)}
              onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(DC)}
            >
              <title>District of Columbia</title>
            </circle>
          ) : null}
        </svg>
      </div>

      {/* One line, always present, so selecting a state never moves the
          layout under the thumb that just selected it. */}
      <p className="mt-3 min-h-5 text-sm text-foreground/70" aria-live="polite">
        {focusState ? (
          <Readout state={focusState} />
        ) : (
          <span className="text-foreground/40">
            {empty ? "No US states yet" : "Tap a state for when you first went"}
          </span>
        )}
      </p>

      {/* The chips need a caption: without one they read as an unexplained
          row of abbreviations. The caption is also the group's accessible
          name, so a screen reader hears the same explanation. */}
      <p id={smallStatesId} className="mt-3 mb-1.5 text-xs text-foreground/45">
        Small states, too small to tap on the map
      </p>
      <div
        role="group"
        aria-labelledby={smallStatesId}
        className="flex flex-wrap gap-1.5"
      >
        {SMALL_STATES.map((code) => {
          const state = model.states[code];
          if (!state) return null;
          return (
            <button
              key={code}
              type="button"
              onClick={() => toggle(code)}
              aria-pressed={selected === code}
              aria-label={`${state.name}, ${state.visited ? "visited" : "not visited"}`}
              className={cn(
                "h-9 min-w-10 rounded-md px-2 text-xs font-medium tabular-nums ring-1 transition-colors",
                state.visited
                  ? "bg-brand/60 text-white ring-brand/70"
                  : "bg-white/[0.03] text-foreground/45 ring-white/10",
                selected === code && "ring-2 ring-white",
              )}
            >
              {code}
            </button>
          );
        })}
      </div>

      <div className="mt-4 border-t border-white/5 pt-3">
        {empty ? (
          <p className="text-sm text-foreground/50">
            A trip stop or a place anywhere in the US fills its state in here.
          </p>
        ) : (
          <>
            <p className="mb-1.5 text-xs text-foreground/45">In the order you first went</p>
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-foreground/75">
              {visited.map((state) => (
                <li key={state.code}>
                  <button
                    type="button"
                    onClick={() => toggle(state.code)}
                    className={cn(
                      "rounded-sm transition-colors hover:text-foreground",
                      selected === state.code && "text-foreground underline underline-offset-4",
                    )}
                  >
                    {state.name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function StatePath({
  d,
  state,
  onSelect,
  onHover,
}: {
  d: string;
  state: MapState;
  onSelect: (code: string) => void;
  onHover: (code: string | null) => void;
}) {
  return (
    <path
      d={d}
      fill={state.visited ? theme.visited : theme.land}
      stroke={state.visited ? theme.visitedStroke : theme.landStroke}
      strokeWidth={0.75}
      vectorEffect="non-scaling-stroke"
      strokeLinejoin="round"
      className="cursor-pointer transition-[fill] duration-150"
      onClick={() => onSelect(state.code)}
      // Mouse only: a touch "hover" sticks after the finger lifts and would
      // fight the selection the same tap just made.
      onPointerEnter={(e) => e.pointerType === "mouse" && onHover(state.code)}
    >
      <title>{state.name}</title>
    </path>
  );
}

function Readout({ state }: { state: MapState }) {
  if (!state.visited) {
    return (
      <>
        <span className="text-foreground">{state.name}</span>
        <span className="text-foreground/45">, not yet</span>
      </>
    );
  }
  return (
    <>
      <span className="text-foreground">{state.name}</span>
      <span className="text-foreground/55">
        {state.firstVisitDate
          ? `, first visited ${formatDate(state.firstVisitDate)}`
          : ", visited (no date recorded)"}
      </span>
    </>
  );
}

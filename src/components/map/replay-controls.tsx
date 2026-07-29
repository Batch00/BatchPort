"use client";

// Overlay UI for the globe's replay mode: the date/countries/trip readout in
// the top-left and the transport bar (play/pause, scrubber, speed, exit) along
// the bottom. The readout and scrubber elements are updated imperatively by
// the replay engine through refs, so nothing here re-renders per frame.

import { useRef } from "react";
import {
  LocateFixedIcon,
  LocateOffIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { ActionTip } from "@/components/ui/info-tip";
import type {
  ReplayFollow,
  ReplayOverlayAttach,
  ReplaySpeed,
} from "./use-replay";

interface ReplayControlsProps {
  playing: boolean;
  ended: boolean;
  speed: ReplaySpeed;
  follow: ReplayFollow;
  attach: ReplayOverlayAttach;
  onTogglePlay: () => void;
  onToggleSpeed: () => void;
  onToggleFollow: () => void;
  onRestart: () => void;
  onExit: () => void;
  onScrubStart: () => void;
  onScrub: (fraction: number) => void;
  onScrubEnd: () => void;
}

const TRANSPORT_BUTTON =
  "flex size-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-foreground/80 shadow-lg backdrop-blur-md transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60";

// The three follow states read as three distinct fills: solid brand while the
// camera is tracking, a soft brand tint while it is paused and waiting for the
// next trip, and the plain transport treatment once it is off for good.
const FOLLOW_STATES: Record<
  ReplayFollow,
  { label: string; title: string; className: string }
> = {
  on: {
    label: "Following",
    title: "Camera is following playback. Tap to stop.",
    className:
      "border-brand bg-brand text-brand-foreground hover:bg-brand/90 hover:text-brand-foreground",
  },
  paused: {
    label: "Paused",
    title: "Following paused by your pan or zoom. Resumes at the next trip, or tap to catch up now.",
    className: "border-brand/40 bg-brand/15 text-brand hover:bg-brand/25",
  },
  off: {
    label: "Free",
    title: "Camera is free. Tap to follow playback again.",
    className: "",
  },
};

export function ReplayControls({
  playing,
  ended,
  speed,
  follow,
  attach,
  onTogglePlay,
  onToggleSpeed,
  onToggleFollow,
  onRestart,
  onExit,
  onScrubStart,
  onScrub,
  onScrubEnd,
}: ReplayControlsProps) {
  // Destructure once: the engine's callback refs are plain stable functions,
  // and single bindings keep the react-hooks ref heuristics happy.
  const {
    date: attachDate,
    counter: attachCounter,
    trip: attachTrip,
    fill: attachFill,
    thumb: attachThumb,
  } = attach;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  function fractionFromClientX(clientX: number): number {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    onScrubStart();
    onScrub(fractionFromClientX(event.clientX));
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    onScrub(fractionFromClientX(event.clientX));
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onScrubEnd();
  }

  return (
    <>
      {/* Date, countries counter, and active trip name. */}
      <div className="pointer-events-none absolute left-4 top-4 z-30 flex flex-col gap-0.5">
        <span
          ref={attachDate}
          className="text-xl font-semibold tabular-nums tracking-tight text-foreground drop-shadow-md sm:text-2xl"
        />
        <span
          ref={attachCounter}
          className="text-xs font-medium text-foreground/70 drop-shadow-md"
        />
        <span
          ref={attachTrip}
          className="mt-1 max-w-56 truncate text-sm font-medium text-brand drop-shadow-md transition-opacity duration-500"
          style={{ opacity: 0 }}
        />
      </div>

      {/* End-of-replay chip. */}
      {ended ? (
        <div className="absolute left-1/2 top-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full border border-white/10 bg-black/70 py-1.5 pl-4 pr-1.5 shadow-xl backdrop-blur-md">
          <button
            type="button"
            onClick={onRestart}
            className="flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-brand"
          >
            <RotateCcwIcon className="size-4" />
            Replay again
          </button>
          <button
            type="button"
            onClick={onExit}
            className="rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-foreground/80 transition-colors hover:bg-white/15 hover:text-foreground"
          >
            Exit
          </button>
        </div>
      ) : null}

      {/* Transport bar with the scrubber. Safe-area padding keeps it clear of
          home indicators on installed mobile PWAs. */}
      <div className="absolute inset-x-0 bottom-0 z-30 px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-8">
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={playing ? "Pause replay" : "Play replay"}
            className={TRANSPORT_BUTTON}
          >
            {playing ? (
              <PauseIcon className="size-4" />
            ) : ended ? (
              <RotateCcwIcon className="size-4" />
            ) : (
              <PlayIcon className="size-4 translate-x-px" />
            )}
          </button>

          <div
            ref={trackRef}
            aria-label="Replay position"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="group relative flex h-8 flex-1 cursor-pointer touch-none items-center"
          >
            <div className="relative h-1 w-full overflow-visible rounded-full bg-white/15">
              <div
                ref={attachFill}
                className="absolute inset-y-0 left-0 rounded-full bg-brand"
                style={{ width: "0%" }}
              />
            </div>
            <div
              ref={attachThumb}
              className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-md ring-2 ring-brand/60 transition-transform group-hover:scale-110"
              style={{ left: "0%" }}
            />
          </div>

          {/* Camera follow. Icon only on phones, icon plus state label from
              sm up, so the current state reads at a glance either way. The
              longer explanation rides in the aria-label as well as the tip, so
              touch users (who get no tip on an action button) still have it. */}
          <ActionTip tip={FOLLOW_STATES[follow].title}>
            <button
              type="button"
              onClick={onToggleFollow}
              aria-pressed={follow === "on"}
              aria-label={`Camera follow: ${FOLLOW_STATES[follow].label}. ${FOLLOW_STATES[follow].title}`}
              className={cn(
                TRANSPORT_BUTTON,
                "gap-1.5 sm:w-auto sm:px-3",
                FOLLOW_STATES[follow].className,
              )}
            >
              {follow === "off" ? (
                <LocateOffIcon className="size-4" />
              ) : (
                <LocateFixedIcon className="size-4" />
              )}
              <span className="hidden text-xs font-medium sm:inline">
                {FOLLOW_STATES[follow].label}
              </span>
            </button>
          </ActionTip>

          <button
            type="button"
            onClick={onToggleSpeed}
            aria-label={`Playback speed ${speed}x`}
            className={cn(TRANSPORT_BUTTON, "text-xs font-semibold tabular-nums")}
          >
            {speed}x
          </button>
          <button
            type="button"
            onClick={onExit}
            aria-label="Exit replay"
            className={TRANSPORT_BUTTON}
          >
            <XIcon className="size-4" />
          </button>
        </div>
      </div>
    </>
  );
}

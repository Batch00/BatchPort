"use client";

import {
  Globe2,
  LocateFixedIcon,
  Map as MapIcon,
  Maximize2Icon,
  Minimize2Icon,
  PlayIcon,
  RefreshCwIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

interface MapControlsProps {
  projection: "globe" | "mercator";
  onToggle: () => void;
  // When provided, shows a recenter button that snaps back to the data bounds.
  onRecenter?: () => void;
  // When provided, shows a refresh button that re-fetches the map data.
  onRefresh?: () => void;
  refreshing?: boolean;
  // When provided, shows a replay button that starts the timeline playback.
  onReplay?: () => void;
  // When provided, shows an expand/collapse button toggling fullscreen mode.
  onFullscreenToggle?: () => void;
  fullscreen?: boolean;
}

const BUTTON_CLASS =
  "flex size-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-foreground/80 shadow-lg backdrop-blur-md transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60";

// Floating map controls: refresh and recenter (both optional) stacked above the
// projection toggle. The toggle shows the icon of the projection you would
// switch to.
export function MapControls({
  projection,
  onToggle,
  onRecenter,
  onRefresh,
  refreshing = false,
  onReplay,
  onFullscreenToggle,
  fullscreen = false,
}: MapControlsProps) {
  const isGlobe = projection === "globe";
  const toggleLabel = isGlobe ? "Switch to flat map" : "Switch to globe";

  return (
    <div
      className={cn(
        "absolute z-20 flex flex-col gap-2",
        // Fullscreen has no card inset, so the cluster respects device
        // safe areas (notches, home indicators) instead.
        fullscreen
          ? "bottom-[max(2.5rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))]"
          : "bottom-10 right-4",
      )}
    >
      {onFullscreenToggle ? (
        <button
          type="button"
          onClick={onFullscreenToggle}
          aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          className={BUTTON_CLASS}
        >
          {fullscreen ? (
            <Minimize2Icon className="size-5" />
          ) : (
            <Maximize2Icon className="size-5" />
          )}
        </button>
      ) : null}
      {onReplay ? (
        <button
          type="button"
          onClick={onReplay}
          aria-label="Replay your travel history"
          title="Replay"
          className={BUTTON_CLASS}
        >
          <PlayIcon className="size-5 translate-x-px" />
        </button>
      ) : null}
      {onRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh map data"
          title="Refresh"
          className={cn(BUTTON_CLASS, refreshing && "opacity-60")}
        >
          <RefreshCwIcon
            className={cn("size-5", refreshing && "animate-spin")}
          />
        </button>
      ) : null}
      {onRecenter ? (
        <button
          type="button"
          onClick={onRecenter}
          aria-label="Recenter map on your destinations"
          title="Recenter"
          className={BUTTON_CLASS}
        >
          <LocateFixedIcon className="size-5" />
        </button>
      ) : null}
      <button
        type="button"
        onClick={onToggle}
        aria-label={toggleLabel}
        title={toggleLabel}
        className={BUTTON_CLASS}
      >
        {isGlobe ? <MapIcon className="size-5" /> : <Globe2 className="size-5" />}
      </button>
    </div>
  );
}

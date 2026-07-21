"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckIcon,
  Globe2,
  ImageIcon,
  Layers2Icon,
  LocateFixedIcon,
  Map as MapIcon,
  Maximize2Icon,
  Minimize2Icon,
  PlayIcon,
  RefreshCwIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

/** One selectable basemap style for the switcher menu. */
export interface BasemapOption {
  id: string;
  label: string;
}

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
  // When provided, shows a photos toggle that enters/exits photo map mode.
  onPhotoToggle?: () => void;
  photoModeActive?: boolean;
  // When provided (two or more options), shows a basemap style switcher.
  basemaps?: BasemapOption[];
  activeBasemap?: string;
  onBasemapChange?: (id: string) => void;
  // When provided, shows an expand/collapse button toggling fullscreen mode.
  onFullscreenToggle?: () => void;
  fullscreen?: boolean;
}

// Buttons shrink on phones so the whole cluster stays inside a short map, and
// on phones the cluster is a single bottom row (see MapControls) rather than a
// tall column that would collide with the top-corner search.
const BUTTON_CLASS =
  "flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-foreground/80 shadow-lg backdrop-blur-md transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 sm:size-11";

// Floating map controls. On phones they lay out as a single horizontal row
// pinned to the bottom edge, so a tall stack never overlaps the top-corner
// search button or spills past the short map; on sm+ they return to the
// familiar vertical column at bottom-right.
export function MapControls({
  projection,
  onToggle,
  onRecenter,
  onRefresh,
  refreshing = false,
  onReplay,
  onPhotoToggle,
  photoModeActive = false,
  basemaps,
  activeBasemap,
  onBasemapChange,
  onFullscreenToggle,
  fullscreen = false,
}: MapControlsProps) {
  const isGlobe = projection === "globe";
  const toggleLabel = isGlobe ? "Switch to flat map" : "Switch to globe";
  const showBasemaps = Boolean(basemaps && basemaps.length > 1 && onBasemapChange);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuWrapperRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!menuWrapperRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  return (
    <div
      className={cn(
        // flex-wrap + justify-end is a safety net for ultra-narrow phones: any
        // overflow wraps to a second bottom-anchored row (growing upward) and
        // stays right-aligned, rather than spilling past the left map edge.
        "absolute z-20 flex flex-row flex-wrap justify-end gap-2 sm:flex-col sm:flex-nowrap",
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
      {onPhotoToggle ? (
        <button
          type="button"
          onClick={onPhotoToggle}
          aria-label={
            photoModeActive ? "Exit photo map" : "Show photos on the map"
          }
          title={photoModeActive ? "Exit photos" : "Photos"}
          aria-pressed={photoModeActive}
          className={cn(
            BUTTON_CLASS,
            photoModeActive &&
              "border-brand/60 bg-brand/20 text-foreground hover:bg-brand/30",
          )}
        >
          <ImageIcon className="size-5" />
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
      {showBasemaps ? (
        <div className="relative" ref={menuWrapperRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Change basemap style"
            title="Basemap style"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className={cn(
              BUTTON_CLASS,
              menuOpen &&
                "border-brand/60 bg-brand/20 text-foreground hover:bg-brand/30",
            )}
          >
            <Layers2Icon className="size-5" />
          </button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute bottom-full right-0 mb-2 min-w-40 overflow-hidden rounded-xl border border-white/10 bg-black/85 p-1 shadow-2xl backdrop-blur-md"
            >
              {basemaps!.map((option) => {
                const active = option.id === activeBasemap;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      onBasemapChange!(option.id);
                      setMenuOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-white/10",
                      active ? "text-foreground" : "text-foreground/70",
                    )}
                  >
                    {option.label}
                    {active ? (
                      <CheckIcon className="size-4 shrink-0 text-brand" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
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

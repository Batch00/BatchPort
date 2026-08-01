"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Globe2,
  ImageIcon,
  LandmarkIcon,
  LocateFixedIcon,
  NavigationIcon,
  Map as MapIcon,
  Maximize2Icon,
  Minimize2Icon,
  PlayIcon,
  RefreshCwIcon,
  SlidersHorizontalIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { ActionTip } from "@/components/ui/info-tip";

// The globe's floating control cluster, ranked by how often a control is
// actually reached for rather than by what kind of thing it is.
//
// VISIBLE BUTTONS are the frequent four: photo map, replay, recenter, and the
// settings popover. Recenter earns its place by sheer frequency (every stray
// drag or zoom on a globe ends in wanting the data back on screen), which is
// why it sits out here next to two modes rather than three clicks deep.
//
// THE POPOVER holds everything occasional, modes included: nearby and show
// attractions at the top, then the basemap swatches, projection, fullscreen,
// and refresh. Nearby and attractions are genuine modes, but they are entered
// once and lived in, so a permanent button spends resting-state room on a tap
// most sessions never make.
//
// Because two modes now live behind the popover, the trigger has to say so: it
// takes a brand tint and a small brand dot whenever a mode inside it is
// running, so the user is never in a mode with no visible signal. The dot is
// deliberately not a count; which mode it is belongs to the menu row, which
// reads as active too.
//
// That caps the resting cluster at four buttons on the fullest surface (the
// dashboard) and fewer wherever a mode is not wired: read-only surfaces drop
// attractions and nearby entirely, and the landing hero and the destination
// picker show settings alone.
//
// Layout: one bottom-right vertical column at every breakpoint. The search
// overlay hosts anchor to the top-right, so the two cannot collide by
// construction rather than by tuning: the cluster's height is bounded at four
// buttons (about 220px on phones including the bottom inset) and the search
// button occupies the top 56px, so any map at least ~280px tall keeps them
// apart. Every globe surface here is at least 300px tall, or fullscreen.

/** One selectable basemap style for the switcher swatches. */
export interface BasemapOption {
  id: string;
  label: string;
}

interface MapControlsProps {
  // --- Visible buttons ----------------------------------------------------
  /** When provided, shows a photos toggle that enters/exits photo map mode. */
  onPhotoToggle?: () => void;
  photoModeActive?: boolean;
  /** When provided, shows a replay button that starts timeline playback. */
  onReplay?: () => void;
  /** When provided, shows the recenter button that snaps back to the data. */
  onRecenter?: () => void;

  // --- Popover: occasional modes -----------------------------------------
  /** When provided, offers the "Show attractions" explore layer toggle. */
  onAttractionsToggle?: () => void;
  attractionsActive?: boolean;
  /** When provided, offers the Nearby toggle. Tapping it is what asks the
   * browser for location permission; nothing here prompts on its own. */
  onNearbyToggle?: () => void;
  nearbyActive?: boolean;

  // --- Popover: utilities -------------------------------------------------
  projection: "globe" | "mercator";
  onToggleProjection: () => void;
  /** When provided, offers a refresh action that re-fetches the map data. */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** When provided (two or more options), shows the basemap swatch row. */
  basemaps?: BasemapOption[];
  activeBasemap?: string;
  onBasemapChange?: (id: string) => void;
  /** When provided, offers an expand/collapse fullscreen action. */
  onFullscreenToggle?: () => void;
  fullscreen?: boolean;
}

// Touch-sized on phones, a little larger from sm up where the map is taller.
const BUTTON_CLASS =
  "flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-foreground/80 shadow-lg backdrop-blur-md transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 sm:size-11";

// Active mode: solid brand blue, so "this mode owns the map" is unmistakable
// next to the inert utility button.
const BUTTON_ACTIVE_CLASS =
  "border-brand bg-brand text-brand-foreground hover:bg-brand/90 hover:text-brand-foreground";

const ICON_CLASS = "size-[18px] sm:size-5";

const MENU_ITEM_CLASS =
  "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm text-foreground/80 transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-50";

// Swatch fills that read as the style they switch to, without shipping preview
// tiles. Unknown ids fall back to the dark treatment.
const SWATCH_FILLS: Record<string, string> = {
  dark: "linear-gradient(135deg, #16181d 0%, #0a0a0a 100%)",
  streets: "linear-gradient(135deg, #2b3340 0%, #12161d 100%)",
  satellite: "linear-gradient(135deg, #1d3b2a 0%, #10293f 100%)",
  terrain: "linear-gradient(135deg, #7f8a5c 0%, #4a5638 100%)",
};

/** Closes the popover on any pointerdown outside its wrapper element. */
function useDismissOnOutsidePointer(
  open: boolean,
  wrapperRef: React.RefObject<HTMLDivElement | null>,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
    // close and wrapperRef are stable per render usage here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

function ModeButton({
  label,
  active = false,
  icon,
  onClick,
}: {
  label: string;
  active?: boolean;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(BUTTON_CLASS, active && BUTTON_ACTIVE_CLASS)}
    >
      {icon}
    </button>
  );
}

export function MapControls({
  onPhotoToggle,
  photoModeActive = false,
  onReplay,
  onAttractionsToggle,
  attractionsActive = false,
  onNearbyToggle,
  nearbyActive = false,
  projection,
  onToggleProjection,
  onRecenter,
  onRefresh,
  refreshing = false,
  basemaps,
  activeBasemap,
  onBasemapChange,
  onFullscreenToggle,
  fullscreen = false,
}: MapControlsProps) {
  const isGlobe = projection === "globe";
  const projectionLabel = isGlobe ? "Switch to flat map" : "Switch to globe";
  const showBasemaps = Boolean(
    basemaps && basemaps.length > 1 && onBasemapChange,
  );

  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  useDismissOnOutsidePointer(settingsOpen, settingsRef, () =>
    setSettingsOpen(false),
  );

  // The occasional modes, at the top of the popover: entering one is a
  // deliberate act, and each row reads as active while its mode runs.
  const modes: {
    key: string;
    label: string;
    icon: ReactNode;
    active: boolean;
    onSelect: () => void;
  }[] = [];
  if (onNearbyToggle) {
    modes.push({
      key: "nearby",
      label: nearbyActive ? "Exit nearby" : "Show what is around you",
      icon: <NavigationIcon className="size-4" />,
      active: nearbyActive,
      onSelect: onNearbyToggle,
    });
  }
  if (onAttractionsToggle) {
    modes.push({
      key: "attractions",
      label: attractionsActive ? "Hide attractions" : "Show attractions",
      icon: <LandmarkIcon className="size-4" />,
      active: attractionsActive,
      onSelect: onAttractionsToggle,
    });
  }
  // A mode is running out of sight, so the trigger has to carry the signal.
  const modeActive = modes.some((mode) => mode.active);

  // Utility rows, in the order they appear under the basemap swatches.
  const utilities: {
    key: string;
    label: string;
    icon: ReactNode;
    onSelect: () => void;
    disabled?: boolean;
  }[] = [];
  utilities.push({
    key: "projection",
    label: projectionLabel,
    icon: isGlobe ? (
      <MapIcon className="size-4" />
    ) : (
      <Globe2 className="size-4" />
    ),
    onSelect: onToggleProjection,
  });
  if (onFullscreenToggle) {
    utilities.push({
      key: "fullscreen",
      label: fullscreen ? "Exit fullscreen" : "Fullscreen",
      icon: fullscreen ? (
        <Minimize2Icon className="size-4" />
      ) : (
        <Maximize2Icon className="size-4" />
      ),
      onSelect: onFullscreenToggle,
    });
  }
  if (onRefresh) {
    utilities.push({
      key: "refresh",
      label: refreshing ? "Refreshing" : "Refresh data",
      icon: (
        <RefreshCwIcon className={cn("size-4", refreshing && "animate-spin")} />
      ),
      onSelect: onRefresh,
      disabled: refreshing,
    });
  }

  return (
    <div
      className={cn(
        // Bottom-anchored on every surface, so the top-right search corner is
        // structurally out of reach.
        "absolute z-20 flex flex-col items-center gap-2",
        fullscreen
          ? "bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(0.75rem,env(safe-area-inset-right))] sm:bottom-[max(2rem,env(safe-area-inset-bottom))] sm:right-[max(1.25rem,env(safe-area-inset-right))]"
          : "bottom-4 right-4 sm:bottom-8 sm:right-5",
      )}
    >
      {onPhotoToggle ? (
        <ModeButton
          label={photoModeActive ? "Exit photo map" : "Show photos on the map"}
          active={photoModeActive}
          icon={<ImageIcon className={ICON_CLASS} />}
          onClick={onPhotoToggle}
        />
      ) : null}
      {onReplay ? (
        <ModeButton
          label="Replay your travel history"
          icon={<PlayIcon className={cn(ICON_CLASS, "translate-x-px")} />}
          onClick={onReplay}
        />
      ) : null}
      {onRecenter ? (
        <ModeButton
          label="Recenter on your travels"
          icon={<LocateFixedIcon className={ICON_CLASS} />}
          onClick={onRecenter}
        />
      ) : null}

      <div className="relative" ref={settingsRef}>
        <button
          type="button"
          onClick={() => setSettingsOpen((open) => !open)}
          // The label says what is running, so a screen reader gets the same
          // signal the dot gives everyone else.
          aria-label={
            modeActive ? "Map settings, a mode is on" : "Map settings"
          }
          title="Map settings"
          aria-haspopup="menu"
          aria-expanded={settingsOpen}
          className={cn(
            BUTTON_CLASS,
            "relative",
            settingsOpen && "bg-white/15 text-foreground",
            modeActive && "border-brand/70 bg-brand/15 text-foreground",
          )}
        >
          <SlidersHorizontalIcon className={ICON_CLASS} />
          {modeActive ? (
            <span
              aria-hidden
              className="absolute right-1 top-1 size-2 rounded-full bg-brand ring-2 ring-black/60"
            />
          ) : null}
        </button>
        {settingsOpen ? (
          <div
            role="menu"
            aria-label="Map settings"
            className="absolute bottom-full right-0 mb-2 w-56 overflow-hidden rounded-xl border border-white/10 bg-black/85 p-1.5 shadow-2xl backdrop-blur-md"
          >
            {modes.length > 0 ? (
              <>
                {modes.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={item.active}
                    onClick={() => {
                      setSettingsOpen(false);
                      item.onSelect();
                    }}
                    className={cn(
                      MENU_ITEM_CLASS,
                      item.active && "bg-brand/15 text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "shrink-0",
                        item.active ? "text-brand" : "text-foreground/50",
                      )}
                    >
                      {item.icon}
                    </span>
                    {item.label}
                    {item.active ? (
                      <span
                        aria-hidden
                        className="ml-auto size-1.5 shrink-0 rounded-full bg-brand"
                      />
                    ) : null}
                  </button>
                ))}
                <div className="my-1 h-px bg-white/10" />
              </>
            ) : null}

            {showBasemaps ? (
              <div className="px-1 pb-1.5 pt-1">
                <div className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-foreground/40">
                  Basemap
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {basemaps!.map((option) => {
                    const active = option.id === activeBasemap;
                    return (
                      // The visible label is truncated in this narrow grid
                      // cell, so the full name rides in the tip and in the
                      // aria-label (which touch users get instead of a tip).
                      <ActionTip key={option.id} tip={option.label}>
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={active}
                          aria-label={option.label}
                          onClick={() => {
                            onBasemapChange!(option.id);
                            setSettingsOpen(false);
                          }}
                          className="group flex flex-col items-center gap-1 focus-visible:outline-none"
                        >
                          <span
                            aria-hidden
                            style={{
                              backgroundImage:
                                SWATCH_FILLS[option.id] ?? SWATCH_FILLS.dark,
                            }}
                            className={cn(
                              "h-8 w-full rounded-md border transition-colors",
                              active
                                ? "border-brand ring-2 ring-brand/50"
                                : "border-white/15 group-hover:border-white/35 group-focus-visible:border-white/35",
                            )}
                          />
                          <span
                            className={cn(
                              "w-full truncate text-center text-[10px] leading-tight",
                              active ? "text-foreground" : "text-foreground/50",
                            )}
                          >
                            {option.label}
                          </span>
                        </button>
                      </ActionTip>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {showBasemaps ? <div className="my-1 h-px bg-white/10" /> : null}

            {utilities.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setSettingsOpen(false);
                  item.onSelect();
                }}
                className={MENU_ITEM_CLASS}
              >
                <span className="shrink-0 text-foreground/50">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

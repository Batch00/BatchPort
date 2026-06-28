"use client";

import { Globe2, LocateFixedIcon, Map as MapIcon } from "lucide-react";

interface MapControlsProps {
  projection: "globe" | "mercator";
  onToggle: () => void;
  // When provided, shows a recenter button that snaps back to the data bounds.
  onRecenter?: () => void;
}

const BUTTON_CLASS =
  "flex size-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-foreground/80 shadow-lg backdrop-blur-md transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60";

// Floating map controls: recenter (optional) stacked above the projection
// toggle. The toggle shows the icon of the projection you would switch to.
export function MapControls({
  projection,
  onToggle,
  onRecenter,
}: MapControlsProps) {
  const isGlobe = projection === "globe";
  const toggleLabel = isGlobe ? "Switch to flat map" : "Switch to globe";

  return (
    <div className="absolute right-4 bottom-10 z-20 flex flex-col gap-2">
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

"use client";

import { Globe2, Map as MapIcon } from "lucide-react";

interface ProjectionToggleProps {
  projection: "globe" | "mercator";
  onToggle: () => void;
}

// Floating control that swaps the map projection. It shows the icon of the
// projection you would switch to, so the action reads clearly.
export function ProjectionToggle({ projection, onToggle }: ProjectionToggleProps) {
  const isGlobe = projection === "globe";
  const label = isGlobe ? "Switch to flat map" : "Switch to globe";

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      className="absolute right-4 bottom-10 z-20 flex size-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-foreground/80 shadow-lg backdrop-blur-md transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
    >
      {isGlobe ? (
        <MapIcon className="size-5" />
      ) : (
        <Globe2 className="size-5" />
      )}
    </button>
  );
}

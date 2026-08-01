"use client";

import { useState } from "react";
import { SparklesIcon } from "lucide-react";

import { TripStory } from "@/components/trips/trip-story";
import { cn } from "@/lib/utils";
import type { StoryTrip } from "@/lib/story";

// The "Story" affordance. The overlay is only mounted once it has been opened,
// so a trip page that nobody asks for a story from pays nothing for it beyond
// the props it already had.

export function StoryLauncher({
  trip,
  className,
  label = "Story",
}: {
  trip: StoryTrip;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-white/20 bg-black/40 px-3 py-1.5 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-black/60",
          className,
        )}
      >
        <SparklesIcon className="size-4" />
        {label}
      </button>
      {open ? <TripStory trip={trip} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

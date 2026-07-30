import { TrophyIcon } from "lucide-react";

import { RatingDisplay } from "@/components/rating-display";
import type { TripHighlight } from "@/lib/superlatives";

// The best-rated experiences on this trip. Derived from rows the trip page
// already fetched, so it adds no query. Renders nothing when the trip has too
// few ratings to rank.
export function TripHighlights({
  highlights,
}: {
  highlights: TripHighlight[];
}) {
  if (highlights.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-foreground/40">
        <TrophyIcon className="size-3 text-brand/70" />
        Best of this trip
      </h2>
      <ol className="flex flex-col gap-1.5">
        {highlights.map((highlight) => (
          <li
            key={highlight.id}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-white/[0.02] px-3 py-2 ring-1 ring-foreground/[0.07]"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm text-foreground">
                {highlight.name}
              </span>
              <span className="block truncate text-xs text-foreground/45">
                {highlight.destinationName}
              </span>
            </span>
            <RatingDisplay rating={highlight.rating} size={12} />
          </li>
        ))}
      </ol>
    </section>
  );
}

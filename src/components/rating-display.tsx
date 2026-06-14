import { StarIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// Compact, read-only star display for lists and cards. Takes the smallint
// rating (1 to 10) and renders filled, half, and empty stars with the numeric
// value beside them (a rating of 8 shows "4.0").
interface RatingDisplayProps {
  rating: number;
  size?: number;
  showNumber?: boolean;
  className?: string;
}

const STAR_COUNT = 5;

export function RatingDisplay({
  rating,
  size = 14,
  showNumber = true,
  className,
}: RatingDisplayProps) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span className="inline-flex items-center gap-0.5">
        {Array.from({ length: STAR_COUNT }, (_, starIndex) => {
          const full = (starIndex + 1) * 2;
          const half = full - 1;
          const kind =
            rating >= full ? "full" : rating >= half ? "half" : "empty";
          return (
            <span
              key={starIndex}
              className="relative inline-block"
              style={{ width: size, height: size }}
            >
              <StarIcon
                className="absolute inset-0 size-full text-foreground/20"
                style={{ fill: "rgba(255,255,255,0.06)" }}
              />
              {kind !== "empty" ? (
                <span
                  className="absolute inset-0 overflow-hidden"
                  style={{ width: kind === "half" ? "50%" : "100%" }}
                >
                  <StarIcon
                    className="text-brand"
                    style={{ width: size, height: size, fill: "var(--brand)" }}
                  />
                </span>
              ) : null}
            </span>
          );
        })}
      </span>
      {showNumber ? (
        <span className="text-xs tabular-nums text-foreground/60">
          {(rating / 2).toFixed(1)}
        </span>
      ) : null}
    </span>
  );
}

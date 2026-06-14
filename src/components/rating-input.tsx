"use client";

import { useState } from "react";
import { StarIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// Interactive half-star rating. The database stores a smallint 1 to 10 where
// each step is half a star: 1 = half a star, 2 = one star, ..., 10 = five
// stars. Clicking the left half of a star picks the half value, the right half
// picks the full value.
interface RatingInputProps {
  value: number;
  onChange?: (value: number) => void;
  readOnly?: boolean;
  size?: number;
  className?: string;
}

const STAR_COUNT = 5;

function fillFor(displayValue: number, starIndex: number): "full" | "half" | "empty" {
  const full = (starIndex + 1) * 2;
  const half = full - 1;
  if (displayValue >= full) return "full";
  if (displayValue >= half) return "half";
  return "empty";
}

export function RatingInput({
  value,
  onChange,
  readOnly = false,
  size = 28,
  className,
}: RatingInputProps) {
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const displayValue = hoverValue ?? value;

  function select(next: number) {
    if (readOnly || !onChange) return;
    onChange(next);
  }

  return (
    <div
      className={cn("inline-flex items-center gap-1", className)}
      onMouseLeave={() => setHoverValue(null)}
      role="radiogroup"
      aria-label="Rating"
    >
      {Array.from({ length: STAR_COUNT }, (_, starIndex) => {
        const fill = fillFor(displayValue, starIndex);
        const halfValue = (starIndex + 1) * 2 - 1;
        const fullValue = (starIndex + 1) * 2;
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
            {fill !== "empty" ? (
              <span
                className="absolute inset-0 overflow-hidden"
                style={{ width: fill === "half" ? "50%" : "100%" }}
              >
                <StarIcon
                  className="text-brand"
                  style={{ width: size, height: size, fill: "var(--brand)" }}
                />
              </span>
            ) : null}

            {!readOnly ? (
              <>
                <button
                  type="button"
                  className="absolute inset-y-0 left-0 z-10 w-1/2 cursor-pointer"
                  aria-label={`Rate ${halfValue / 2} stars`}
                  onMouseEnter={() => setHoverValue(halfValue)}
                  onClick={() => select(halfValue)}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 z-10 w-1/2 cursor-pointer"
                  aria-label={`Rate ${fullValue / 2} stars`}
                  onMouseEnter={() => setHoverValue(fullValue)}
                  onClick={() => select(fullValue)}
                />
              </>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

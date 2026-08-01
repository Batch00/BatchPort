"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarHeartIcon } from "lucide-react";

import { Lightbox } from "@/components/photos/lightbox";
import { RatingDisplay } from "@/components/rating-display";
import type { OnThisDay } from "@/lib/on-this-day";

// A quiet strip of what today looked like in earlier years. It renders only
// when the server read found something, so there is no empty state to design:
// getOnThisDay returns null on a day with no matches and the dashboard omits
// the section entirely.

function yearsAgo(year: number): string {
  const gap = new Date().getFullYear() - year;
  if (gap <= 0) return String(year);
  return `${gap} ${gap === 1 ? "year" : "years"} ago`;
}

export function OnThisDaySection({ memories }: { memories: OnThisDay }) {
  const [index, setIndex] = useState<number | null>(null);
  const { photos, experiences } = memories;
  const open = index !== null ? photos[index] : null;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground/80">
          <CalendarHeartIcon className="size-4 text-foreground/40" />
          On this day
        </h2>
        <span className="text-xs text-foreground/40">{memories.label}</span>
      </div>

      {photos.length > 0 ? (
        <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {photos.map((photo, position) => (
            <li key={photo.id} className="shrink-0">
              <button
                type="button"
                onClick={() => setIndex(position)}
                className="group relative block size-24 overflow-hidden rounded-lg bg-white/5 ring-1 ring-foreground/10 transition-all hover:ring-brand/50 sm:size-28"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.thumbUrl}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover"
                />
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-1 pt-4 text-left text-[10px] text-white/85">
                  {yearsAgo(photo.year)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {experiences.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {experiences.map((experience) => {
            const body = (
              <>
                <span className="min-w-0 break-words text-foreground/85">
                  {experience.name}
                </span>
                <span className="shrink-0 text-foreground/40">
                  {yearsAgo(experience.year)}
                </span>
                {experience.rating !== null ? (
                  <RatingDisplay
                    rating={experience.rating}
                    size={11}
                    showNumber={false}
                  />
                ) : null}
              </>
            );
            const className =
              "inline-flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs transition-colors hover:bg-white/[0.07]";
            return (
              <li key={experience.id} className="min-w-0">
                {experience.href ? (
                  <Link href={experience.href} className={className}>
                    {body}
                  </Link>
                ) : (
                  <span className={className}>{body}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {open ? (
        <Lightbox
          item={{
            src: open.url,
            dateTaken: open.dateTaken,
            attribution: open.attribution,
            caption:
              [open.destinationName, open.tripName]
                .filter(Boolean)
                .join(" · ") || null,
          }}
          index={index as number}
          total={photos.length}
          onPrev={() =>
            setIndex((current) =>
              current === null
                ? null
                : (current - 1 + photos.length) % photos.length,
            )
          }
          onNext={() =>
            setIndex((current) =>
              current === null ? null : (current + 1) % photos.length,
            )
          }
          onClose={() => setIndex(null)}
          actions={
            open.href ? (
              <Link
                href={open.href}
                className="rounded-full bg-white/10 px-3 py-1.5 text-xs text-white transition-colors hover:bg-white/20"
              >
                View in {open.destinationName ?? "trip"}
              </Link>
            ) : undefined
          }
        />
      ) : null}
    </section>
  );
}

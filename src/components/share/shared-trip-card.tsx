"use client";

import { useState } from "react";
import { ChevronDownIcon, ImageIcon, MapPinIcon } from "lucide-react";

import { StatusBadge } from "@/components/trips/status-badge";
import { RatingDisplay } from "@/components/rating-display";
import { CategoryIcon } from "@/components/category-icon";
import { COVER_CARD_ASPECT, coverImageStyle } from "@/lib/photos";
import {
  daysUntil,
  durationDays,
  flagEmoji,
  formatDateRange,
  formatDuration,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TripStatus } from "@/lib/types";
import type { ProfileTrip } from "@/lib/share-data";

// A read-only trip card that expands inline to reveal its destinations and
// experiences. No links into the app (those routes are protected); this is a
// self-contained showcase.
export function SharedTripCard({ trip }: { trip: ProfileTrip }) {
  const [expanded, setExpanded] = useState(false);
  const destinationCount = trip.destinations.length;
  const days = durationDays(trip.start_date, trip.end_date);
  // Small anticipation cue on upcoming planned trips.
  const countdown =
    trip.status === "planned" ? daysUntil(trip.start_date) : null;

  return (
    <div className="isolate overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        className={cn(
          "group relative block w-full text-left",
          COVER_CARD_ASPECT,
        )}
      >
        {trip.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={trip.coverUrl}
            alt=""
            loading="lazy"
            style={coverImageStyle(trip.cover_position)}
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-white/[0.08] to-transparent" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/10" />
        <div className="relative flex h-full flex-col justify-end p-4">
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 break-words text-lg font-semibold tracking-tight text-white">
              {trip.name}
            </h3>
            <span className="mt-0.5 shrink-0">
              <StatusBadge status={trip.status as TripStatus} />
            </span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <p className="text-sm text-white/70">
              {formatDateRange(trip.start_date, trip.end_date)}
              {days ? (
                <span className="text-white/50"> · {formatDuration(days)}</span>
              ) : null}
              {countdown ? (
                <span className="font-medium text-brand">
                  {" "}
                  · in {formatDuration(countdown)}
                </span>
              ) : null}
            </p>
            <span className="flex items-center gap-1 text-xs text-white/60">
              {destinationCount}{" "}
              {destinationCount === 1 ? "stop" : "stops"}
              <ChevronDownIcon
                className={cn(
                  "size-4 transition-transform",
                  expanded && "rotate-180",
                )}
              />
            </span>
          </div>
        </div>
      </button>

      {expanded ? (
        <div className="flex flex-col gap-3 border-t border-white/10 p-4">
          {destinationCount === 0 ? (
            <p className="text-sm text-foreground/50">
              No destinations on this trip.
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {trip.destinations.map((destination, index) => (
                <li
                  key={destination.id}
                  className="flex gap-3 rounded-lg bg-white/[0.02] p-3 ring-1 ring-foreground/10"
                >
                  <div className="relative isolate h-16 w-20 shrink-0 overflow-hidden rounded-md bg-white/5">
                    {destination.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={destination.coverUrl}
                        alt=""
                        loading="lazy"
                        style={coverImageStyle(destination.cover_position)}
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center text-foreground/25">
                        <ImageIcon className="size-5" />
                      </div>
                    )}
                    <span className="absolute left-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-[0.65rem] text-white">
                      {index + 1}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <h4 className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-medium text-foreground">
                      <span className="min-w-0 break-words">
                        {destination.name}
                      </span>
                      {destination.country_code ? (
                        <span className="shrink-0 text-sm text-foreground/50">
                          {flagEmoji(destination.country_code)}{" "}
                          {destination.country_code}
                        </span>
                      ) : null}
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      {formatDateRange(
                        destination.arrival_date,
                        destination.departure_date,
                      )}
                    </p>

                    {destination.experiences.length > 0 ? (
                      <ul className="mt-2 flex flex-col gap-1.5">
                        {destination.experiences.map((experience) => (
                          <li
                            key={experience.id}
                            className="flex items-center gap-2 text-sm"
                          >
                            <span
                              className="flex size-5 shrink-0 items-center justify-center rounded bg-white/5"
                              style={
                                experience.category?.color
                                  ? { color: experience.category.color }
                                  : undefined
                              }
                            >
                              <CategoryIcon
                                icon={experience.category?.icon}
                                className="size-3"
                              />
                            </span>
                            <span className="min-w-0 flex-1 break-words text-foreground/85">
                              {experience.name}
                            </span>
                            {experience.rating ? (
                              <RatingDisplay
                                rating={experience.rating}
                                size={12}
                              />
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 flex items-center gap-1 text-xs text-foreground/40">
                        <MapPinIcon className="size-3" />
                        No experiences logged
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useState } from "react";
import { ChevronDownIcon, ImageIcon, MapPinIcon } from "lucide-react";

import { StatusBadge } from "@/components/trips/status-badge";
import { RatingDisplay } from "@/components/rating-display";
import { CategoryIcon } from "@/components/category-icon";
import { PlannedExperienceRowReadOnly } from "@/components/experiences/planned-checklist";
import { StoryLauncher } from "@/components/trips/story-launcher";
import { TransportLegReadOnly } from "@/components/trips/transport-leg";
import { hasStory, storyTripFromProfile } from "@/lib/story";
import { COVER_CARD_ASPECT, coverImageStyle } from "@/lib/photos";
import { groupByPlanDay, planDayCount, planDayLabel } from "@/lib/day-plan";
import { CountryFlag } from "@/components/country-flag";
import { VisitWeatherLine } from "@/components/weather/visit-weather";
import {
  daysUntil,
  durationDays,
  formatDateRange,
  formatDuration,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TripStatus } from "@/lib/types";
import type { ProfileDestination, ProfileTrip } from "@/lib/share-data";

// Read-only planned ideas for one destination. On a dated stay with any
// day-assigned idea, the list groups under "Day N · date" headers (matching
// the owner's planning workspace); otherwise it stays a flat checklist.
function ReadOnlyPlannedList({
  destination,
}: {
  destination: ProfileDestination;
}) {
  const planned = destination.experiences.filter(
    (experience) => experience.status === "planned",
  );
  if (planned.length === 0) return null;

  const dayCount = planDayCount(
    destination.arrival_date,
    destination.departure_date,
  );
  const anyAssigned = planned.some(
    (experience) => experience.planned_day !== null,
  );

  const row = (experience: ProfileDestination["experiences"][number]) => (
    <PlannedExperienceRowReadOnly
      key={experience.id}
      name={experience.name}
      categoryLabel={experience.category?.label}
      categoryIcon={experience.category?.icon}
      categoryColor={experience.category?.color}
    />
  );

  if (!dayCount || !destination.arrival_date || !anyAssigned) {
    return <ul className="mt-2 flex flex-col gap-1.5">{planned.map(row)}</ul>;
  }

  const groups = groupByPlanDay(
    planned,
    (experience) => experience.planned_day,
    dayCount,
  );
  const arrival = destination.arrival_date;
  return (
    <div className="mt-2 flex flex-col gap-2">
      {groups.map((items, day) => {
        if (items.length === 0) return null;
        return (
          <div key={day}>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-foreground/35">
              {day === 0 ? "Unassigned" : `Day ${day} · ${planDayLabel(arrival, day)}`}
            </p>
            <ul className="flex flex-col gap-1.5">{items.map(row)}</ul>
          </div>
        );
      })}
    </div>
  );
}

// A read-only trip card that expands inline to reveal its destinations and
// experiences. No links into the app (those routes are protected); this is a
// self-contained showcase.
export function SharedTripCard({ trip }: { trip: ProfileTrip }) {
  const [expanded, setExpanded] = useState(false);
  const destinationCount = trip.destinations.length;
  // A leg belongs to the stop it arrives at, so the list is keyed by that id.
  const legByDestination = new Map(
    trip.transport.map((leg) => [leg.destination_id, leg]),
  );
  const days = durationDays(trip.start_date, trip.end_date);
  // Small anticipation cue on upcoming planned trips.
  const countdown =
    trip.status === "planned" ? daysUntil(trip.start_date) : null;

  return (
    <div className="relative isolate overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      {/* Outside the expand button, not inside it: a button cannot nest. The
          story is read-only, so it belongs on the public surfaces too. */}
      {hasStory(trip) ? (
        <StoryLauncher
          trip={storyTripFromProfile(trip)}
          className="absolute right-3 top-3 z-10 px-2.5 py-1 text-xs"
        />
      ) : null}
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
                <li key={destination.id}>
                  {/* Read-only: an unrecorded leg renders nothing here. */}
                  <TransportLegReadOnly
                    leg={legByDestination.get(destination.id) ?? null}
                    isFirst={index === 0}
                  />
                  <div className="flex gap-3 rounded-lg bg-white/[0.02] p-3 ring-1 ring-foreground/10">
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
                          <CountryFlag
                            code={destination.country_code}
                            className="h-3"
                          />{" "}
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
                    {/* Observed weather is public reference data keyed by
                        coordinates and past dates, so the read-only surfaces
                        show it too. Planned trips have nothing to observe. */}
                    {trip.status !== "planned" ? (
                      <VisitWeatherLine
                        lat={destination.latitude}
                        lng={destination.longitude}
                        start={destination.arrival_date}
                        end={destination.departure_date}
                        className="mt-1"
                      />
                    ) : null}

                    {destination.experiences.length > 0 ? (
                      <>
                        {destination.experiences.some(
                          (e) => e.status !== "planned",
                        ) ? (
                          <ul className="mt-2 flex flex-col gap-1.5">
                            {destination.experiences
                              .filter((e) => e.status !== "planned")
                              .map((experience) => (
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
                        ) : null}
                        <ReadOnlyPlannedList destination={destination} />
                      </>
                    ) : (
                      <p className="mt-2 flex items-center gap-1 text-xs text-foreground/40">
                        <MapPinIcon className="size-3" />
                        No experiences logged
                      </p>
                    )}
                  </div>
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

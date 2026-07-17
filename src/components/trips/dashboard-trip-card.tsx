"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  CameraIcon,
  ChevronDownIcon,
  ImageIcon,
  Loader2Icon,
  MapPinIcon,
  MoreVerticalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/trips/status-badge";
import { RatingDisplay } from "@/components/rating-display";
import { CategoryIcon } from "@/components/category-icon";
import { TripCoverEditor } from "@/components/trips/trip-cover-editor";
import { deleteTripAction } from "@/lib/actions/trips";
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

// The authenticated dashboard trip card. Visually identical to the demo/share
// card (panoramic cover, overlaid title, expandable destination list) but with
// cover-edit and edit/delete controls in the top corner and destinations that
// link into the app. Clicking the cover opens the trip; the stops chevron
// expands the inline destination list without navigating.
export function DashboardTripCard({ trip }: { trip: ProfileTrip }) {
  const [expanded, setExpanded] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [coverEditorOpen, setCoverEditorOpen] = useState(false);
  const destinationCount = trip.destinations.length;
  const days = durationDays(trip.start_date, trip.end_date);
  // Small anticipation cue on upcoming planned trips.
  const countdown =
    trip.status === "planned" ? daysUntil(trip.start_date) : null;

  async function handleDelete() {
    setDeleting(true);
    const result = await deleteTripAction(trip.id);
    // A successful delete revalidates and redirects; only errors return.
    if (result && "error" in result) {
      toast.error(result.error);
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  return (
    <div className="relative isolate overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 transition-all hover:ring-brand/40">
      <div className={cn("group relative w-full", COVER_CARD_ASPECT)}>
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

        {/* The whole cover is a link to the trip. The overlaid text is
            click-through; only the stops chevron re-enables pointer events so
            it can expand the card in place instead of navigating. */}
        <Link
          href={`/trips/${trip.id}`}
          aria-label={`Open ${trip.name}`}
          className="absolute inset-0"
        />
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-end p-4 pr-12">
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
            <button
              type="button"
              onClick={() => setExpanded((open) => !open)}
              aria-expanded={expanded}
              aria-label={
                expanded ? "Hide destinations" : "Show destinations"
              }
              className="pointer-events-auto -my-1 -mr-1.5 flex items-center gap-1 rounded-md px-1.5 py-2 text-xs text-white/60 transition-colors hover:bg-white/15 hover:text-white"
            >
              {destinationCount} {destinationCount === 1 ? "stop" : "stops"}
              <ChevronDownIcon
                className={cn(
                  "size-4 transition-transform",
                  expanded && "rotate-180",
                )}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Cover edit and menu controls, above the cover link. */}
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
        <button
          type="button"
          aria-label="Edit cover photo"
          onClick={() => setCoverEditorOpen(true)}
          className="flex size-9 items-center justify-center rounded-md bg-black/45 text-white backdrop-blur transition-colors hover:bg-black/65 sm:size-8"
        >
          <CameraIcon className="size-4" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Trip options"
              className="flex size-9 items-center justify-center rounded-md bg-black/45 text-white backdrop-blur transition-colors hover:bg-black/65 data-[state=open]:bg-black/65 sm:size-8"
            >
              <MoreVerticalIcon className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/trips/${trip.id}/edit`}>
                <PencilIcon />
                Edit
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setDeleteOpen(true)}
            >
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {expanded ? (
        <div className="flex flex-col gap-3 border-t border-white/10 p-4">
          {destinationCount === 0 ? (
            <Link
              href={`/trips/${trip.id}/destinations/new`}
              className="rounded-lg border border-dashed border-white/10 px-4 py-6 text-center text-sm text-foreground/60 transition-colors hover:border-white/20 hover:text-foreground"
            >
              No destinations yet. Add your first stop.
            </Link>
          ) : (
            <ol className="flex flex-col gap-3">
              {trip.destinations.map((destination, index) => (
                <li key={destination.id}>
                  <Link
                    href={`/trips/${trip.id}/destinations/${destination.id}`}
                    className="group flex gap-3 rounded-lg bg-white/[0.02] p-3 ring-1 ring-foreground/10 transition-colors hover:ring-brand/40"
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
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}

      {coverEditorOpen ? (
        <TripCoverEditor
          tripId={trip.id}
          tripName={trip.name}
          coverPhotoId={trip.cover_photo_id}
          coverPosition={trip.cover_position}
          destinationIds={trip.destinations.map((d) => d.id)}
          experienceIds={trip.destinations.flatMap((d) =>
            d.experiences.map((e) => e.id),
          )}
          onClose={() => setCoverEditorOpen(false)}
        />
      ) : null}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this trip?</AlertDialogTitle>
            <AlertDialogDescription>
              {trip.name} and all of its destinations and experiences will be
              permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                handleDelete();
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckIcon,
  ChevronDownIcon,
  Loader2Icon,
  Trash2Icon,
} from "lucide-react";

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
import { RatingDisplay } from "@/components/rating-display";
import { PlannedExperienceRow } from "@/components/experiences/planned-checklist";
import { IdeasStrip } from "@/components/trips/ideas-strip";
import { deleteExperienceAction } from "@/lib/actions/experiences";
import { cn } from "@/lib/utils";
import type { Category, Experience, TripStatus } from "@/lib/types";

// The planning workspace block rendered under each destination card on the
// trip detail page. Planned and ongoing trips get the full treatment: the
// planned checklist, any pre-logged done experiences, and the lazy Ideas
// strip. Completed trips only surface planned leftovers ("Didn't get to"),
// collapsed by default, where each can still be checked off late or deleted
// (or simply kept as a memento by leaving it alone).

interface PlanDestination {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  country_code: string | null;
}

function categoryOf(
  experience: Experience,
  categories: Category[],
): Category | undefined {
  return experience.category_id
    ? categories.find((category) => category.id === experience.category_id)
    : undefined;
}

function LeftoverDeleteButton({
  tripId,
  destinationId,
  experience,
  onDeleted,
}: {
  tripId: string;
  destinationId: string;
  experience: Experience;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    const result = await deleteExperienceAction(
      tripId,
      destinationId,
      experience.id,
    );
    setDeleting(false);
    setOpen(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    onDeleted();
  }

  return (
    <>
      <button
        type="button"
        aria-label={`Delete ${experience.name}`}
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-md p-1.5 text-foreground/35 transition-colors hover:bg-white/5 hover:text-foreground"
      >
        <Trash2Icon className="size-3.5" />
      </button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this idea?</AlertDialogTitle>
            <AlertDialogDescription>
              {experience.name} will be permanently deleted. This cannot be
              undone.
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
    </>
  );
}

export function DestinationPlan({
  tripId,
  tripStatus,
  destination,
  countryName,
  experiences,
  categories,
  isDemo,
}: {
  tripId: string;
  tripStatus: TripStatus;
  destination: PlanDestination;
  countryName: string | null;
  experiences: Experience[];
  categories: Category[];
  isDemo: boolean;
}) {
  const router = useRouter();
  const planned = experiences.filter((e) => e.status === "planned");
  const done = experiences.filter((e) => e.status !== "planned");
  const planning = tripStatus === "planned" || tripStatus === "ongoing";
  // Leftovers on completed trips are a quiet afterword, collapsed by default.
  const [leftoversOpen, setLeftoversOpen] = useState(false);

  if (!planning && planned.length === 0) return null;

  const refresh = () => router.refresh();

  const plannedRows = (withDelete: boolean) => (
    <ul className="flex flex-col gap-1.5">
      {planned.map((experience) => {
        const category = categoryOf(experience, categories);
        return (
          <PlannedExperienceRow
            key={experience.id}
            experience={{
              id: experience.id,
              name: experience.name,
              notes: experience.notes,
              categoryLabel: category?.label,
              categoryIcon: category?.icon,
              categoryColor: category?.color,
            }}
            disabled={isDemo}
            onChanged={refresh}
            menu={
              withDelete && !isDemo ? (
                <LeftoverDeleteButton
                  tripId={tripId}
                  destinationId={destination.id}
                  experience={experience}
                  onDeleted={refresh}
                />
              ) : undefined
            }
          />
        );
      })}
    </ul>
  );

  if (!planning) {
    return (
      <div className="mt-1.5 rounded-xl bg-white/[0.015] px-3 py-2 ring-1 ring-foreground/5">
        <button
          type="button"
          onClick={() => setLeftoversOpen((open) => !open)}
          aria-expanded={leftoversOpen}
          className="flex w-full items-center justify-between text-left text-xs text-foreground/45 transition-colors hover:text-foreground/70"
        >
          <span>
            Didn&apos;t get to ({planned.length})
          </span>
          <ChevronDownIcon
            className={cn(
              "size-3.5 transition-transform",
              leftoversOpen && "rotate-180",
            )}
          />
        </button>
        {leftoversOpen ? (
          <div className="mt-2">
            {plannedRows(true)}
            <p className="mt-1.5 text-[10px] text-foreground/30">
              Check one off if you got to it after all, delete it, or keep it
              as a memento.
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-1.5 flex flex-col gap-3 rounded-xl bg-white/[0.02] p-3 ring-1 ring-foreground/10">
      <div>
        <h4 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-foreground/40">
          Planned{planned.length > 0 ? ` (${planned.length})` : ""}
        </h4>
        {planned.length > 0 ? (
          plannedRows(false)
        ) : (
          <p className="text-xs text-foreground/40">
            No ideas saved yet. Grab some from the suggestions below.
          </p>
        )}
      </div>

      {done.length > 0 ? (
        <div>
          <h4 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-foreground/40">
            Done ({done.length})
          </h4>
          <ul className="flex flex-col gap-1">
            {done.map((experience) => (
              <li
                key={experience.id}
                className="flex items-center gap-2 px-1 text-sm"
              >
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand">
                  <CheckIcon className="size-3" />
                </span>
                <span className="min-w-0 flex-1 break-words text-foreground/85">
                  {experience.name}
                </span>
                {experience.rating ? (
                  <RatingDisplay rating={experience.rating} size={12} />
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <IdeasStrip
        destinationId={destination.id}
        destinationName={destination.name}
        lat={destination.lat}
        lng={destination.lng}
        countryCode={destination.country_code}
        countryName={countryName}
        existingNames={experiences.map((experience) => experience.name)}
        isDemo={isDemo}
      />
    </div>
  );
}

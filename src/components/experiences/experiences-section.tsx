"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ImageIcon,
  Loader2Icon,
  MoreVerticalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UndoIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ExperienceDialog } from "@/components/experiences/experience-dialog";
import { PlannedExperienceRow } from "@/components/experiences/planned-checklist";
import { PhotoUpload } from "@/components/photos/photo-upload";
import { PhotoGallery } from "@/components/photos/photo-gallery";
import { RatingDisplay } from "@/components/rating-display";
import { CategoryIcon } from "@/components/category-icon";
import {
  deleteExperienceAction,
  markExperiencePlannedAction,
} from "@/lib/actions/experiences";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  Category,
  Experience,
  Photo,
  TripStatus,
} from "@/lib/types";

interface ExperiencesSectionProps {
  tripId: string;
  // The owning trip's status decides whether new experiences default to
  // planned ideas (planned and ongoing trips) or done logs (completed).
  tripStatus: TripStatus;
  destinationId: string;
  experiences: Experience[];
  categories: Category[];
  userId: string;
  isDemo: boolean;
  photosByExperience: Record<string, Photo[]>;
  // The destination center, passed to the dialog's POI search bias.
  destLat: number | null;
  destLng: number | null;
}

export function ExperiencesSection({
  tripId,
  tripStatus,
  destinationId,
  experiences,
  categories,
  userId,
  isDemo,
  photosByExperience,
  destLat,
  destLng,
}: ExperiencesSectionProps) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Experience | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Experience | null>(null);
  const [markingPlanned, setMarkingPlanned] = useState<Experience | null>(null);

  const categoriesById: Record<string, Category> = Object.fromEntries(
    categories.map((category) => [category.id, category]),
  );

  const planned = experiences.filter((e) => e.status === "planned");
  const done = experiences.filter((e) => e.status !== "planned");
  const planning = tripStatus === "planned" || tripStatus === "ongoing";

  function openAdd() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(experience: Experience) {
    setEditing(experience);
    setDialogOpen(true);
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground/80">Experiences</h2>
        <Button
          size="sm"
          onClick={openAdd}
          className="bg-brand text-brand-foreground hover:bg-brand/90"
        >
          <PlusIcon />
          Add experience
        </Button>
      </div>

      {experiences.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 px-6 py-12 text-center text-sm text-foreground/60">
          {planning
            ? "Nothing planned yet. Save ideas for what to do here."
            : "No experiences logged yet. Add what you did here."}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {planned.length > 0 ? (
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground/45">
                {planning ? "Planned" : "Didn't get to"} ({planned.length})
              </h3>
              <ul className="flex flex-col gap-1.5">
                {planned.map((experience) => {
                  const category = experience.category_id
                    ? categoriesById[experience.category_id]
                    : undefined;
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
                      onChanged={() => router.refresh()}
                      menu={
                        <ExperienceMenu
                          onEdit={() => openEdit(experience)}
                          onDelete={() => setDeleting(experience)}
                        />
                      }
                    />
                  );
                })}
              </ul>
            </div>
          ) : null}

          {done.length > 0 ? (
            <div>
              {planned.length > 0 ? (
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground/45">
                  Done ({done.length})
                </h3>
              ) : null}
              <ul className="flex flex-col gap-2">
                {done.map((experience) => {
                  const category = experience.category_id
                    ? categoriesById[experience.category_id]
                    : undefined;
                  const expPhotos = photosByExperience[experience.id] ?? [];
                  const expanded = expandedId === experience.id;
                  return (
                    <li
                      key={experience.id}
                      className="overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10"
                    >
                      <div className="flex items-center gap-3 px-3 py-2.5">
                        <span
                          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-white/5"
                          style={
                            category?.color
                              ? { color: category.color }
                              : undefined
                          }
                        >
                          <CategoryIcon
                            icon={category?.icon}
                            className="size-4"
                          />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="break-words font-medium text-foreground">
                            {experience.name}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                            {category ? <span>{category.label}</span> : null}
                            {experience.visited_date ? (
                              <span>
                                {formatDate(experience.visited_date)}
                              </span>
                            ) : null}
                            {experience.rating ? (
                              // Compact rating for narrow screens, where the
                              // full star row would crowd the name out.
                              <span className="text-brand sm:hidden">
                                {"★"} {(experience.rating / 2).toFixed(1)}
                              </span>
                            ) : null}
                          </div>
                          {experience.notes ? (
                            <p className="mt-1 whitespace-pre-line break-words text-xs text-foreground/60">
                              {experience.notes}
                            </p>
                          ) : null}
                        </div>
                        {experience.rating ? (
                          <RatingDisplay
                            rating={experience.rating}
                            className="hidden sm:inline-flex"
                          />
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Photos"
                          aria-expanded={expanded}
                          onClick={() =>
                            setExpandedId((current) =>
                              current === experience.id
                                ? null
                                : experience.id,
                            )
                          }
                          className={cn(
                            "h-9 sm:h-7",
                            expanded && "bg-white/5 text-foreground",
                          )}
                        >
                          <ImageIcon />
                          {expPhotos.length > 0 ? (
                            <span className="text-xs tabular-nums">
                              {expPhotos.length}
                            </span>
                          ) : null}
                        </Button>
                        <ExperienceMenu
                          onEdit={() => openEdit(experience)}
                          onMarkPlanned={() => setMarkingPlanned(experience)}
                          onDelete={() => setDeleting(experience)}
                        />
                      </div>

                      {expanded ? (
                        <div className="flex flex-col gap-3 border-t border-white/10 p-3">
                          <PhotoUpload
                            ownerType="experience"
                            ownerId={experience.id}
                            userId={userId}
                            isDemo={isDemo}
                            onUploaded={() => router.refresh()}
                          />
                          {expPhotos.length > 0 ? (
                            <PhotoGallery
                              photos={expPhotos}
                              compact
                              editable
                              allowSetCover={false}
                              ownerType="experience"
                              ownerId={experience.id}
                              isDemo={isDemo}
                              onChanged={() => router.refresh()}
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      <ExperienceDialog
        tripId={tripId}
        destinationId={destinationId}
        categories={categories}
        experience={editing}
        defaultStatus={planning ? "planned" : "done"}
        destLat={destLat}
        destLng={destLng}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={() => router.refresh()}
      />

      <DeleteExperienceDialog
        tripId={tripId}
        destinationId={destinationId}
        experience={deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onDeleted={() => router.refresh()}
      />

      <MarkPlannedDialog
        experience={markingPlanned}
        onOpenChange={(open) => {
          if (!open) setMarkingPlanned(null);
        }}
        onDone={() => router.refresh()}
      />
    </section>
  );
}

// The per-row overflow menu: edit and delete everywhere, plus "Mark as
// planned" on done rows (the checkoff undo).
function ExperienceMenu({
  onEdit,
  onMarkPlanned,
  onDelete,
}: {
  onEdit: () => void;
  onMarkPlanned?: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Experience options"
          className="size-9 shrink-0 sm:size-7"
        >
          <MoreVerticalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>
          <PencilIcon />
          Edit
        </DropdownMenuItem>
        {onMarkPlanned ? (
          <DropdownMenuItem onSelect={onMarkPlanned}>
            <UndoIcon />
            Mark as planned
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2Icon />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DeleteExperienceDialog({
  tripId,
  destinationId,
  experience,
  onOpenChange,
  onDeleted,
}: {
  tripId: string;
  destinationId: string;
  experience: Experience | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!experience) return;
    setBusy(true);
    const result = await deleteExperienceAction(
      tripId,
      destinationId,
      experience.id,
    );
    setBusy(false);
    onOpenChange(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    onDeleted();
  }

  return (
    <AlertDialog open={experience !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this experience?</AlertDialogTitle>
          <AlertDialogDescription>
            {experience?.name} will be permanently deleted. This cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              handleDelete();
            }}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {busy ? <Loader2Icon className="size-4 animate-spin" /> : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Undoing a checkoff clears the rating and visited date, so it confirms first.
function MarkPlannedDialog({
  experience,
  onOpenChange,
  onDone,
}: {
  experience: Experience | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    if (!experience) return;
    setBusy(true);
    const result = await markExperiencePlannedAction(experience.id);
    setBusy(false);
    onOpenChange(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    onDone();
  }

  return (
    <AlertDialog open={experience !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Move back to planned?</AlertDialogTitle>
          <AlertDialogDescription>
            {experience?.name} will go back on the checklist. Its rating and
            visited date will be cleared.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              handleConfirm();
            }}
            className="bg-brand text-brand-foreground hover:bg-brand/90"
          >
            {busy ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              "Mark as planned"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

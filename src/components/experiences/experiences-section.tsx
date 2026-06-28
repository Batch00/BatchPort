"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ImageIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ExperienceDialog } from "@/components/experiences/experience-dialog";
import { PhotoUpload } from "@/components/photos/photo-upload";
import { PhotoGallery } from "@/components/photos/photo-gallery";
import { RatingDisplay } from "@/components/rating-display";
import { CategoryIcon } from "@/components/category-icon";
import { deleteExperienceAction } from "@/lib/actions/experiences";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Category, Experience, Photo } from "@/lib/types";

interface ExperiencesSectionProps {
  tripId: string;
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

  const categoriesById: Record<string, Category> = Object.fromEntries(
    categories.map((category) => [category.id, category]),
  );

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
          No experiences logged yet. Add what you did here.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {experiences.map((experience) => {
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
                      category?.color ? { color: category.color } : undefined
                    }
                  >
                    <CategoryIcon icon={category?.icon} className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="break-words font-medium text-foreground">
                      {experience.name}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {category ? <span>{category.label}</span> : null}
                      {experience.visited_date ? (
                        <span>{formatDate(experience.visited_date)}</span>
                      ) : null}
                    </div>
                  </div>
                  {experience.rating ? (
                    <RatingDisplay rating={experience.rating} />
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Photos"
                    aria-expanded={expanded}
                    onClick={() =>
                      setExpandedId((current) =>
                        current === experience.id ? null : experience.id,
                      )
                    }
                    className={cn(expanded && "bg-white/5 text-foreground")}
                  >
                    <ImageIcon />
                    {expPhotos.length > 0 ? (
                      <span className="text-xs tabular-nums">
                        {expPhotos.length}
                      </span>
                    ) : null}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Edit experience"
                    onClick={() => openEdit(experience)}
                  >
                    <PencilIcon />
                  </Button>
                  <DeleteExperienceButton
                    tripId={tripId}
                    destinationId={destinationId}
                    experienceId={experience.id}
                    experienceName={experience.name}
                    onDeleted={() => router.refresh()}
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
                        onChanged={() => router.refresh()}
                      />
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <ExperienceDialog
        tripId={tripId}
        destinationId={destinationId}
        categories={categories}
        experience={editing}
        destLat={destLat}
        destLng={destLng}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={() => router.refresh()}
      />
    </section>
  );
}

function DeleteExperienceButton({
  tripId,
  destinationId,
  experienceId,
  experienceName,
  onDeleted,
}: {
  tripId: string;
  destinationId: string;
  experienceId: string;
  experienceName: string;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    const result = await deleteExperienceAction(
      tripId,
      destinationId,
      experienceId,
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
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Delete experience">
          <Trash2Icon />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this experience?</AlertDialogTitle>
          <AlertDialogDescription>
            {experienceName} will be permanently deleted. This cannot be undone.
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
            {deleting ? <Loader2Icon className="size-4 animate-spin" /> : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

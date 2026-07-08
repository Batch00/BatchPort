"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2Icon, StarIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SafeImage } from "@/components/photos/safe-image";
import { CoverPositionDialog } from "@/components/photos/cover-position-dialog";
import { setCoverPhoto } from "@/lib/actions/photos";
import { fetchTripGalleryPhotos, getPhotoUrl } from "@/lib/photos";
import { cn } from "@/lib/utils";
import type { CoverPosition, Photo } from "@/lib/types";

interface TripCoverEditorProps {
  tripId: string;
  tripName: string;
  coverPhotoId: string | null;
  coverPosition: CoverPosition | null;
  destinationIds: string[];
  experienceIds: string[];
  onClose: () => void;
}

// Change or reposition a trip's cover photo without leaving the dashboard.
// Photos are fetched lazily when the dialog opens (every photo attached to the
// trip at any level), a click opens the shared crop/zoom dialog, and the save
// goes through the same setCoverPhoto action used everywhere else.
export function TripCoverEditor({
  tripId,
  tripName,
  coverPhotoId,
  coverPosition,
  destinationIds,
  experienceIds,
  onClose,
}: TripCoverEditorProps) {
  const router = useRouter();
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [positionPhoto, setPositionPhoto] = useState<Photo | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    fetchTripGalleryPhotos(tripId, destinationIds, experienceIds)
      .then((result) => {
        if (active) setPhotos(result);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
    // The id lists are stable for the lifetime of the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  async function confirmCover(photo: Photo, position: CoverPosition) {
    setSaving(true);
    const result = await setCoverPhoto("trip", tripId, photo.id, position);
    setSaving(false);
    setPositionPhoto(null);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success("Cover photo updated.");
    router.refresh();
    onClose();
  }

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !saving) onClose();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Cover photo for {tripName}</DialogTitle>
            <DialogDescription>
              Pick a photo to use as the cover, or choose the current one to
              adjust its position.
            </DialogDescription>
          </DialogHeader>

          {loadError ? (
            <p className="py-6 text-center text-sm text-foreground/50">
              Could not load this trip&apos;s photos. Try again later.
            </p>
          ) : photos === null ? (
            <div className="flex items-center justify-center py-10">
              <Loader2Icon className="size-5 animate-spin text-brand" />
            </div>
          ) : photos.length === 0 ? (
            <p className="py-6 text-center text-sm text-foreground/50">
              No photos on this trip yet. Open the trip to upload some first.
            </p>
          ) : (
            <div className="grid max-h-[55vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
              {photos.map((photo) => {
                const isCover = photo.id === coverPhotoId;
                return (
                  <button
                    key={photo.id}
                    type="button"
                    disabled={saving}
                    aria-label={
                      isCover
                        ? "Adjust the current cover photo"
                        : "Use this photo as the cover"
                    }
                    onClick={() => setPositionPhoto(photo)}
                    className={cn(
                      "relative aspect-square overflow-hidden rounded-md ring-1 transition-all",
                      isCover
                        ? "ring-2 ring-brand"
                        : "ring-foreground/10 hover:ring-brand/50",
                    )}
                  >
                    <SafeImage
                      src={getPhotoUrl(photo)}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                    {isCover ? (
                      <span className="pointer-events-none absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-md bg-brand/90 px-1.5 py-0.5 text-[0.65rem] font-medium text-brand-foreground">
                        <StarIcon className="size-3" />
                        Cover
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {positionPhoto ? (
        <CoverPositionDialog
          photo={positionPhoto}
          initialPosition={
            positionPhoto.id === coverPhotoId ? coverPosition : null
          }
          confirmLabel={
            positionPhoto.id === coverPhotoId ? "Save position" : "Set as cover"
          }
          onConfirm={(position) => confirmCover(positionPhoto, position)}
          onCancel={() => setPositionPhoto(null)}
        />
      ) : null}
    </>
  );
}

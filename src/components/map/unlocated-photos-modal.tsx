"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FolderInputIcon, Trash2Icon, XIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Lightbox } from "@/components/photos/lightbox";
import { SafeImage } from "@/components/photos/safe-image";
import { deletePhotoRecord, retagPhoto } from "@/lib/actions/photos";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import type { UnlocatedPhoto } from "@/lib/photo-map-data";

/** A destination the assign picker can retag a photo to. */
export interface AssignDestination {
  id: string;
  name: string;
}

// A viewer for photos that could not be placed on the map (no GPS and no owner
// coordinates). They cannot be pinned, so photo map mode surfaces them here as
// a grid, and each opens in the shared lightbox. On the authenticated
// dashboard (destinations provided) each photo is also actionable: assign it
// to a destination (which gives it a map location via the normal owner
// fallback) or delete it.
export function UnlocatedPhotosModal({
  photos,
  destinations,
  isDemo = false,
  onChanged,
  onClose,
}: {
  photos: UnlocatedPhoto[];
  /** When provided, tiles gain Assign and Delete actions. Omit on read-only
   * surfaces (demo, share). */
  destinations?: AssignDestination[];
  isDemo?: boolean;
  /** Called after a successful assign or delete so the host can refresh. */
  onChanged?: () => void;
  onClose: () => void;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // Photos assigned or deleted this session, hidden immediately while the
  // server revalidation catches up.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [assignTarget, setAssignTarget] = useState<UnlocatedPhoto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UnlocatedPhoto | null>(null);
  const [busy, setBusy] = useState(false);

  const visible = photos.filter((photo) => !hiddenIds.has(photo.id));
  const editable = Boolean(destinations && destinations.length > 0);

  // Escape closes the dialogs first, then the lightbox, then the modal.
  // Arrows step the lightbox.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (assignTarget || deleteTarget) {
          if (!busy) {
            setAssignTarget(null);
            setDeleteTarget(null);
          }
        } else if (lightboxIndex !== null) setLightboxIndex(null);
        else onClose();
      }
      if (lightboxIndex === null || assignTarget || deleteTarget) return;
      if (event.key === "ArrowRight") {
        setLightboxIndex((i) => (i === null ? i : (i + 1) % visible.length));
      }
      if (event.key === "ArrowLeft") {
        setLightboxIndex((i) =>
          i === null ? i : (i - 1 + visible.length) % visible.length,
        );
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIndex, visible.length, onClose, assignTarget, deleteTarget, busy]);

  async function handleDelete() {
    if (!deleteTarget) return;
    if (isDemo) {
      toast.error(DEMO_READONLY_MESSAGE);
      setDeleteTarget(null);
      return;
    }
    const targetId = deleteTarget.id;
    setBusy(true);
    const result = await deletePhotoRecord(targetId).catch(() => ({
      error: "Could not delete the photo. Check your connection and retry.",
    }));
    setBusy(false);
    setDeleteTarget(null);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    setLightboxIndex(null);
    setHiddenIds((prev) => new Set(prev).add(targetId));
    toast.success("Photo deleted.");
    onChanged?.();
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 sm:p-8"
        onClick={onClose}
      >
        <div
          className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0a] shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-3.5">
            <div>
              <h2 className="text-sm font-medium text-foreground">
                Photos without a location
              </h2>
              <p className="mt-0.5 text-xs text-foreground/50">
                {visible.length}{" "}
                {visible.length === 1 ? "photo has" : "photos have"} no GPS or
                place to map, so they live here.
                {editable ? " Assign one to a destination to put it on the map." : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-foreground/70 transition-colors hover:bg-white/10 hover:text-foreground"
            >
              <XIcon className="size-4" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1.5 overflow-y-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:grid-cols-4">
            {visible.map((photo, index) => {
              const caption =
                [photo.destinationName, photo.tripName]
                  .filter(Boolean)
                  .join(" · ") || null;
              return (
                <div
                  key={photo.id}
                  className="group relative aspect-square overflow-hidden rounded-md border border-white/10 bg-white/5 transition-colors hover:border-brand/40"
                >
                  <button
                    type="button"
                    onClick={() => setLightboxIndex(index)}
                    className="absolute inset-0"
                    aria-label={caption ?? "Open photo"}
                  >
                    <SafeImage
                      src={photo.thumbUrl}
                      alt={caption ?? ""}
                      loading="lazy"
                      className="size-full object-cover transition-transform group-hover:scale-105"
                    />
                  </button>
                  {editable ? (
                    <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5">
                      <button
                        type="button"
                        aria-label="Assign photo to a destination"
                        title="Assign to..."
                        onClick={() => setAssignTarget(photo)}
                        className="flex size-7 items-center justify-center rounded-md bg-black/55 text-white/85 backdrop-blur transition-colors hover:bg-brand/70 hover:text-white"
                      >
                        <FolderInputIcon className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Delete photo"
                        title="Delete"
                        onClick={() => setDeleteTarget(photo)}
                        className="flex size-7 items-center justify-center rounded-md bg-black/55 text-white/85 backdrop-blur transition-colors hover:bg-red-600/80 hover:text-white"
                      >
                        <Trash2Icon className="size-3.5" />
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {lightboxIndex !== null && visible[lightboxIndex] ? (
        (() => {
          const photo = visible[lightboxIndex];
          const caption =
            [photo.destinationName, photo.tripName]
              .filter(Boolean)
              .join(" · ") || null;
          return (
            <Lightbox
              item={{
                src: photo.fullUrl,
                dateTaken: photo.dateTaken,
                attribution: photo.attribution,
                caption,
              }}
              index={lightboxIndex}
              total={visible.length}
              onPrev={() =>
                setLightboxIndex(
                  (i) => (i === null ? i : (i - 1 + visible.length) % visible.length),
                )
              }
              onNext={() =>
                setLightboxIndex((i) =>
                  i === null ? i : (i + 1) % visible.length,
                )
              }
              onClose={() => setLightboxIndex(null)}
            />
          );
        })()
      ) : null}

      {assignTarget && destinations ? (
        <AssignDialog
          photo={assignTarget}
          destinations={destinations}
          busy={busy}
          onConfirm={async (destId) => {
            if (isDemo) {
              toast.error(DEMO_READONLY_MESSAGE);
              setAssignTarget(null);
              return;
            }
            setBusy(true);
            const result = await retagPhoto(
              assignTarget.id,
              "destination",
              destId,
            ).catch(() => ({ error: "Could not assign the photo." }));
            setBusy(false);
            setAssignTarget(null);
            if ("error" in result) {
              toast.error(result.error);
              return;
            }
            setLightboxIndex(null);
            setHiddenIds((prev) => new Set(prev).add(assignTarget.id));
            toast.success("Photo assigned. It now appears on the map.");
            onChanged?.();
          }}
          onCancel={() => {
            if (!busy) setAssignTarget(null);
          }}
        />
      ) : null}

      {deleteTarget ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setDeleteTarget(null);
          }}
        >
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete this photo?</DialogTitle>
              <DialogDescription>
                The photo will be permanently deleted. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="h-32 w-full overflow-hidden rounded-md bg-white/5">
              <SafeImage
                src={deleteTarget.thumbUrl}
                fallbackSrc={deleteTarget.fullUrl}
                alt=""
                loading="eager"
                className="size-full object-cover"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={busy}
              >
                {busy ? "Deleting..." : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

// Pick the destination an unlocated photo should belong to. Retagging gives
// the photo a map location through the normal owner fallback chain.
function AssignDialog({
  photo,
  destinations,
  busy,
  onConfirm,
  onCancel,
}: {
  photo: UnlocatedPhoto;
  destinations: AssignDestination[];
  busy: boolean;
  onConfirm: (destId: string) => void;
  onCancel: () => void;
}) {
  const [destId, setDestId] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Assign photo to...</DialogTitle>
          <DialogDescription>
            Move this photo to a destination. It will pick up that
            destination&apos;s location and appear on the map.
          </DialogDescription>
        </DialogHeader>

        <div className="h-24 w-full overflow-hidden rounded-md bg-white/5">
          <SafeImage
            src={photo.thumbUrl}
            fallbackSrc={photo.fullUrl}
            alt=""
            loading="eager"
            className="size-full object-cover"
          />
        </div>

        <Select value={destId} onValueChange={setDestId}>
          <SelectTrigger aria-label="Destination">
            <SelectValue placeholder="Choose destination" />
          </SelectTrigger>
          <SelectContent>
            {destinations.map((dest) => (
              <SelectItem key={dest.id} value={dest.id}>
                {dest.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!destId || busy}
            onClick={() => onConfirm(destId)}
            className="bg-brand text-brand-foreground hover:bg-brand/90"
          >
            {busy ? "Assigning..." : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

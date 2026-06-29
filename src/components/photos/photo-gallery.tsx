"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckSquare2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FolderInputIcon,
  MoreVerticalIcon,
  Square,
  StarIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { SafeImage } from "@/components/photos/safe-image";
import {
  deletePhotoRecord,
  setCoverPhoto,
  retagPhoto,
  reorderPhoto,
} from "@/lib/actions/photos";
import { getPhotoUrl, pickCover } from "@/lib/photos";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { cn } from "@/lib/utils";
import type { Photo, PhotoOwnerType } from "@/lib/types";

export interface RetagDestination {
  id: string;
  name: string;
  experiences: { id: string; name: string }[];
}

interface PhotoGalleryProps {
  photos: Photo[];
  coverPhotoId?: string | null;
  coverPosition?: { x: number; y: number } | null;
  editable?: boolean;
  // Whether the menu offers "Set as cover". Off for entities without a cover.
  allowSetCover?: boolean;
  // Whether the menu offers "Delete".
  allowDelete?: boolean;
  // Whether the menu offers "Move to..." (only when provided).
  retagDestinations?: RetagDestination[];
  // Compact mode: a uniform thumbnail grid with no large lead image.
  compact?: boolean;
  ownerType?: PhotoOwnerType;
  ownerId?: string;
  isDemo?: boolean;
  onChanged?: () => void;
}

const WHOLE_DESTINATION = "__whole__";

export function PhotoGallery({
  photos,
  coverPhotoId = null,
  coverPosition = null,
  editable = false,
  allowSetCover = true,
  allowDelete = true,
  retagDestinations,
  compact = false,
  ownerType,
  ownerId,
  isDemo = false,
  onChanged,
}: PhotoGalleryProps) {
  const router = useRouter();
  const cover = pickCover(photos, coverPhotoId);
  const ordered = cover
    ? [cover, ...photos.filter((photo) => photo.id !== cover.id)]
    : photos;
  const isExplicitCover = Boolean(
    coverPhotoId && cover && cover.id === coverPhotoId,
  );

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [positionPhoto, setPositionPhoto] = useState<Photo | null>(null);
  const [movePhoto, setMovePhoto] = useState<Photo | null>(null);

  // Multi-select state
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Bulk action dialogs
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  function exitSelect() {
    setIsSelecting(false);
    setSelectedIds(new Set());
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const close = useCallback(() => setLightboxIndex(null), []);
  const step = useCallback(
    (delta: number) =>
      setLightboxIndex((current) => {
        if (current === null) return current;
        return (current + delta + ordered.length) % ordered.length;
      }),
    [ordered.length],
  );

  useEffect(() => {
    if (lightboxIndex === null && !isSelecting) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (lightboxIndex !== null) close();
        else exitSelect();
      }
      if (event.key === "ArrowRight" && lightboxIndex !== null) step(1);
      if (event.key === "ArrowLeft" && lightboxIndex !== null) step(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIndex, isSelecting, close, step]);

  if (ordered.length === 0) return null;

  const canSetCover = allowSetCover && Boolean(ownerType) && Boolean(ownerId);
  const canRetag = Boolean(retagDestinations?.length);

  async function confirmSetCover(photo: Photo, position: { x: number; y: number }) {
    if (!ownerType || !ownerId) return;
    const result = await setCoverPhoto(ownerType, ownerId, photo.id, position);
    setPositionPhoto(null);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success("Cover photo updated.");
    onChanged?.();
  }

  async function handleDelete(photo: Photo) {
    const result = await deletePhotoRecord(photo.id);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success("Photo deleted.");
    onChanged?.();
  }

  async function handleReorder(photo: Photo, direction: "left" | "right") {
    const result = await reorderPhoto(photo.id, direction);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    router.refresh();
    onChanged?.();
  }

  async function confirmRetag(targetOwnerType: PhotoOwnerType, targetOwnerId: string) {
    if (!movePhoto) return;
    if (isDemo) {
      toast.error(DEMO_READONLY_MESSAGE);
      setMovePhoto(null);
      return;
    }
    const result = await retagPhoto(movePhoto.id, targetOwnerType, targetOwnerId);
    setMovePhoto(null);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success("Photo moved.");
    onChanged?.();
  }

  async function handleBulkMove(targetOwnerType: PhotoOwnerType, targetOwnerId: string) {
    if (isDemo) {
      toast.error(DEMO_READONLY_MESSAGE);
      return;
    }
    setBulkBusy(true);
    const ids = Array.from(selectedIds);
    const results = await Promise.all(
      ids.map((id) => retagPhoto(id, targetOwnerType, targetOwnerId)),
    );
    setBulkBusy(false);
    setBulkMoveOpen(false);
    const errors = results.filter((r) => "error" in r);
    if (errors.length > 0) {
      toast.error(`${errors.length} photo(s) could not be moved.`);
    } else {
      toast.success(`${ids.length} photo(s) moved.`);
    }
    exitSelect();
    onChanged?.();
  }

  async function handleBulkDelete() {
    if (isDemo) {
      toast.error(DEMO_READONLY_MESSAGE);
      return;
    }
    setBulkBusy(true);
    const ids = Array.from(selectedIds);
    const results = await Promise.all(ids.map((id) => deletePhotoRecord(id)));
    setBulkBusy(false);
    setBulkDeleteOpen(false);
    const errors = results.filter((r) => "error" in r);
    if (errors.length > 0) {
      toast.error(`${errors.length} photo(s) could not be deleted.`);
    } else {
      toast.success(`${ids.length} photo(s) deleted.`);
    }
    exitSelect();
    onChanged?.();
  }

  function tileMenu(photo: Photo, index: number) {
    if (!editable || isSelecting) return null;
    const showCover = canSetCover;
    const showRetag = canRetag;
    const isFirst = index === 0;
    const isLast = index === ordered.length - 1;
    if (!showCover && !allowDelete && !showRetag) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Photo options"
            onClick={(event) => event.stopPropagation()}
            className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-md bg-black/55 text-white/90 backdrop-blur transition-colors hover:bg-black/75 data-[state=open]:bg-black/75"
          >
            <MoreVerticalIcon className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          {showCover ? (
            <DropdownMenuItem
              onSelect={() => setPositionPhoto(photo)}
              disabled={photo.id === cover?.id && isExplicitCover}
            >
              <StarIcon />
              Set as cover
            </DropdownMenuItem>
          ) : null}
          {showCover && (showRetag || allowDelete) ? (
            <DropdownMenuSeparator />
          ) : null}
          {showRetag ? (
            <DropdownMenuItem
              onSelect={() => setMovePhoto(photo)}
            >
              <FolderInputIcon />
              Move to...
            </DropdownMenuItem>
          ) : null}
          {allowDelete ? (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => handleDelete(photo)}
            >
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          ) : null}
          {(showCover || showRetag || allowDelete) ? (
            <DropdownMenuSeparator />
          ) : null}
          <DropdownMenuItem
            onSelect={() => handleReorder(photo, "left")}
            disabled={isFirst}
          >
            <ArrowLeftIcon />
            Move left
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => handleReorder(photo, "right")}
            disabled={isLast}
          >
            <ArrowRightIcon />
            Move right
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  function selectionCheckbox(photo: Photo) {
    if (!isSelecting) return null;
    const selected = selectedIds.has(photo.id);
    return (
      <div
        className="absolute left-2 top-2 flex size-6 items-center justify-center"
        onClick={(e) => {
          e.stopPropagation();
          toggleSelect(photo.id);
        }}
      >
        {selected ? (
          <CheckSquare2Icon className="size-5 text-brand drop-shadow" />
        ) : (
          <Square className="size-5 text-white/80 drop-shadow" />
        )}
      </div>
    );
  }

  function coverBadge(photo: Photo) {
    if (!isExplicitCover || !cover || photo.id !== cover.id) return null;
    return (
      <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-brand/90 px-1.5 py-0.5 text-[0.65rem] font-medium text-brand-foreground">
        <StarIcon className="size-3" />
        Cover
      </span>
    );
  }

  // Cover position only applies to the explicitly-set cover photo.
  const activeCoverPosition =
    isExplicitCover && cover ? coverPosition : null;

  const toolbar = editable ? (
    <div className="flex items-center justify-end gap-2">
      {isSelecting ? (
        <>
          <span className="text-xs text-foreground/50">
            {selectedIds.size} selected
          </span>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set(ordered.map((p) => p.id)))}
            className="text-xs text-foreground/70 hover:text-foreground"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-foreground/70 hover:text-foreground"
          >
            Deselect all
          </button>
          <button
            type="button"
            onClick={exitSelect}
            className="text-xs text-foreground/70 hover:text-foreground"
          >
            Done
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setIsSelecting(true)}
          className="text-xs text-foreground/50 hover:text-foreground/80"
        >
          Select
        </button>
      )}
    </div>
  ) : null;

  return (
    <>
      <div className="flex flex-col gap-2">
        {toolbar}

        {compact ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {ordered.map((photo, i) => {
              const selected = selectedIds.has(photo.id);
              return (
                <div
                  key={photo.id}
                  className={cn(
                    "group/tile relative aspect-square cursor-pointer overflow-hidden rounded-lg ring-1",
                    selected
                      ? "ring-2 ring-brand"
                      : "ring-foreground/10",
                  )}
                  onClick={() => {
                    if (isSelecting) {
                      toggleSelect(photo.id);
                    } else {
                      setLightboxIndex(i);
                    }
                  }}
                >
                  <SafeImage
                    src={getPhotoUrl(photo)}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover transition-transform duration-300 group-hover/tile:scale-[1.04]"
                  />
                  <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover/tile:bg-black/15" />
                  {selectionCheckbox(photo)}
                  {!isSelecting ? tileMenu(photo, i) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {(() => {
              const photo = ordered[0];
              const selected = photo ? selectedIds.has(photo.id) : false;
              return photo ? (
                <div
                  className={cn(
                    "group/tile relative aspect-[16/9] w-full cursor-pointer overflow-hidden rounded-xl ring-1",
                    selected
                      ? "ring-2 ring-brand"
                      : "ring-foreground/10",
                  )}
                  onClick={() => {
                    if (isSelecting) {
                      toggleSelect(photo.id);
                    } else {
                      setLightboxIndex(0);
                    }
                  }}
                >
                  <SafeImage
                    src={getPhotoUrl(photo)}
                    alt=""
                    loading="eager"
                    style={
                      activeCoverPosition
                        ? { objectPosition: `${activeCoverPosition.x}% ${activeCoverPosition.y}%` }
                        : undefined
                    }
                    className="size-full object-cover transition-transform duration-300 group-hover/tile:scale-[1.02]"
                  />
                  {isSelecting ? selectionCheckbox(photo) : coverBadge(photo)}
                  {!isSelecting ? tileMenu(photo, 0) : null}
                </div>
              ) : null;
            })()}

            {ordered.length > 1 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {ordered.slice(1).map((photo, i) => {
                  const selected = selectedIds.has(photo.id);
                  return (
                    <div
                      key={photo.id}
                      className={cn(
                        "group/tile relative aspect-square cursor-pointer overflow-hidden rounded-lg ring-1",
                        selected
                          ? "ring-2 ring-brand"
                          : "ring-foreground/10",
                      )}
                      onClick={() => {
                        if (isSelecting) {
                          toggleSelect(photo.id);
                        } else {
                          setLightboxIndex(i + 1);
                        }
                      }}
                    >
                      <SafeImage
                        src={getPhotoUrl(photo)}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover transition-transform duration-300 group-hover/tile:scale-[1.04]"
                      />
                      <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover/tile:bg-black/15" />
                      {selectionCheckbox(photo)}
                      {!isSelecting ? tileMenu(photo, i + 1) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {lightboxIndex !== null ? (
        <Lightbox
          photo={ordered[lightboxIndex]}
          hasMultiple={ordered.length > 1}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onClose={close}
        />
      ) : null}

      {positionPhoto ? (
        <CoverPositionDialog
          photo={positionPhoto}
          initialPosition={
            positionPhoto.id === cover?.id ? coverPosition : null
          }
          onConfirm={(position) => confirmSetCover(positionPhoto, position)}
          onCancel={() => setPositionPhoto(null)}
        />
      ) : null}

      {movePhoto && retagDestinations ? (
        <RetagDialog
          photo={movePhoto}
          destinations={retagDestinations}
          onConfirm={confirmRetag}
          onCancel={() => setMovePhoto(null)}
        />
      ) : null}

      {/* Floating action bar when items are selected */}
      {isSelecting && selectedIds.size > 0 ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#111] px-4 py-3 shadow-lg">
            <span className="text-sm text-foreground/70">
              {selectedIds.size} selected
            </span>
            {retagDestinations && retagDestinations.length > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setBulkMoveOpen(true)}
                disabled={bulkBusy}
              >
                <FolderInputIcon className="size-4" />
                Move to...
              </Button>
            ) : null}
            {allowDelete ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => setBulkDeleteOpen(true)}
                disabled={bulkBusy}
              >
                <Trash2Icon className="size-4" />
                Delete
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {bulkMoveOpen && retagDestinations ? (
        <BulkRetagDialog
          count={selectedIds.size}
          destinations={retagDestinations}
          busy={bulkBusy}
          onConfirm={handleBulkMove}
          onCancel={() => setBulkMoveOpen(false)}
        />
      ) : null}

      {bulkDeleteOpen ? (
        <Dialog open onOpenChange={(open) => { if (!open && !bulkBusy) setBulkDeleteOpen(false); }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete {selectedIds.size} photo(s)?</DialogTitle>
              <DialogDescription>
                This will permanently delete the selected photos. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setBulkDeleteOpen(false)}
                disabled={bulkBusy}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleBulkDelete}
                disabled={bulkBusy}
              >
                {bulkBusy ? "Deleting..." : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

function Lightbox({
  photo,
  hasMultiple,
  onPrev,
  onNext,
  onClose,
}: {
  photo: Photo;
  hasMultiple: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const touchStartX = useRef<number | null>(null);

  function onTouchStart(event: React.TouchEvent) {
    touchStartX.current = event.changedTouches[0]?.clientX ?? null;
  }
  function onTouchEnd(event: React.TouchEvent) {
    if (touchStartX.current === null || !hasMultiple) return;
    const delta = (event.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < 50) return;
    if (delta < 0) onNext();
    else onPrev();
  }

  const dateTaken = photo.date_taken
    ? new Date(photo.date_taken).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 sm:p-8"
      onClick={onClose}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <XIcon className="size-5" />
      </button>

      {hasMultiple ? (
        <button
          type="button"
          aria-label="Previous photo"
          onClick={(event) => {
            event.stopPropagation();
            onPrev();
          }}
          className="absolute left-4 flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <ChevronLeftIcon className="size-6" />
        </button>
      ) : null}

      <figure
        className="flex max-h-full max-w-5xl flex-col items-center gap-3"
        onClick={(event) => event.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={getPhotoUrl(photo)}
          alt=""
          className="max-h-[80vh] w-auto rounded-lg object-contain"
        />
        {photo.attribution || dateTaken ? (
          <figcaption className="flex flex-col items-center gap-1 text-center text-xs text-white/60">
            {dateTaken ? <span>{dateTaken}</span> : null}
            {photo.attribution ? <span>{photo.attribution}</span> : null}
          </figcaption>
        ) : null}
      </figure>

      {hasMultiple ? (
        <button
          type="button"
          aria-label="Next photo"
          onClick={(event) => {
            event.stopPropagation();
            onNext();
          }}
          className="absolute right-4 flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <ChevronRightIcon className="size-6" />
        </button>
      ) : null}
    </div>
  );
}

function CoverPositionDialog({
  photo,
  initialPosition,
  onConfirm,
  onCancel,
}: {
  photo: Photo;
  initialPosition?: { x: number; y: number } | null;
  onConfirm: (position: { x: number; y: number }) => void;
  onCancel: () => void;
}) {
  const [pos, setPos] = useState({
    x: initialPosition?.x ?? 50,
    y: initialPosition?.y ?? 50,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{
    mx: number;
    my: number;
    px: number;
    py: number;
  } | null>(null);

  function clamp(v: number): number {
    return Math.min(100, Math.max(0, v));
  }

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragStart.current || !containerRef.current) return;
      const { width, height } = containerRef.current.getBoundingClientRect();
      const dx = e.clientX - dragStart.current.mx;
      const dy = e.clientY - dragStart.current.my;
      setPos({
        x: clamp(dragStart.current.px - (dx / width) * 100),
        y: clamp(dragStart.current.py - (dy / height) * 100),
      });
    }
    function onMouseUp() {
      dragStart.current = null;
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  function onMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
  }

  function onTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    const touch = e.changedTouches[0];
    if (!touch) return;
    dragStart.current = {
      mx: touch.clientX,
      my: touch.clientY,
      px: pos.x,
      py: pos.y,
    };
  }

  function onTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (!dragStart.current || !containerRef.current) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const { width, height } = containerRef.current.getBoundingClientRect();
    const dx = touch.clientX - dragStart.current.mx;
    const dy = touch.clientY - dragStart.current.my;
    setPos({
      x: clamp(dragStart.current.px - (dx / width) * 100),
      y: clamp(dragStart.current.py - (dy / height) * 100),
    });
  }

  function onTouchEnd() {
    dragStart.current = null;
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Position cover photo</DialogTitle>
          <DialogDescription>
            Drag the image to choose which part is shown as the cover.
          </DialogDescription>
        </DialogHeader>

        <div
          ref={containerRef}
          className="relative aspect-[16/9] w-full cursor-move select-none overflow-hidden rounded-lg ring-1 ring-foreground/10"
          onMouseDown={onMouseDown}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={getPhotoUrl(photo)}
            alt=""
            draggable={false}
            style={{ objectPosition: `${pos.x}% ${pos.y}%` }}
            className="pointer-events-none size-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 border-2 border-brand/40" />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() =>
              onConfirm({ x: Math.round(pos.x), y: Math.round(pos.y) })
            }
            className="bg-brand text-brand-foreground hover:bg-brand/90"
          >
            Set as cover
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RetagDialog({
  photo,
  destinations,
  onConfirm,
  onCancel,
}: {
  photo: Photo;
  destinations: RetagDestination[];
  onConfirm: (ownerType: PhotoOwnerType, ownerId: string) => void;
  onCancel: () => void;
}) {
  const [destId, setDestId] = useState("");
  const [expId, setExpId] = useState(WHOLE_DESTINATION);

  const destination = destinations.find((d) => d.id === destId) ?? null;

  function handleConfirm() {
    if (!destId) return;
    const isExp = expId !== WHOLE_DESTINATION;
    onConfirm(isExp ? "experience" : "destination", isExp ? expId : destId);
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Move photo to...</DialogTitle>
          <DialogDescription>
            Choose a destination or experience to move this photo to.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="h-24 w-full overflow-hidden rounded-md bg-white/5">
            <SafeImage
              src={getPhotoUrl(photo)}
              alt=""
              loading="eager"
              className="size-full object-cover"
            />
          </div>

          <Select
            value={destId}
            onValueChange={(v) => {
              setDestId(v);
              setExpId(WHOLE_DESTINATION);
            }}
          >
            <SelectTrigger aria-label="Destination">
              <SelectValue placeholder="Choose destination" />
            </SelectTrigger>
            <SelectContent>
              {destinations.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {destination && destination.experiences.length > 0 ? (
            <Select value={expId} onValueChange={setExpId}>
              <SelectTrigger aria-label="Experience">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={WHOLE_DESTINATION}>
                  Whole destination
                </SelectItem>
                {destination.experiences.map((exp) => (
                  <SelectItem key={exp.id} value={exp.id}>
                    {exp.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!destId}
            onClick={handleConfirm}
            className="bg-brand text-brand-foreground hover:bg-brand/90"
          >
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkRetagDialog({
  count,
  destinations,
  busy,
  onConfirm,
  onCancel,
}: {
  count: number;
  destinations: RetagDestination[];
  busy: boolean;
  onConfirm: (ownerType: PhotoOwnerType, ownerId: string) => void;
  onCancel: () => void;
}) {
  const [destId, setDestId] = useState("");
  const [expId, setExpId] = useState(WHOLE_DESTINATION);

  const destination = destinations.find((d) => d.id === destId) ?? null;

  function handleConfirm() {
    if (!destId) return;
    const isExp = expId !== WHOLE_DESTINATION;
    onConfirm(isExp ? "experience" : "destination", isExp ? expId : destId);
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Move {count} photo(s) to...</DialogTitle>
          <DialogDescription>
            Choose a destination or experience to move the selected photos to.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Select
            value={destId}
            onValueChange={(v) => {
              setDestId(v);
              setExpId(WHOLE_DESTINATION);
            }}
          >
            <SelectTrigger aria-label="Destination">
              <SelectValue placeholder="Choose destination" />
            </SelectTrigger>
            <SelectContent>
              {destinations.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {destination && destination.experiences.length > 0 ? (
            <Select value={expId} onValueChange={setExpId}>
              <SelectTrigger aria-label="Experience">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={WHOLE_DESTINATION}>
                  Whole destination
                </SelectItem>
                {destination.experiences.map((exp) => (
                  <SelectItem key={exp.id} value={exp.id}>
                    {exp.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>

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
            onClick={handleConfirm}
            className="bg-brand text-brand-foreground hover:bg-brand/90"
          >
            {busy ? "Moving..." : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FolderInputIcon,
  MoreVerticalIcon,
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
} from "@/lib/actions/photos";
import { getPhotoUrl, pickCover } from "@/lib/photos";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
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
    if (lightboxIndex === null) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIndex, close, step]);

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

  function tileMenu(photo: Photo) {
    if (!editable) return null;
    const showCover = canSetCover;
    const showRetag = canRetag;
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
        </DropdownMenuContent>
      </DropdownMenu>
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

  return (
    <>
      {compact ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {ordered.map((photo, i) => (
            <div
              key={photo.id}
              className="group/tile relative aspect-square cursor-pointer overflow-hidden rounded-lg ring-1 ring-foreground/10"
              onClick={() => setLightboxIndex(i)}
            >
              <SafeImage
                src={getPhotoUrl(photo)}
                alt=""
                loading="lazy"
                className="size-full object-cover transition-transform duration-300 group-hover/tile:scale-[1.04]"
              />
              <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover/tile:bg-black/15" />
              {tileMenu(photo)}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div
            className="group/tile relative aspect-[16/9] w-full cursor-pointer overflow-hidden rounded-xl ring-1 ring-foreground/10"
            onClick={() => setLightboxIndex(0)}
          >
            <SafeImage
              src={getPhotoUrl(ordered[0])}
              alt=""
              loading="eager"
              style={
                activeCoverPosition
                  ? { objectPosition: `${activeCoverPosition.x}% ${activeCoverPosition.y}%` }
                  : undefined
              }
              className="size-full object-cover transition-transform duration-300 group-hover/tile:scale-[1.02]"
            />
            {coverBadge(ordered[0])}
            {tileMenu(ordered[0])}
          </div>

          {ordered.length > 1 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {ordered.slice(1).map((photo, i) => (
                <div
                  key={photo.id}
                  className="group/tile relative aspect-square cursor-pointer overflow-hidden rounded-lg ring-1 ring-foreground/10"
                  onClick={() => setLightboxIndex(i + 1)}
                >
                  <SafeImage
                    src={getPhotoUrl(photo)}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover transition-transform duration-300 group-hover/tile:scale-[1.04]"
                  />
                  <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover/tile:bg-black/15" />
                  {tileMenu(photo)}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

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
        {photo.attribution ? (
          <figcaption className="text-center text-xs text-white/60">
            {photo.attribution}
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

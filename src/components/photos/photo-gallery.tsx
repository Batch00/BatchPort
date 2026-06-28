"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MoreVerticalIcon,
  StarIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deletePhotoRecord, setCoverPhoto } from "@/lib/actions/photos";
import { getPhotoUrl, pickCover } from "@/lib/photos";
import type { Photo, PhotoOwnerType } from "@/lib/types";

interface PhotoGalleryProps {
  photos: Photo[];
  coverPhotoId?: string | null;
  // When editable, each photo gets a hover menu (set as cover and/or delete).
  editable?: boolean;
  // Whether the menu offers "Set as cover". Off for entities without a cover
  // (experiences). Defaults to true.
  allowSetCover?: boolean;
  // Whether the menu offers "Delete". Defaults to true.
  allowDelete?: boolean;
  // Compact mode: a uniform thumbnail grid with no large lead image. Used for
  // inline experience galleries.
  compact?: boolean;
  ownerType?: PhotoOwnerType;
  ownerId?: string;
  onChanged?: () => void;
}

export function PhotoGallery({
  photos,
  coverPhotoId = null,
  editable = false,
  allowSetCover = true,
  allowDelete = true,
  compact = false,
  ownerType,
  ownerId,
  onChanged,
}: PhotoGalleryProps) {
  // Lead with the cover, then the rest in their stored order.
  const cover = pickCover(photos, coverPhotoId);
  const ordered = cover
    ? [cover, ...photos.filter((photo) => photo.id !== cover.id)]
    : photos;
  // Only flag a cover when one is explicitly set (not the first-photo fallback).
  const isExplicitCover = Boolean(
    coverPhotoId && cover && cover.id === coverPhotoId,
  );

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const close = useCallback(() => setLightboxIndex(null), []);
  const step = useCallback(
    (delta: number) =>
      setLightboxIndex((current) => {
        if (current === null) return current;
        const next = (current + delta + ordered.length) % ordered.length;
        return next;
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

  async function handleSetCover(photo: Photo) {
    if (!ownerType || !ownerId) return;
    const result = await setCoverPhoto(ownerType, ownerId, photo.id);
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

  function tileMenu(photo: Photo) {
    if (!editable) return null;
    const showCover = canSetCover;
    if (!showCover && !allowDelete) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Photo options"
            onClick={(event) => event.stopPropagation()}
            className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-md bg-black/50 text-white opacity-0 backdrop-blur transition-opacity group-hover/tile:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreVerticalIcon className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          {showCover ? (
            <DropdownMenuItem
              onSelect={() => handleSetCover(photo)}
              disabled={photo.id === cover?.id && isExplicitCover}
            >
              <StarIcon />
              Set as cover
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

  // A small "Cover" badge for the tile that is the current explicit cover.
  function coverBadge(photo: Photo) {
    if (!isExplicitCover || !cover || photo.id !== cover.id) return null;
    return (
      <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-brand/90 px-1.5 py-0.5 text-[0.65rem] font-medium text-brand-foreground">
        <StarIcon className="size-3" />
        Cover
      </span>
    );
  }

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
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getPhotoUrl(photo)}
                alt=""
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getPhotoUrl(ordered[0])}
              alt=""
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
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={getPhotoUrl(photo)}
                    alt=""
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
  // Track a horizontal swipe on the image to move between photos on touch.
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

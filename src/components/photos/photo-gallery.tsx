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
import { CoverPositionDialog } from "@/components/photos/cover-position-dialog";
import {
  deletePhotoRecord,
  setCoverPhoto,
  retagPhoto,
  reorderPhotos,
} from "@/lib/actions/photos";
import {
  compareByDateTaken,
  coverImageStyle,
  getPhotoUrl,
  pickCover,
} from "@/lib/photos";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { cn } from "@/lib/utils";
import type { CoverPosition, Photo, PhotoOwnerType } from "@/lib/types";

export interface RetagDestination {
  id: string;
  name: string;
  experiences: { id: string; name: string }[];
}

interface PhotoGalleryProps {
  photos: Photo[];
  coverPhotoId?: string | null;
  coverPosition?: CoverPosition | null;
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

  // Optimistic display order (photo ids). Set immediately when the user
  // reorders (buttons or drag) so the grid updates without waiting for the
  // server round-trip; reset whenever the photo set itself changes.
  const [viewOrder, setViewOrder] = useState<string[] | null>(null);
  // Photos deleted this session, hidden immediately while the server
  // revalidation catches up.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  // Sort mode. null = automatic: by date taken when any photo has one,
  // otherwise the manual order. The user can override with the toggle.
  const [sortChoice, setSortChoice] = useState<"date" | "custom" | null>(null);
  const photoIdsKey = photos
    .map((photo) => photo.id)
    .sort()
    .join("|");
  // Render-phase state adjustment (the React-documented pattern for deriving
  // state from props): drop any optimistic order once the photo set changes.
  const [prevIdsKey, setPrevIdsKey] = useState(photoIdsKey);
  if (prevIdsKey !== photoIdsKey) {
    setPrevIdsKey(photoIdsKey);
    setViewOrder(null);
    setHiddenIds(new Set());
  }

  const visible = photos.filter((photo) => !hiddenIds.has(photo.id));
  const hasDates = visible.some((photo) => photo.date_taken);
  const dateSorted = (sortChoice ?? (hasDates ? "date" : "custom")) === "date";

  const photosById = new Map(visible.map((photo) => [photo.id, photo]));
  const base = dateSorted
    ? [...visible].sort(compareByDateTaken)
    : viewOrder
      ? viewOrder
          .map((id) => photosById.get(id))
          .filter((photo): photo is Photo => Boolean(photo))
      : visible;
  const cover = pickCover(base, coverPhotoId);
  const ordered = cover
    ? [cover, ...base.filter((photo) => photo.id !== cover.id)]
    : base;
  const isExplicitCover = Boolean(
    coverPhotoId && cover && cover.id === coverPhotoId,
  );

  // Reordering only makes sense when every photo belongs to the same owner:
  // the trip gallery can mix destination and experience photos, where a shared
  // order_index sequence has no meaning. Date sort also disables it: dragging
  // would be immediately re-sorted away.
  const reorderable =
    editable &&
    !dateSorted &&
    visible.length > 1 &&
    visible.every(
      (photo) =>
        photo.owner_type === visible[0].owner_type &&
        photo.owner_id === visible[0].owner_id,
    );
  // With an explicit cover pinned to the lead slot, photos shuffle behind it.
  const minIndex = isExplicitCover ? 1 : 0;

  // Latest display order, readable from drag handlers without stale closures.
  // Synced in an effect (not during render) per the react-hooks/refs rule;
  // React flushes effects before dispatching the next input event, so the drag
  // handlers always see the order from the latest committed render.
  const orderedIdsRef = useRef<string[]>(ordered.map((photo) => photo.id));
  useEffect(() => {
    orderedIdsRef.current = ordered.map((photo) => photo.id);
  });

  // Drag-and-drop reorder state. Declared with the other hooks so nothing is
  // called conditionally relative to the empty-gallery early return below.
  const tileRefs = useRef(new Map<string, HTMLDivElement>());
  const suppressClickRef = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    activated: boolean;
    longPress: number | null;
    preDragOrder: string[];
  } | null>(null);
  const dragListenersRef = useRef<{
    move: (event: PointerEvent) => void;
    up: () => void;
    cancel: () => void;
    preventTouch: (event: TouchEvent) => void;
  } | null>(null);

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [positionPhoto, setPositionPhoto] = useState<Photo | null>(null);
  const [movePhoto, setMovePhoto] = useState<Photo | null>(null);
  // Single-photo delete confirmation target.
  const [deleteTarget, setDeleteTarget] = useState<Photo | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

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

  async function confirmSetCover(photo: Photo, position: CoverPosition) {
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

  async function handleDelete() {
    if (!deleteTarget) return;
    if (isDemo) {
      toast.error(DEMO_READONLY_MESSAGE);
      setDeleteTarget(null);
      return;
    }
    const targetId = deleteTarget.id;
    setDeleteBusy(true);
    // Hide immediately; restore if the server delete fails.
    setHiddenIds((prev) => new Set(prev).add(targetId));
    const result = await deletePhotoRecord(targetId);
    setDeleteBusy(false);
    setDeleteTarget(null);
    if ("error" in result) {
      setHiddenIds((prev) => {
        const next = new Set(prev);
        next.delete(targetId);
        return next;
      });
      toast.error(result.error);
      return;
    }
    toast.success("Photo deleted.");
    onChanged?.();
  }

  // Persist a new display order: apply it optimistically, then send the full
  // id sequence in one server action call. Revert on failure.
  async function commitOrder(newIds: string[], previous: string[]) {
    if (newIds.join("|") === previous.join("|")) return;
    if (isDemo) {
      toast.error(DEMO_READONLY_MESSAGE);
      setViewOrder(previous);
      return;
    }
    const result = await reorderPhotos(newIds);
    if ("error" in result) {
      toast.error(result.error);
      setViewOrder(previous);
      return;
    }
    router.refresh();
    onChanged?.();
  }

  async function handleReorder(index: number, direction: "left" | "right") {
    const ids = orderedIdsRef.current;
    const target = direction === "left" ? index - 1 : index + 1;
    if (target < minIndex || target >= ids.length) return;
    const next = [...ids];
    [next[index], next[target]] = [next[target], next[index]];
    setViewOrder(next);
    await commitOrder(next, ids);
  }

  // --- Drag-and-drop reordering (pointer events, so it works with both mouse
  // and touch; HTML5 drag-and-drop has no native touch support). Mouse drags
  // start after a small movement threshold so plain clicks still open the
  // lightbox; touch drags start after a long press so the grid stays
  // scrollable. Move left/right stays available as the fallback.
  function registerTile(id: string) {
    return (el: HTMLDivElement | null) => {
      if (el) tileRefs.current.set(id, el);
      else tileRefs.current.delete(id);
    };
  }

  function hitTestTile(x: number, y: number): string | null {
    for (const [id, el] of tileRefs.current) {
      const rect = el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return id;
      }
    }
    return null;
  }

  function activateDrag() {
    const state = dragRef.current;
    if (!state || state.activated) return;
    state.activated = true;
    suppressClickRef.current = true;
    setDraggingId(state.id);
  }

  function endDrag(commit: boolean) {
    const state = dragRef.current;
    const listeners = dragListenersRef.current;
    if (listeners) {
      window.removeEventListener("pointermove", listeners.move);
      window.removeEventListener("pointerup", listeners.up);
      window.removeEventListener("pointercancel", listeners.cancel);
      document.removeEventListener("touchmove", listeners.preventTouch);
    }
    dragListenersRef.current = null;
    dragRef.current = null;
    if (state && state.longPress !== null) {
      window.clearTimeout(state.longPress);
    }
    setDraggingId(null);
    if (state?.activated) {
      // Let the click that follows pointerup pass before re-enabling clicks.
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      if (commit) {
        void commitOrder(orderedIdsRef.current, state.preDragOrder);
      } else {
        setViewOrder(state.preDragOrder);
      }
    }
  }

  function beginDrag(event: React.PointerEvent, photoId: string) {
    if (!reorderable || isSelecting) return;
    // The explicit cover is pinned to the lead slot and cannot be dragged.
    if (isExplicitCover && cover && photoId === cover.id) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (dragRef.current) return;

    const isMouse = event.pointerType === "mouse";
    const state = {
      id: photoId,
      startX: event.clientX,
      startY: event.clientY,
      activated: false,
      longPress: null as number | null,
      preDragOrder: orderedIdsRef.current,
    };
    dragRef.current = state;

    const preventTouch = (touchEvent: TouchEvent) => {
      if (dragRef.current?.activated) touchEvent.preventDefault();
    };

    const move = (moveEvent: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      if (!current.activated) {
        const distance = Math.hypot(
          moveEvent.clientX - current.startX,
          moveEvent.clientY - current.startY,
        );
        if (isMouse) {
          if (distance > 6) activateDrag();
        } else if (distance > 10) {
          // Touch moved before the long press fired: it is a scroll, not a drag.
          endDrag(false);
        }
        if (!dragRef.current?.activated) return;
      }
      const over = hitTestTile(moveEvent.clientX, moveEvent.clientY);
      if (!over || over === current.id) return;
      const ids = orderedIdsRef.current;
      const from = ids.indexOf(current.id);
      let to = ids.indexOf(over);
      if (from === -1 || to === -1) return;
      if (to < minIndex) to = minIndex;
      if (to === from) return;
      const next = [...ids];
      next.splice(from, 1);
      next.splice(to, 0, current.id);
      setViewOrder(next);
    };

    const up = () => endDrag(true);
    const cancel = () => endDrag(false);

    dragListenersRef.current = { move, up, cancel, preventTouch };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    if (!isMouse) {
      document.addEventListener("touchmove", preventTouch, { passive: false });
      state.longPress = window.setTimeout(activateDrag, 250);
    }
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
      toast.error(
        `${errors.length} ${errors.length === 1 ? "photo" : "photos"} could not be moved.`,
      );
    } else {
      toast.success(`${ids.length} ${ids.length === 1 ? "photo" : "photos"} moved.`);
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
    // Hide immediately; restore any that fail to delete.
    setHiddenIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    const results = await Promise.all(ids.map((id) => deletePhotoRecord(id)));
    setBulkBusy(false);
    setBulkDeleteOpen(false);
    const failedIds = ids.filter((_, i) => "error" in results[i]);
    if (failedIds.length > 0) {
      setHiddenIds((prev) => {
        const next = new Set(prev);
        for (const id of failedIds) next.delete(id);
        return next;
      });
      toast.error(
        `${failedIds.length} ${failedIds.length === 1 ? "photo" : "photos"} could not be deleted.`,
      );
    } else {
      toast.success(
        `${ids.length} ${ids.length === 1 ? "photo" : "photos"} deleted.`,
      );
    }
    exitSelect();
    onChanged?.();
  }

  function tileMenu(photo: Photo, index: number) {
    if (!editable || isSelecting) return null;
    const showCover = canSetCover;
    const showRetag = canRetag;
    // The pinned lead slot is not reorderable, so its tile hides the move items.
    const showReorder = reorderable && !(isExplicitCover && index === 0);
    const isFirst = index <= minIndex;
    const isLast = index === ordered.length - 1;
    if (!showCover && !allowDelete && !showRetag && !showReorder) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Photo options"
            onClick={(event) => event.stopPropagation()}
            className="absolute right-1.5 top-1.5 flex size-9 items-center justify-center rounded-md bg-black/55 text-white/90 backdrop-blur transition-colors hover:bg-black/75 data-[state=open]:bg-black/75 sm:right-2 sm:top-2 sm:size-7"
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
              onSelect={() => setDeleteTarget(photo)}
            >
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          ) : null}
          {showReorder ? (
            <>
              {showCover || showRetag || allowDelete ? (
                <DropdownMenuSeparator />
              ) : null}
              <DropdownMenuItem
                onSelect={() => handleReorder(index, "left")}
                disabled={isFirst}
              >
                <ArrowLeftIcon />
                Move left
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => handleReorder(index, "right")}
                disabled={isLast}
              >
                <ArrowRightIcon />
                Move right
              </DropdownMenuItem>
            </>
          ) : null}
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

  const showSortToggle = hasDates && visible.length > 1 && !isSelecting;
  const sortToggle = showSortToggle ? (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-foreground/40">Sort:</span>
      {(["date", "custom"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => setSortChoice(mode)}
          aria-pressed={dateSorted === (mode === "date")}
          className={cn(
            "rounded-md px-2 py-1.5 transition-colors sm:py-0.5",
            dateSorted === (mode === "date")
              ? "bg-white/10 font-medium text-foreground"
              : "text-foreground/50 hover:text-foreground/80",
          )}
        >
          {mode === "date" ? "Date" : "Custom"}
        </button>
      ))}
    </div>
  ) : null;

  const toolbar =
    editable || showSortToggle ? (
      <div className="flex items-center justify-between gap-2">
        {sortToggle ?? <span />}
        <div className="flex items-center gap-2">
          {editable ? (
            isSelecting ? (
              <>
                <span className="text-xs text-foreground/50">
                  {selectedIds.size} selected
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedIds(new Set(ordered.map((p) => p.id)))
                  }
                  className="-my-1 px-1 py-2 text-xs text-foreground/70 hover:text-foreground"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="-my-1 px-1 py-2 text-xs text-foreground/70 hover:text-foreground"
                >
                  Deselect all
                </button>
                <button
                  type="button"
                  onClick={exitSelect}
                  className="-my-1 px-1 py-2 text-xs font-medium text-foreground/70 hover:text-foreground"
                >
                  Done
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setIsSelecting(true)}
                className="-my-1 px-1 py-2 text-xs text-foreground/50 hover:text-foreground/80"
              >
                Select
              </button>
            )
          ) : null}
        </div>
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
                  ref={registerTile(photo.id)}
                  onPointerDown={(event) => beginDrag(event, photo.id)}
                  onDragStart={(event) => event.preventDefault()}
                  className={cn(
                    "group/tile relative aspect-square cursor-pointer overflow-hidden rounded-lg ring-1",
                    selected
                      ? "ring-2 ring-brand"
                      : "ring-foreground/10",
                    draggingId === photo.id && "opacity-60 ring-2 ring-brand",
                  )}
                  onClick={() => {
                    if (suppressClickRef.current) return;
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
                  ref={registerTile(photo.id)}
                  onPointerDown={(event) => beginDrag(event, photo.id)}
                  onDragStart={(event) => event.preventDefault()}
                  className={cn(
                    "group/tile relative aspect-[16/9] w-full cursor-pointer overflow-hidden rounded-xl ring-1",
                    selected
                      ? "ring-2 ring-brand"
                      : "ring-foreground/10",
                    draggingId === photo.id && "opacity-60 ring-2 ring-brand",
                  )}
                  onClick={() => {
                    if (suppressClickRef.current) return;
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
                    style={coverImageStyle(activeCoverPosition)}
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
                      ref={registerTile(photo.id)}
                      onPointerDown={(event) => beginDrag(event, photo.id)}
                      onDragStart={(event) => event.preventDefault()}
                      className={cn(
                        "group/tile relative aspect-square cursor-pointer overflow-hidden rounded-lg ring-1",
                        selected
                          ? "ring-2 ring-brand"
                          : "ring-foreground/10",
                        draggingId === photo.id && "opacity-60 ring-2 ring-brand",
                      )}
                      onClick={() => {
                        if (suppressClickRef.current) return;
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
          index={lightboxIndex}
          total={ordered.length}
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
          title="Move photo to..."
          description="Choose a destination or experience to move this photo to."
          photo={movePhoto}
          destinations={retagDestinations}
          onConfirm={confirmRetag}
          onCancel={() => setMovePhoto(null)}
        />
      ) : null}

      {/* Floating action bar when items are selected. inset-x keeps it inside
          the viewport on narrow screens; the bottom offset clears the iOS home
          indicator via the safe-area inset. */}
      {isSelecting && selectedIds.size > 0 ? (
        <div className="fixed inset-x-4 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-50 flex justify-center">
          <div className="flex max-w-full flex-wrap items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#111] px-3 py-2.5 shadow-lg sm:gap-3 sm:px-4 sm:py-3">
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

      {deleteTarget ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !deleteBusy) setDeleteTarget(null);
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
                src={getPhotoUrl(deleteTarget)}
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
                disabled={deleteBusy}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteBusy}
              >
                {deleteBusy ? "Deleting..." : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {bulkMoveOpen && retagDestinations ? (
        <RetagDialog
          title={`Move ${selectedIds.size} ${selectedIds.size === 1 ? "photo" : "photos"} to...`}
          description="Choose a destination or experience to move the selected photos to."
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
              <DialogTitle>
                Delete {selectedIds.size}{" "}
                {selectedIds.size === 1 ? "photo" : "photos"}?
              </DialogTitle>
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
  index,
  total,
  onPrev,
  onNext,
  onClose,
}: {
  photo: Photo;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const hasMultiple = total > 1;
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

      <div className="absolute left-4 top-4 flex items-center gap-2">
        {hasMultiple ? (
          <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs tabular-nums text-white/80">
            {index + 1} / {total}
          </span>
        ) : null}
        {dateTaken ? (
          <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/80">
            {dateTaken}
          </span>
        ) : null}
      </div>

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
          className="max-h-[80vh] w-auto max-w-full rounded-lg object-contain"
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

// Move one photo (with a preview thumbnail) or a selected batch to another
// destination or experience. One dialog serves both flows.
function RetagDialog({
  title,
  description,
  photo,
  destinations,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  photo?: Photo;
  destinations: RetagDestination[];
  busy?: boolean;
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
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {photo ? (
            <div className="h-24 w-full overflow-hidden rounded-md bg-white/5">
              <SafeImage
                src={getPhotoUrl(photo)}
                alt=""
                loading="eager"
                className="size-full object-cover"
              />
            </div>
          ) : null}

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

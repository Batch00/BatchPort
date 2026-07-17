"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDownIcon, PlusIcon } from "lucide-react";

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
  BucketCard,
  type BucketTripCover,
} from "@/components/bucket-list/bucket-card";
import { BucketItemDialog } from "@/components/bucket-list/bucket-item-dialog";
import {
  FulfillDialog,
  type TripOption,
} from "@/components/bucket-list/fulfill-dialog";
import {
  deleteBucketItem,
  reorderBucketItems,
  unfulfillBucketItem,
} from "@/lib/actions/bucket-list";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { bucketItemName } from "@/lib/bucket-format";
import {
  bucketItemDiscoveryTarget,
  useDiscovery,
} from "@/components/discover/discovery-host";
import { cn } from "@/lib/utils";
import type {
  BucketItem,
  BucketStats,
  CountryOption,
} from "@/lib/bucket-list";

interface BucketListBoardProps {
  items: BucketItem[];
  /** Fulfilling-trip covers for completed items, keyed by item id. */
  tripCovers: Record<string, BucketTripCover>;
  countries: CountryOption[];
  trips: TripOption[];
  stats: BucketStats | null;
  isDemo: boolean;
}

const COMPLETED_PREVIEW_COUNT = 6;

export function BucketListBoard({
  items,
  tripCovers,
  countries,
  trips,
  stats,
  isDemo,
}: BucketListBoardProps) {
  const router = useRouter();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<BucketItem | null>(null);

  const [fulfillOpen, setFulfillOpen] = useState(false);
  const [fulfillingItem, setFulfillingItem] = useState<BucketItem | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingItem, setDeletingItem] = useState<BucketItem | null>(null);
  const [busy, setBusy] = useState(false);

  const [showAllCompleted, setShowAllCompleted] = useState(false);
  // The page-level discovery host renders the panel; the board only opens it.
  const { open: openDiscover } = useDiscovery();

  const toVisit = useMemo(
    () => items.filter((item) => !item.fulfilled_at),
    [items],
  );
  const completed = useMemo(
    () =>
      items
        .filter((item) => item.fulfilled_at)
        .sort((a, b) =>
          (b.fulfilled_at ?? "").localeCompare(a.fulfilled_at ?? ""),
        ),
    [items],
  );
  const pct = stats?.completion_pct ?? 0;

  // --- Drag-to-rank (pointer events, mirroring the photo gallery reorder:
  // mouse drags start after a movement threshold so clicks still open
  // discovery; touch drags start after a long press so the grid scrolls). ---

  const [viewOrder, setViewOrder] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const tileRefs = useRef(new Map<string, HTMLDivElement>());
  const suppressClickRef = useRef(false);
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

  // Drop any optimistic order once the server data changes (the React pattern
  // for deriving state from props without an effect).
  const itemIdsKey = toVisit.map((item) => item.id).join("|");
  const [prevIdsKey, setPrevIdsKey] = useState(itemIdsKey);
  if (prevIdsKey !== itemIdsKey) {
    setPrevIdsKey(itemIdsKey);
    setViewOrder(null);
  }

  const orderedToVisit = useMemo(() => {
    if (!viewOrder) return toVisit;
    const byId = new Map(toVisit.map((item) => [item.id, item]));
    return viewOrder
      .map((id) => byId.get(id))
      .filter((item): item is BucketItem => Boolean(item));
  }, [toVisit, viewOrder]);

  // Latest order, readable from window-level drag listeners.
  const orderedIdsRef = useRef<string[]>(orderedToVisit.map((item) => item.id));
  useEffect(() => {
    orderedIdsRef.current = orderedToVisit.map((item) => item.id);
  });

  async function commitOrder(newIds: string[], previous: string[]) {
    if (newIds.join("|") === previous.join("|")) return;
    if (isDemo) {
      toast.error(DEMO_READONLY_MESSAGE);
      setViewOrder(previous);
      return;
    }
    const result = await reorderBucketItems(newIds).catch(() => ({
      error: "Could not save the new order.",
    }));
    if ("error" in result) {
      toast.error(result.error);
      setViewOrder(previous);
      return;
    }
    router.refresh();
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
    if (state && state.longPress !== null) window.clearTimeout(state.longPress);
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

  function beginDrag(event: React.PointerEvent, itemId: string) {
    if (toVisit.length < 2) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (dragRef.current) return;

    const isMouse = event.pointerType === "mouse";
    const state = {
      id: itemId,
      startX: event.clientX,
      startY: event.clientY,
      activated: false,
      longPress: null as number | null,
      preDragOrder: orderedIdsRef.current,
    };
    dragRef.current = state;

    const activate = () => {
      const current = dragRef.current;
      if (!current || current.activated) return;
      current.activated = true;
      suppressClickRef.current = true;
      setDraggingId(current.id);
    };

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
          if (distance > 6) activate();
        } else if (distance > 10) {
          // Touch moved before the long press fired: it is a scroll.
          endDrag(false);
        }
        if (!dragRef.current?.activated) return;
      }
      const over = hitTestTile(moveEvent.clientX, moveEvent.clientY);
      if (!over || over === current.id) return;
      const ids = orderedIdsRef.current;
      const from = ids.indexOf(current.id);
      const to = ids.indexOf(over);
      if (from === -1 || to === -1 || from === to) return;
      const next = [...ids];
      next.splice(from, 1);
      next.splice(to, 0, current.id);
      setViewOrder(next);
    };

    dragListenersRef.current = {
      move,
      up: () => endDrag(true),
      cancel: () => endDrag(false),
      preventTouch,
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", dragListenersRef.current.up);
    window.addEventListener("pointercancel", dragListenersRef.current.cancel);
    if (!isMouse) {
      document.addEventListener("touchmove", preventTouch, { passive: false });
      state.longPress = window.setTimeout(activate, 250);
    }
  }

  function registerTile(id: string) {
    return (el: HTMLDivElement | null) => {
      if (el) tileRefs.current.set(id, el);
      else tileRefs.current.delete(id);
    };
  }

  // --- Actions ---

  function openAdd() {
    setEditingItem(null);
    setDialogOpen(true);
  }

  function openEdit(item: BucketItem) {
    setEditingItem(item);
    setDialogOpen(true);
  }

  function openFulfill(item: BucketItem) {
    setFulfillingItem(item);
    setFulfillOpen(true);
  }

  async function handleUndo(item: BucketItem) {
    if (isDemo) {
      toast.error(DEMO_READONLY_MESSAGE);
      return;
    }
    const result = await unfulfillBucketItem(item.id);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success("Moved back to your list.");
    router.refresh();
  }

  function openDelete(item: BucketItem) {
    setDeletingItem(item);
    setDeleteOpen(true);
  }

  async function confirmDelete() {
    if (!deletingItem) return;
    if (isDemo) {
      toast.error(DEMO_READONLY_MESSAGE);
      setDeleteOpen(false);
      return;
    }
    setBusy(true);
    const result = await deleteBucketItem(deletingItem.id);
    setBusy(false);
    setDeleteOpen(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success("Removed from your bucket list.");
    router.refresh();
  }

  // Clicking a card opens discovery: country items on the country view, place
  // items straight on the city view (with stored coordinates when present).
  function openDiscovery(item: BucketItem) {
    const target = bucketItemDiscoveryTarget(item);
    if (target) openDiscover(target);
  }

  const visibleCompleted = showAllCompleted
    ? completed
    : completed.slice(0, COMPLETED_PREVIEW_COUNT);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Bucket List</h1>
          <p className="text-sm text-muted-foreground">
            {stats && stats.total > 0
              ? `${stats.fulfilled} of ${stats.total} completed (${stats.completion_pct}%)`
              : "Places and countries you want to reach"}
          </p>
          {stats && stats.total > 0 ? (
            <div className="h-2 w-56 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-brand transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          ) : null}
        </div>
        <Button
          onClick={openAdd}
          className="bg-brand text-brand-foreground hover:bg-brand/90"
        >
          <PlusIcon />
          Add to bucket list
        </Button>
      </header>

      <section>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-foreground/80">
            To Visit{toVisit.length > 0 ? ` (${toVisit.length})` : ""}
          </h2>
          {toVisit.length > 1 ? (
            <p className="text-xs text-foreground/40">
              Drag cards to rank them
            </p>
          ) : null}
        </div>
        {toVisit.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 px-6 py-12 text-center text-sm text-foreground/60">
            Nothing on your list yet. Add a country or a place you want to reach.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {orderedToVisit.map((item, index) => (
              <div
                key={item.id}
                ref={registerTile(item.id)}
                onPointerDown={(event) => beginDrag(event, item.id)}
                onDragStart={(event) => event.preventDefault()}
                onClickCapture={(event) => {
                  if (suppressClickRef.current) {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                }}
                className={cn(draggingId === item.id && "touch-none")}
              >
                <BucketCard
                  item={item}
                  rank={index + 1}
                  dragging={draggingId === item.id}
                  onOpen={() => openDiscovery(item)}
                  onEdit={() => openEdit(item)}
                  onFulfill={() => openFulfill(item)}
                  onUndo={() => handleUndo(item)}
                  onDelete={() => openDelete(item)}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {completed.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-medium text-foreground/80">
            Completed ({completed.length})
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleCompleted.map((item) => (
              <BucketCard
                key={item.id}
                item={item}
                tripCover={tripCovers[item.id] ?? null}
                onOpen={() => openDiscovery(item)}
                onEdit={() => openEdit(item)}
                onFulfill={() => openFulfill(item)}
                onUndo={() => handleUndo(item)}
                onDelete={() => openDelete(item)}
              />
            ))}
          </div>
          {completed.length > COMPLETED_PREVIEW_COUNT ? (
            <button
              type="button"
              onClick={() => setShowAllCompleted((value) => !value)}
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-foreground/60 transition-colors hover:text-foreground"
            >
              {showAllCompleted
                ? "Show fewer"
                : `Show all ${completed.length}`}
              <ChevronDownIcon
                className={cn(
                  "size-3.5 transition-transform",
                  showAllCompleted && "rotate-180",
                )}
              />
            </button>
          ) : null}
        </section>
      ) : null}

      <BucketItemDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        item={editingItem}
        countries={countries}
        isDemo={isDemo}
        onSaved={() => router.refresh()}
      />

      {fulfillingItem ? (
        <FulfillDialog
          open={fulfillOpen}
          onOpenChange={setFulfillOpen}
          item={fulfillingItem}
          trips={trips}
          isDemo={isDemo}
          onFulfilled={() => router.refresh()}
        />
      ) : null}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this item?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingItem ? bucketItemName(deletingItem) : "This item"} will be
              removed from your bucket list. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                confirmDelete();
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}

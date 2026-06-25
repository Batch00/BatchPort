"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";

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
import { BucketItemCard } from "@/components/bucket-list/bucket-item-card";
import { BucketItemDialog } from "@/components/bucket-list/bucket-item-dialog";
import {
  FulfillDialog,
  type TripOption,
} from "@/components/bucket-list/fulfill-dialog";
import { deleteBucketItem, unfulfillBucketItem } from "@/lib/actions/bucket-list";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { bucketItemName } from "@/lib/bucket-format";
import type {
  BucketItem,
  BucketStats,
  CountryOption,
} from "@/lib/bucket-list";

interface BucketListBoardProps {
  items: BucketItem[];
  countries: CountryOption[];
  trips: TripOption[];
  stats: BucketStats | null;
  isDemo: boolean;
}

export function BucketListBoard({
  items,
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

  const toVisit = items.filter((item) => !item.fulfilled_at);
  const completed = items.filter((item) => item.fulfilled_at);
  const pct = stats?.completion_pct ?? 0;

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
        <h2 className="mb-3 text-sm font-medium text-foreground/80">
          To Visit{toVisit.length > 0 ? ` (${toVisit.length})` : ""}
        </h2>
        {toVisit.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 px-6 py-12 text-center text-sm text-foreground/60">
            Nothing on your list yet. Add a country or a place you want to reach.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {toVisit.map((item) => (
              <BucketItemCard
                key={item.id}
                item={item}
                onEdit={() => openEdit(item)}
                onFulfill={() => openFulfill(item)}
                onUndo={() => handleUndo(item)}
                onDelete={() => openDelete(item)}
              />
            ))}
          </div>
        )}
      </section>

      {completed.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-medium text-foreground/80">
            Completed ({completed.length})
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {completed.map((item) => (
              <BucketItemCard
                key={item.id}
                item={item}
                onEdit={() => openEdit(item)}
                onFulfill={() => openFulfill(item)}
                onUndo={() => handleUndo(item)}
                onDelete={() => openDelete(item)}
              />
            ))}
          </div>
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

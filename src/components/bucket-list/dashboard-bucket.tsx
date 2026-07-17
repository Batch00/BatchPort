"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRightIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ListChecksIcon,
} from "lucide-react";

import { Card } from "@/components/ui/card";
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
import { BucketCard } from "@/components/bucket-list/bucket-card";
import { BucketItemDialog } from "@/components/bucket-list/bucket-item-dialog";
import {
  FulfillDialog,
  type TripOption,
} from "@/components/bucket-list/fulfill-dialog";
import { BucketProgress } from "@/components/stats/bucket-progress";
import {
  bucketItemDiscoveryTarget,
  useDiscovery,
} from "@/components/discover/discovery-host";
import { deleteBucketItem } from "@/lib/actions/bucket-list";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { bucketItemName } from "@/lib/bucket-format";
import { cn } from "@/lib/utils";
import type {
  BucketItem,
  BucketStats,
  CountryOption,
} from "@/lib/bucket-list";

// The dashboard's Bucket list section: the completion ring (linking to the
// full page) plus a disclosure that expands the top-ranked To Visit items as
// the same fully interactive cards the bucket page uses. Clicks open the
// page's shared discovery host; the corner menu edits, fulfills, or deletes.
// Drag-to-rank stays on the bucket page; this grid is display-ordered.

const PREVIEW_COUNT = 6;
// Session-scoped memory for the disclosure, so the expansion survives
// navigating away and back without persisting anything.
const EXPANDED_KEY = "batchport:dashboard-bucket-expanded";

interface DashboardBucketProps {
  /** Unfulfilled items in ranked order (the data layer's display order). */
  toVisit: BucketItem[];
  stats: BucketStats | null;
  countries: CountryOption[];
  trips: TripOption[];
  isDemo: boolean;
}

export function DashboardBucket({
  toVisit,
  stats,
  countries,
  trips,
  isDemo,
}: DashboardBucketProps) {
  const router = useRouter();
  const { open: openDiscover } = useDiscovery();

  const [expanded, setExpanded] = useState(false);
  const [editingItem, setEditingItem] = useState<BucketItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [fulfillingItem, setFulfillingItem] = useState<BucketItem | null>(null);
  const [fulfillOpen, setFulfillOpen] = useState(false);
  const [deletingItem, setDeletingItem] = useState<BucketItem | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Restore the session's disclosure state after mount (reading it during
  // render would mismatch the server-rendered collapsed state).
  useEffect(() => {
    if (window.sessionStorage.getItem(EXPANDED_KEY) !== "1") return;
    const frame = requestAnimationFrame(() => setExpanded(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  function toggleExpanded() {
    setExpanded((value) => {
      window.sessionStorage.setItem(EXPANDED_KEY, value ? "0" : "1");
      return !value;
    });
  }

  function openDiscovery(item: BucketItem) {
    const target = bucketItemDiscoveryTarget(item);
    if (target) openDiscover(target);
  }

  function openEdit(item: BucketItem) {
    setEditingItem(item);
    setDialogOpen(true);
  }

  function openFulfill(item: BucketItem) {
    setFulfillingItem(item);
    setFulfillOpen(true);
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

  const hasBucket = Boolean(stats && stats.total > 0);
  const visible = toVisit.slice(0, PREVIEW_COUNT);

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium text-foreground/80">Bucket list</h2>
        {toVisit.length > 0 ? (
          <button
            type="button"
            onClick={toggleExpanded}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1 text-sm text-brand underline-offset-4 transition-colors hover:underline"
          >
            {expanded ? "Hide top picks" : "Show top picks"}
            <ChevronDownIcon
              className={cn(
                "size-4 transition-transform",
                expanded && "rotate-180",
              )}
            />
          </button>
        ) : null}
      </div>

      {hasBucket && stats ? (
        <Link
          href="/dashboard/bucket-list"
          className="block transition-opacity hover:opacity-90"
        >
          <BucketProgress bucket={stats} heading={false} />
        </Link>
      ) : (
        <Link href="/dashboard/bucket-list" className="group block">
          <Card className="flex flex-row items-center justify-between gap-4 p-4 transition-all group-hover:ring-brand/40">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                <ListChecksIcon className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Start your bucket list
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  Plan the countries and places you want to reach next.
                </p>
              </div>
            </div>
            <ChevronRightIcon className="size-4 shrink-0 text-foreground/40" />
          </Card>
        </Link>
      )}

      {expanded && toVisit.length > 0 ? (
        <div className="mt-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((item, index) => (
              <BucketCard
                key={item.id}
                item={item}
                rank={index + 1}
                onOpen={() => openDiscovery(item)}
                onEdit={() => openEdit(item)}
                onFulfill={() => openFulfill(item)}
                onDelete={() => openDelete(item)}
              />
            ))}
          </div>
          {toVisit.length > PREVIEW_COUNT ? (
            <Link
              href="/dashboard/bucket-list"
              className="mt-3 inline-flex items-center gap-1 text-sm text-brand underline-offset-4 transition-colors hover:underline"
            >
              View all {toVisit.length}
              <ArrowRightIcon className="size-4" />
            </Link>
          ) : null}
        </div>
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
    </section>
  );
}

"use client";

import { useMemo, useState } from "react";
import { ChevronDownIcon } from "lucide-react";

import { BucketCard } from "@/components/bucket-list/bucket-card";
import { cn } from "@/lib/utils";
import type { BucketItem } from "@/lib/bucket-list";
import type { BucketCompletion } from "@/lib/stats-data";
import type { SharedBucketCover } from "@/lib/share-data";

// The read-only bucket list on the share and demo surfaces: the same visual
// card grid as the authenticated bucket page (BucketCard in readOnly mode),
// with no mutations, no drag, no menus, and no links into protected routes.
// Long lists start capped so the share page stays a tight story.

const PREVIEW_COUNT = 6;

interface SharedBucketListProps {
  items: BucketItem[];
  tripCovers: Record<string, SharedBucketCover>;
  bucket: BucketCompletion | null;
}

function ExpandableGrid({
  items,
  tripCovers,
  ranked,
}: {
  items: BucketItem[];
  tripCovers: Record<string, SharedBucketCover>;
  ranked: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, PREVIEW_COUNT);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((item, index) => (
          <BucketCard
            key={item.id}
            item={item}
            rank={ranked ? index + 1 : null}
            tripCover={tripCovers[item.id] ?? null}
            readOnly
          />
        ))}
      </div>
      {items.length > PREVIEW_COUNT ? (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-foreground/60 transition-colors hover:text-foreground"
        >
          {showAll ? "Show fewer" : `Show all ${items.length}`}
          <ChevronDownIcon
            className={cn("size-3.5 transition-transform", showAll && "rotate-180")}
          />
        </button>
      ) : null}
    </>
  );
}

export function SharedBucketList({
  items,
  tripCovers,
  bucket,
}: SharedBucketListProps) {
  // The data layer already orders unfulfilled items by rank (priority desc).
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

  if (items.length === 0) return null;
  const pct = Math.max(0, Math.min(100, bucket?.completion_pct ?? 0));

  return (
    <section>
      <div className="mb-4 flex flex-col gap-2">
        <h2 className="text-sm font-medium text-foreground/80">Bucket list</h2>
        {bucket && bucket.total > 0 ? (
          <>
            <p className="text-xs text-foreground/50">
              {bucket.fulfilled} of {bucket.total} completed ({pct}%)
            </p>
            <div className="h-1.5 w-56 max-w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${pct}%` }}
              />
            </div>
          </>
        ) : null}
      </div>

      <div className="flex flex-col gap-6">
        {toVisit.length > 0 ? (
          <div>
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-foreground/45">
              To visit ({toVisit.length})
            </h3>
            <ExpandableGrid items={toVisit} tripCovers={tripCovers} ranked />
          </div>
        ) : null}

        {completed.length > 0 ? (
          <div>
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-foreground/45">
              Completed ({completed.length})
            </h3>
            <ExpandableGrid
              items={completed}
              tripCovers={tripCovers}
              ranked={false}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

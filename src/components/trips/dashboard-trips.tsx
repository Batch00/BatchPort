"use client";

import { useState } from "react";
import Link from "next/link";
import { PlusIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DashboardTripCard } from "@/components/trips/dashboard-trip-card";
import { cn } from "@/lib/utils";
import type { ProfileTrip, SharedTripExpenses } from "@/lib/share-data";

type SortKey = "newest" | "oldest" | "name";

const SORT_LABELS: Record<SortKey, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  name: "Name A to Z",
};

function sortTrips(trips: ProfileTrip[], sort: SortKey): ProfileTrip[] {
  const copy = [...trips];
  if (sort === "name") {
    return copy.sort((a, b) => a.name.localeCompare(b.name));
  }
  return copy.sort((a, b) => {
    const aStart = a.start_date ?? "";
    const bStart = b.start_date ?? "";
    // Trips without a start date sort last either way.
    if (aStart === bStart) return 0;
    if (!aStart) return 1;
    if (!bStart) return -1;
    if (sort === "newest") return aStart < bStart ? 1 : -1;
    return aStart < bStart ? -1 : 1;
  });
}

// The dashboard trips section. Client-side so the user can reorder the cards
// with the sort dropdown without a round trip. Defaults to newest first.
export function DashboardTrips({
  trips,
  spend,
}: {
  trips: ProfileTrip[];
  /** Per-trip spending keyed by trip id, or an empty object when expenses are
   * not set up. Passed as a plain object rather than a Map so it crosses the
   * server boundary. */
  spend?: Record<string, SharedTripExpenses>;
}) {
  const [sort, setSort] = useState<SortKey>("newest");
  const sorted = sortTrips(trips, sort);

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground/80">Trips</h2>
        <div className="flex items-center gap-2">
          {trips.length > 1 ? (
            <Select
              value={sort}
              onValueChange={(value) => setSort(value as SortKey)}
            >
              <SelectTrigger
                className="h-7 w-auto gap-1.5 text-xs"
                aria-label="Sort trips"
              >
                <span className="text-foreground/50">Sort:</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {SORT_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Link
            href="/trips/new"
            className={cn(
              buttonVariants({ size: "sm" }),
              "bg-brand text-brand-foreground hover:bg-brand/90",
            )}
          >
            <PlusIcon />
            Add trip
          </Link>
        </div>
      </div>

      {sorted.length === 0 ? (
        <Link
          href="/trips/new"
          className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-white/10 px-6 py-12 text-center text-sm text-foreground/60 transition-colors hover:border-white/25 hover:text-foreground/80"
        >
          <span>No trips yet.</span>
          <span className="text-brand">Add your first trip to get started.</span>
        </Link>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {sorted.map((trip) => (
            <DashboardTripCard
              key={trip.id}
              trip={trip}
              spend={spend?.[trip.id] ?? null}
            />
          ))}
        </div>
      )}
    </section>
  );
}

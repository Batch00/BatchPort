"use client";

import { useState } from "react";
import { ChevronRightIcon } from "lucide-react";

import { GroupDot } from "@/components/expenses/category-picker";
import {
  formatUsd,
  type CategorySpend,
  type GroupSpend,
} from "@/lib/expenses";
import { cn } from "@/lib/utils";

// Where the money went, at two levels.
//
// The bar and its legend are the group level; clicking a group opens its
// categories. The drill-down is the payoff for the two-level taxonomy: the
// whole argument for it was that a flat four-bucket list hid 46 percent of a
// trip inside one Travel bar, and a group total nobody can open is the same
// problem one level up.
//
// Groups with a NEGATIVE total (a group of pure refunds, which is possible)
// get no width in the bar, because a negative width is nonsense, but they keep
// their legend row so the money is not silently dropped.

export function GroupBreakdown({
  groups,
  categories,
}: {
  groups: GroupSpend[];
  /** Null when the read failed. The drill-down is then unavailable and the
   * group rows simply do not expand, rather than opening onto nothing. */
  categories: CategorySpend[] | null;
}) {
  const [open, setOpen] = useState<string | null>(null);

  const positive = groups.filter((group) => group.totalUsd > 0);
  const total = positive.reduce((sum, group) => sum + group.totalUsd, 0);

  return (
    <div className="flex flex-col gap-2">
      {total > 0 ? (
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/5">
          {positive.map((group) => (
            <div
              key={group.groupSlug}
              style={{
                width: `${(group.totalUsd / total) * 100}%`,
                backgroundColor: group.groupColor ?? "rgba(255,255,255,0.25)",
              }}
              title={`${group.groupLabel} ${formatUsd(group.totalUsd)}`}
            />
          ))}
        </div>
      ) : null}

      <ul className="flex flex-col">
        {groups.map((group) => {
          const own = (categories ?? []).filter(
            (category) => category.groupSlug === group.groupSlug,
          );
          const expandable = own.length > 0;
          const isOpen = open === group.groupSlug;
          return (
            <li key={group.groupSlug}>
              <button
                type="button"
                disabled={!expandable}
                onClick={() => setOpen(isOpen ? null : group.groupSlug)}
                aria-expanded={expandable ? isOpen : undefined}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-xs transition-colors",
                  expandable ? "hover:bg-white/5" : "cursor-default",
                )}
              >
                <ChevronRightIcon
                  className={cn(
                    "size-3 shrink-0 transition-transform",
                    expandable ? "text-foreground/40" : "text-transparent",
                    isOpen && "rotate-90",
                  )}
                />
                <GroupDot color={group.groupColor} />
                <span className="text-foreground/75">{group.groupLabel}</span>
                <span className="tabular-nums text-foreground/90">
                  {formatUsd(group.totalUsd)}
                </span>
                {group.pctOfTrip !== null ? (
                  <span className="text-foreground/40">{group.pctOfTrip}%</span>
                ) : null}
                <span className="ml-auto text-foreground/30">
                  {group.txnCount}
                </span>
              </button>

              {isOpen ? (
                <ul className="mb-1 ml-6 flex flex-col gap-0.5 border-l border-white/10 pl-3">
                  {own.map((category) => (
                    <li
                      key={category.categorySlug}
                      className="flex items-baseline gap-2 text-xs"
                    >
                      <span className="min-w-0 flex-1 truncate text-foreground/60">
                        {category.categoryLabel}
                      </span>
                      <span className="shrink-0 tabular-nums text-foreground/80">
                        {formatUsd(category.totalUsd)}
                      </span>
                      <span className="w-6 shrink-0 text-right text-foreground/30">
                        {category.txnCount}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

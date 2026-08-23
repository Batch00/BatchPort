"use client";

import { useMemo, useState } from "react";
import { ChevronDownIcon, SearchIcon, XIcon } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  categoryGroups,
  type ExpenseCategory,
} from "@/lib/expenses";
import { cn } from "@/lib/utils";

// The category picker.
//
// 26 categories is a lot to scan on a phone, and the argument for keeping all
// 26 rather than collapsing the taxonomy was that the picker would be RANKED
// rather than alphabetical. This is that ranking, and it is the reason a plain
// Select is not used here:
//
//   1. The categories this trip has already used come first, most used first.
//      A city break and a hiking trip spend differently, and the trip in hand
//      is a better predictor than an all-time frequency.
//   2. Everything else follows, grouped in the order the taxonomy was
//      designed, so the full list is always reachable without a search.
//   3. Typing filters, for the traveller who knows what they want.
//
// Colour comes from the GROUP, not the category. Five colours a reader can
// learn beats 26 they cannot, and it matches how the app already teaches
// transport families with a dot in the matching arc colour.
//
// Choosing nothing is a first-class outcome, not a failure to choose:
// category_id is nullable because amount plus vendor plus Enter has to be a
// complete write. The clear control says so rather than hiding.

export function CategoryPicker({
  categories,
  frequentIds,
  value,
  onChange,
  disabled,
  className,
}: {
  categories: ExpenseCategory[];
  /** Category ids this trip uses most, in order. */
  frequentIds: string[];
  value: string | null;
  onChange: (categoryId: string | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const byId = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );
  const selected = value ? byId.get(value) ?? null : null;

  const frequent = useMemo(
    () =>
      frequentIds
        .map((id) => byId.get(id))
        .filter((category): category is ExpenseCategory => Boolean(category)),
    [frequentIds, byId],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return null;
    return categories.filter(
      (category) =>
        category.label.toLowerCase().includes(needle) ||
        category.groupLabel.toLowerCase().includes(needle),
    );
  }, [categories, query]);

  const groups = useMemo(() => categoryGroups(categories), [categories]);

  function pick(categoryId: string | null) {
    onChange(categoryId);
    setQuery("");
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <GroupDot color={selected?.groupColor ?? null} />
            <span className={cn("truncate", !selected && "text-muted-foreground")}>
              {selected ? selected.label : "Category"}
            </span>
          </span>
          <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="max-h-[min(60vh,26rem)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto p-2"
      >
        <div className="relative mb-2">
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search categories"
            className="h-8 pl-7 text-sm"
            autoFocus
          />
        </div>

        {value !== null ? (
          <button
            type="button"
            onClick={() => pick(null)}
            className="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-white/5"
          >
            <XIcon className="size-3.5" />
            Clear, leave uncategorized
          </button>
        ) : null}

        {filtered ? (
          <Section
            title={filtered.length === 0 ? "No match" : "Matches"}
            categories={filtered}
            value={value}
            onPick={pick}
          />
        ) : (
          <>
            {frequent.length > 0 ? (
              <Section
                title="Used on this trip"
                categories={frequent}
                value={value}
                onPick={pick}
              />
            ) : null}
            {groups.map((group) => (
              <Section
                key={group.groupSlug}
                title={group.groupLabel}
                categories={group.categories}
                value={value}
                onPick={pick}
              />
            ))}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function Section({
  title,
  categories,
  value,
  onPick,
}: {
  title: string;
  categories: ExpenseCategory[];
  value: string | null;
  onPick: (categoryId: string) => void;
}) {
  return (
    <div className="mb-1.5 last:mb-0">
      <p className="px-2 py-1 text-[0.7rem] font-medium uppercase tracking-wide text-foreground/40">
        {title}
      </p>
      {categories.map((category) => (
        <button
          key={category.id}
          type="button"
          onClick={() => onPick(category.id)}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-white/5",
            value === category.id && "bg-brand/15 text-brand",
          )}
        >
          <GroupDot color={category.groupColor} />
          <span className="truncate">{category.label}</span>
        </button>
      ))}
    </div>
  );
}

export function GroupDot({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden
      className="size-2 shrink-0 rounded-full"
      style={{ backgroundColor: color ?? "rgba(255,255,255,0.25)" }}
    />
  );
}

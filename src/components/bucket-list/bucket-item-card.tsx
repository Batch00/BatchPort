"use client";

import Link from "next/link";
import {
  CalendarIcon,
  CheckIcon,
  MapPinIcon,
  MoreVerticalIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { bucketItemName, priorityLabel } from "@/lib/bucket-format";
import { flagEmoji, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BucketItem } from "@/lib/bucket-list";

interface BucketItemCardProps {
  item: BucketItem;
  onEdit: () => void;
  onFulfill: () => void;
  onUndo: () => void;
  onDelete: () => void;
}

export function BucketItemCard({
  item,
  onEdit,
  onFulfill,
  onUndo,
  onDelete,
}: BucketItemCardProps) {
  const fulfilled = Boolean(item.fulfilled_at);
  const name = bucketItemName(item);
  const priority = priorityLabel(item.priority);

  // Place items show their country as a subtitle; country items lead with the
  // flag, place items with a pin.
  const subtitle =
    item.type === "place" ? item.country_name ?? null : null;

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-colors",
        fulfilled && "bg-card/50",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-lg">
        {item.type === "country" && item.country_code ? (
          flagEmoji(item.country_code)
        ) : (
          <MapPinIcon className="size-4 text-brand" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3
            className={cn(
              "truncate font-medium text-foreground",
              fulfilled && "text-foreground/60 line-through",
            )}
          >
            {name}
          </h3>
          {fulfilled ? (
            <CheckIcon className="size-4 shrink-0 text-brand" />
          ) : null}
        </div>

        {subtitle ? (
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        ) : null}

        {fulfilled ? (
          <p className="mt-1 text-xs text-foreground/55">
            {item.fulfilled_trip_id ? (
              <>
                Completed on{" "}
                <Link
                  href={`/trips/${item.fulfilled_trip_id}`}
                  className="font-medium text-brand hover:underline"
                >
                  {item.fulfilled_trip_name ?? "a trip"}
                </Link>
              </>
            ) : (
              "Completed"
            )}
            {item.fulfilled_at ? ` on ${formatDate(item.fulfilled_at.slice(0, 10))}` : ""}
          </p>
        ) : (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {priority ? (
              <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[0.7rem] font-medium text-brand">
                {priority}
              </span>
            ) : null}
            {item.target_date ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[0.7rem] text-foreground/55">
                <CalendarIcon className="size-3" />
                {formatDate(item.target_date)}
              </span>
            ) : null}
          </div>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Item options"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground/50 transition-colors hover:bg-white/5 hover:text-foreground data-[state=open]:bg-white/5"
          >
            <MoreVerticalIcon className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {fulfilled ? (
            <DropdownMenuItem onSelect={onUndo}>
              <RotateCcwIcon />
              Undo completion
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem onSelect={onEdit}>
                <PencilIcon />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onFulfill}>
                <CheckIcon />
                Mark as completed
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

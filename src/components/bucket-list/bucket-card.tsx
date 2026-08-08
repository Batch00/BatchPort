"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CalendarIcon,
  CheckIcon,
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
import { SafeImage } from "@/components/photos/safe-image";
import { StatusBadge } from "@/components/trips/status-badge";
import { bucketItemName } from "@/lib/bucket-format";
import {
  bucketHeroKey,
  cachedBucketHero,
  fetchBucketHero,
  hasCachedBucketHero,
  rememberBucketHero,
  type BucketHeroKey,
} from "@/lib/bucket-hero";
import { coverImageStyle } from "@/lib/photos";
import { CountryFlag } from "@/components/country-flag";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BucketItem } from "@/lib/bucket-list";
import type { CoverPosition } from "@/lib/types";

// A visual bucket list card: Wikimedia hero (or the fulfilling trip's cover
// for completed items), name and flag over the usual dark gradient, target
// date and note. Clicking the card opens discovery; actions live in the
// corner menu so they never trigger the card click.

/** The fulfilling trip's cover, preferred over the stock photo. */
export interface BucketTripCover {
  url: string;
  position: CoverPosition | null;
}

interface BucketCardProps {
  item: BucketItem;
  /** 1-based rank among unfulfilled items; the top three get a pick chip. */
  rank?: number | null;
  tripCover?: BucketTripCover | null;
  dragging?: boolean;
  /**
   * Share/demo rendering: no corner menu, and the fulfilling trip renders as
   * plain text instead of a link into the authenticated app. The card is still
   * clickable when onOpen is provided (read-only discovery).
   */
  readOnly?: boolean;
  onOpen?: () => void;
  onEdit?: () => void;
  onFulfill?: () => void;
  onUndo?: () => void;
  onDelete?: () => void;
}

/** The lookup and its session cache live in lib/bucket-hero.ts: the recap's
 * closing slide shows the same places and has to show the same pictures. */
function heroKeyOf(item: BucketItem): BucketHeroKey {
  return {
    type: item.type,
    countryCode: item.country_code,
    placeName: item.place_name,
  };
}

export function BucketCard({
  item,
  rank = null,
  tripCover = null,
  dragging = false,
  readOnly = false,
  onOpen,
  onEdit,
  onFulfill,
  onUndo,
  onDelete,
}: BucketCardProps) {
  const fulfilled = Boolean(item.fulfilled_at);
  const name = bucketItemName(item);
  const cacheKey = bucketHeroKey(heroKeyOf(item));

  // The trip cover needs no lookup; only Wikimedia heroes are fetched.
  const [hero, setHero] = useState<string | null>(
    () => cachedBucketHero(cacheKey) ?? null,
  );
  const [heroSettled, setHeroSettled] = useState(
    () => Boolean(tripCover) || hasCachedBucketHero(cacheKey),
  );

  useEffect(() => {
    if (tripCover || hasCachedBucketHero(cacheKey)) return;
    let active = true;
    fetchBucketHero(heroKeyOf(item))
      .then((url) => {
        rememberBucketHero(cacheKey, url);
        if (active) {
          setHero(url);
          setHeroSettled(true);
        }
      })
      .catch(() => {
        if (active) setHeroSettled(true);
      });
    return () => {
      active = false;
    };
    // The identity of the lookup is fully captured by the cache key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, Boolean(tripCover)]);

  const imageUrl = tripCover?.url ?? hero;
  const subtitle = item.type === "place" ? item.country_name : null;

  return (
    <div
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? `Explore ${name}` : undefined}
      onClick={onOpen}
      onKeyDown={
        onOpen
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
      className={cn(
        "group relative isolate aspect-video overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10",
        onOpen &&
          "cursor-pointer transition-all hover:ring-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60",
        dragging && "opacity-60 ring-2 ring-brand",
      )}
    >
      {imageUrl ? (
        <SafeImage
          src={imageUrl}
          alt=""
          loading="lazy"
          style={tripCover ? coverImageStyle(tripCover.position) : undefined}
          className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
      ) : (
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center bg-gradient-to-br from-brand/20 via-[#101623] to-[#0a0a0a]",
            !heroSettled && "animate-pulse",
          )}
        >
          <span className="flex items-center opacity-40">
            {item.country_code ? (
              <CountryFlag
                code={item.country_code}
                className="h-12 rounded-md"
              />
            ) : (
              <span className="text-5xl">🌍</span>
            )}
          </span>
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/5" />

      {/* Rank chip for the top picks. */}
      {!fulfilled && rank !== null && rank <= 3 ? (
        <span className="absolute left-3 top-3 rounded-full border border-brand/30 bg-brand/20 px-2 py-0.5 text-[0.7rem] font-semibold text-brand backdrop-blur-sm">
          #{rank} pick
        </span>
      ) : null}
      {fulfilled ? (
        <span className="absolute left-3 top-3">
          <StatusBadge status="completed" />
        </span>
      ) : null}

      {/* Content */}
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 p-4 pr-10">
        <h3 className="flex min-w-0 items-center gap-2 text-base font-semibold tracking-tight text-white">
          {item.type === "country" ? (
            <CountryFlag code={item.country_code} className="h-4" />
          ) : null}
          <span className="truncate">{name}</span>
        </h3>
        {subtitle ? (
          <p className="truncate text-xs text-white/60">
            <CountryFlag code={item.country_code} className="h-3" /> {subtitle}
          </p>
        ) : null}

        {fulfilled ? (
          <p className="mt-0.5 truncate text-xs text-white/65">
            {item.fulfilled_trip_id ? (
              readOnly ? (
                // The share surface must not link into protected routes; the
                // trip name alone tells the story.
                <span className="font-medium text-brand">
                  {item.fulfilled_trip_name ?? "Completed"}
                </span>
              ) : (
                <Link
                  href={`/trips/${item.fulfilled_trip_id}`}
                  onClick={(event) => event.stopPropagation()}
                  className="font-medium text-brand hover:underline"
                >
                  {item.fulfilled_trip_name ?? "View trip"}
                </Link>
              )
            ) : (
              "Completed"
            )}
            {item.fulfilled_at
              ? ` · ${formatDate(item.fulfilled_at.slice(0, 10))}`
              : ""}
          </p>
        ) : (
          <>
            {item.target_date ? (
              <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-white/60">
                <CalendarIcon className="size-3" />
                by {formatDate(item.target_date)}
              </p>
            ) : null}
            {item.notes ? (
              <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-white/55">
                {item.notes}
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* Corner menu; every interaction inside stops the card click. */}
      {readOnly ? null : (
      <div
        className="absolute right-2 top-2"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Item options"
              className="flex size-9 items-center justify-center rounded-md bg-black/45 text-white/85 backdrop-blur transition-colors hover:bg-black/65 data-[state=open]:bg-black/65 sm:size-8"
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
      )}
    </div>
  );
}

"use client";

import { useRef, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";

// The app's single fullscreen photo viewer, shared by the gallery grids and
// the photo map. It renders one item at a time; the host owns the item set,
// the current index, and keyboard handling (Escape/arrows), so galleries with
// their own key handlers do not double-step.

export interface LightboxItem {
  src: string;
  dateTaken: string | null;
  attribution: string | null;
  /** Optional location context line (e.g. "Paris · Summer in Europe"). */
  caption?: string | null;
}

export function Lightbox({
  item,
  index,
  total,
  onPrev,
  onNext,
  onClose,
  actions,
}: {
  item: LightboxItem;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  /** Optional host-provided action row rendered under the image (e.g. the
   * photo map's "View in destination" link and location fix). */
  actions?: ReactNode;
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

  const dateTaken = item.dateTaken
    ? new Date(item.dateTaken).toLocaleDateString(undefined, {
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
      {/* The lightbox is a fixed full-viewport overlay, so its top controls
          need the status-bar inset just like page headers. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute right-4 top-[calc(1rem+env(safe-area-inset-top))] flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <XIcon className="size-5" />
      </button>

      <div className="absolute left-4 top-[calc(1rem+env(safe-area-inset-top))] flex max-w-[calc(100vw-5rem)] flex-wrap items-center gap-2">
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
        {item.caption ? (
          <span className="truncate rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/80">
            {item.caption}
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
          src={item.src}
          alt=""
          className="max-h-[80vh] w-auto max-w-full rounded-lg object-contain"
        />
        {item.attribution ? (
          <figcaption className="text-center text-xs text-white/60">
            {item.attribution}
          </figcaption>
        ) : null}
        {actions ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {actions}
          </div>
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

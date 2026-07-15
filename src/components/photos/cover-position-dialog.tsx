"use client";

import { useEffect, useRef, useState } from "react";
import { ZoomInIcon, ZoomOutIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { coverImageStyle, getPhotoUrl } from "@/lib/photos";
import type { CoverPosition, Photo } from "@/lib/types";

const MIN_COVER_SCALE = 1;
const MAX_COVER_SCALE = 3;

function clampScale(v: number): number {
  return Math.min(MAX_COVER_SCALE, Math.max(MIN_COVER_SCALE, v));
}

// Drag-and-zoom focal point picker for a cover photo. Used by the gallery's
// "Set as cover" flow and by the cover picker's "Edit position" flow.
export function CoverPositionDialog({
  photo,
  initialPosition,
  confirmLabel = "Set as cover",
  onConfirm,
  onCancel,
}: {
  photo: Photo;
  initialPosition?: CoverPosition | null;
  confirmLabel?: string;
  onConfirm: (position: CoverPosition) => void;
  onCancel: () => void;
}) {
  const [pos, setPos] = useState({
    x: initialPosition?.x ?? 50,
    y: initialPosition?.y ?? 50,
  });
  const [scale, setScale] = useState(() =>
    clampScale(initialPosition?.scale ?? 1),
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{
    mx: number;
    my: number;
    px: number;
    py: number;
  } | null>(null);
  // The drag math reads the current scale inside window-level listeners that
  // are registered once, so it comes from a ref to avoid stale closures.
  const scaleRef = useRef(scale);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  function clamp(v: number): number {
    return Math.min(100, Math.max(0, v));
  }

  // Dividing the pointer delta by the scale keeps the image tracking the
  // pointer 1:1 on screen: at 2x zoom the same focal-point shift moves the
  // rendered image twice as far.
  function applyDrag(clientX: number, clientY: number) {
    if (!dragStart.current || !containerRef.current) return;
    const { width, height } = containerRef.current.getBoundingClientRect();
    const s = scaleRef.current;
    const dx = clientX - dragStart.current.mx;
    const dy = clientY - dragStart.current.my;
    setPos({
      x: clamp(dragStart.current.px - (dx / (width * s)) * 100),
      y: clamp(dragStart.current.py - (dy / (height * s)) * 100),
    });
  }

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      applyDrag(e.clientX, e.clientY);
    }
    function onMouseUp() {
      dragStart.current = null;
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll-to-zoom. Attached natively because React registers onWheel as a
  // passive listener, which would ignore preventDefault and scroll the dialog.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      setScale((current) => clampScale(current - e.deltaY * 0.002));
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function onMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
  }

  function onTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    const touch = e.changedTouches[0];
    if (!touch) return;
    dragStart.current = {
      mx: touch.clientX,
      my: touch.clientY,
      px: pos.x,
      py: pos.y,
    };
  }

  function onTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    const touch = e.changedTouches[0];
    if (!touch) return;
    applyDrag(touch.clientX, touch.clientY);
  }

  function onTouchEnd() {
    dragStart.current = null;
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Position cover photo</DialogTitle>
          <DialogDescription>
            Drag to choose which part is shown, and zoom with the slider or
            scroll wheel.
          </DialogDescription>
        </DialogHeader>

        <div
          ref={containerRef}
          className="relative isolate aspect-[16/9] w-full cursor-move select-none overflow-hidden rounded-lg ring-1 ring-foreground/10"
          onMouseDown={onMouseDown}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={getPhotoUrl(photo)}
            alt=""
            draggable={false}
            style={coverImageStyle({ x: pos.x, y: pos.y, scale })}
            className="pointer-events-none size-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 border-2 border-brand/40" />
        </div>

        <div className="flex items-center gap-3">
          <ZoomOutIcon className="size-4 shrink-0 text-foreground/50" />
          <input
            type="range"
            min={MIN_COVER_SCALE}
            max={MAX_COVER_SCALE}
            step={0.05}
            value={scale}
            onChange={(e) => setScale(clampScale(Number(e.target.value)))}
            aria-label="Zoom"
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-brand"
          />
          <ZoomInIcon className="size-4 shrink-0 text-foreground/50" />
          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-foreground/50">
            {scale.toFixed(2)}x
          </span>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() =>
              onConfirm({
                x: Math.round(pos.x),
                y: Math.round(pos.y),
                scale: Math.round(scale * 100) / 100,
              })
            }
            className="bg-brand text-brand-foreground hover:bg-brand/90"
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

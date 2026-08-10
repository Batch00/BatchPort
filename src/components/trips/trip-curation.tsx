"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  GripVerticalIcon,
  SearchIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CategoryIcon } from "@/components/category-icon";
import { RatingDisplay } from "@/components/rating-display";
import { SafeImage } from "@/components/photos/safe-image";
import {
  setStopPhotosAction,
  setTripHeroPhotoAction,
  setTripHighlightsAction,
} from "@/lib/actions/curation";
import { SLOT_CAPACITY } from "@/lib/curation";
import {
  buildCurationSlots,
  describeStopSelection,
  hasCurationSlots,
  suggestStopCount,
  type HeroSlot,
  type HighlightsSlot,
  type SlotExperience,
  type SlotPhoto,
  type StopPhotoSlot,
} from "@/lib/curation-slots";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import type { StoryTrip } from "@/lib/story";
import { cn } from "@/lib/utils";

// The curation surface: three slots, each showing what is in it, what would be
// in it otherwise, and everything eligible to go in it.
//
// It is organised around the SLOTS rather than around the items, because that
// is the question a traveller is actually answering. "Feature this photo" told
// them nothing: featured where, in what order, instead of what? A slot names
// the surface, shows the current occupant, previews the automatic answer, and
// lists the candidates with their positions on them. Every one of those was
// invisible before.
//
// Writes are per slot and immediate. Each action sends the whole slot ("these
// three, in this order"), so reordering and clearing are the same call as
// choosing, there is no rank arithmetic anywhere on the client, and a failure
// rolls the slot back to what the server last confirmed.

const PANEL_SECTION = "rounded-xl border border-white/10 bg-white/[0.02]";

// --- What the dialog is allowed to render at once ---------------------------
//
// COST, AND WHY IT IS CAPPED HERE RATHER THAN LEFT TO THE BROWSER
//
// Radix mounts a dialog's whole subtree in one synchronous commit when it
// opens. The panel used to put every photo on the trip into the hero grid, and
// every photo of a stop into that stop's grid, so a trip with 300 photographs
// built 300+ tiles (600 on a single-stop trip, whose only section opened by
// default) before the dialog could paint. `loading="lazy"` defers the network
// fetch and nothing else: the elements, their React state, and their layout
// are all paid for up front, and the old skeleton-per-tile added 300 running
// CSS animations on top.
//
// So the panel is bounded three ways: a long section starts collapsed and
// mounts nothing, an open grid renders one page at a time, and a tile is a
// plain image rather than a component with three hooks and a pulse.

/** Candidate thumbnails revealed per page. Four rows on a phone, four on a
 * desktop grid of six. */
const PAGE_SIZE = 24;
/** Past this many candidates a section is long enough to open collapsed. */
const LONG_SECTION = 12;

// --- Shared bits ------------------------------------------------------------

/**
 * A grid thumbnail. Deliberately not SafeImage: one state hook and no skeleton
 * element, because this renders in the dozens and the placeholder is the
 * parent's background. It keeps the one behaviour that matters, falling back
 * to the full image when a thumbnail is missing from Storage.
 */
function Thumb({
  src,
  fallbackSrc,
  className,
}: {
  src: string;
  fallbackSrc?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const active = failed && fallbackSrc ? fallbackSrc : src;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={active}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}

/** A collapsible slot section: the summary is always readable, the contents
 * mount only once it is opened. The same disclosure the stop rows use, so the
 * whole panel reads as one list of things that can be folded away. */
function SlotSection({
  title,
  where,
  status,
  accent,
  summary,
  defaultOpen,
  children,
}: {
  title: string;
  where: string;
  status: string;
  /** True when the slot is doing something the traveller chose. */
  accent: boolean;
  /** A glance at what the slot currently resolves to, shown open or closed. */
  summary?: React.ReactNode;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={PANEL_SECTION}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 p-4 text-left sm:p-5"
      >
        <ChevronDownIcon
          className={cn(
            "mt-0.5 size-4 shrink-0 text-foreground/40 transition-transform",
            !open && "-rotate-90",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">
            {title}
          </span>
          <span className="mt-0.5 block text-xs text-foreground/45">
            {where}
          </span>
        </span>
        {summary}
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[0.7rem] font-medium",
            accent ? "bg-brand/15 text-brand" : "bg-white/[0.06] text-foreground/50",
          )}
        >
          {status}
        </span>
      </button>
      {open ? (
        <div className="border-t border-white/[0.07] p-4 sm:p-5">{children}</div>
      ) : null}
    </section>
  );
}

/** A strip of up to four thumbnails, as a section header's glance. */
function ThumbStrip({ photos, dim }: { photos: SlotPhoto[]; dim: boolean }) {
  if (photos.length === 0) return null;
  return (
    <span className="hidden shrink-0 -space-x-2 sm:flex">
      {photos.slice(0, 4).map((photo) => (
        <span
          key={photo.id}
          className={cn(
            "size-7 overflow-hidden rounded-md ring-2 ring-card",
            dim && "opacity-55",
          )}
        >
          <Thumb
            src={photo.thumbUrl}
            fallbackSrc={photo.url}
            className="size-full object-cover"
          />
        </span>
      ))}
    </span>
  );
}

/**
 * A candidate grid, one page at a time.
 *
 * Paging rather than virtualising: the tiles are a uniform square grid inside
 * a dialog that also runs pointer hit-testing for the reorder drag, and a
 * windowed list would have to lie about the scroll height for both. A button
 * that says how many are left is also the more honest interface on a gallery
 * of six hundred.
 */
function CandidateGrid({
  photos,
  positionOf,
  labelOf,
  onPick,
  disabled,
}: {
  photos: SlotPhoto[];
  positionOf: (photo: SlotPhoto) => number | null;
  labelOf: (photo: SlotPhoto, chosen: boolean) => string;
  onPick: (photo: SlotPhoto) => void;
  disabled?: boolean;
}) {
  const [shown, setShown] = useState(PAGE_SIZE);
  const visible = photos.slice(0, shown);
  const remaining = photos.length - visible.length;
  return (
    <>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {visible.map((photo) => {
          const position = positionOf(photo);
          return (
            <PhotoTile
              key={photo.id}
              photo={photo}
              position={position}
              disabled={disabled}
              label={labelOf(photo, position !== null)}
              onClick={() => onPick(photo)}
            />
          );
        })}
      </div>
      {remaining > 0 ? (
        <button
          type="button"
          onClick={() =>
            setShown((current) => Math.min(photos.length, current + PAGE_SIZE))
          }
          className="mt-2.5 w-full rounded-lg border border-white/10 py-2 text-xs text-foreground/60 transition-colors hover:bg-white/[0.04] hover:text-foreground"
        >
          Show {Math.min(PAGE_SIZE, remaining)} more ({remaining} left)
        </button>
      ) : null}
    </>
  );
}

function PositionBadge({
  position,
  className,
}: {
  position: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "pointer-events-none flex size-6 items-center justify-center rounded-full bg-brand text-[0.7rem] font-semibold tabular-nums text-brand-foreground shadow",
        className,
      )}
    >
      {position}
    </span>
  );
}

/**
 * Pointer-driven reordering for a chosen slot, with hit-testing over the
 * registered tiles. The same shape as the photo gallery's drag (mouse starts
 * after a small movement, touch after a long press so the sheet still
 * scrolls), because a second gesture for the same job would be its own bug.
 * The move buttons beside each tile are the keyboard and no-drag fallback.
 */
function useSlotDrag(
  ids: string[],
  preview: (next: string[]) => void,
  commit: (next: string[]) => void,
  disabled: boolean,
) {
  const tiles = useRef(new Map<string, HTMLElement>());
  const idsRef = useRef(ids);
  useEffect(() => {
    idsRef.current = ids;
  });

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const drag = useRef<{
    id: string;
    startX: number;
    startY: number;
    activated: boolean;
    longPress: number | null;
    before: string[];
  } | null>(null);
  const listeners = useRef<{
    move: (event: PointerEvent) => void;
    up: () => void;
    cancel: () => void;
    preventTouch: (event: TouchEvent) => void;
  } | null>(null);

  const register = useCallback(
    (id: string) => (element: HTMLElement | null) => {
      if (element) tiles.current.set(id, element);
      else tiles.current.delete(id);
    },
    [],
  );

  const onPointerDown = (event: React.PointerEvent, id: string) => {
    if (disabled || drag.current) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const isMouse = event.pointerType === "mouse";
    const state = {
      id,
      startX: event.clientX,
      startY: event.clientY,
      activated: false,
      longPress: null as number | null,
      before: idsRef.current,
    };
    drag.current = state;

    const activate = () => {
      if (!drag.current || drag.current.activated) return;
      drag.current.activated = true;
      setDraggingId(drag.current.id);
    };

    const hitTest = (x: number, y: number): string | null => {
      for (const [tileId, element] of tiles.current) {
        const rect = element.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          return tileId;
        }
      }
      return null;
    };

    const preventTouch = (touchEvent: TouchEvent) => {
      if (drag.current?.activated) touchEvent.preventDefault();
    };

    const move = (moveEvent: PointerEvent) => {
      const current = drag.current;
      if (!current) return;
      if (!current.activated) {
        const distance = Math.hypot(
          moveEvent.clientX - current.startX,
          moveEvent.clientY - current.startY,
        );
        if (isMouse) {
          if (distance > 6) activate();
        } else if (distance > 10) {
          end(false);
          return;
        }
        if (!drag.current?.activated) return;
      }
      const over = hitTest(moveEvent.clientX, moveEvent.clientY);
      if (!over || over === current.id) return;
      const order = idsRef.current;
      const from = order.indexOf(current.id);
      const to = order.indexOf(over);
      if (from === -1 || to === -1 || from === to) return;
      const next = [...order];
      next.splice(from, 1);
      next.splice(to, 0, current.id);
      preview(next);
    };

    const end = (save: boolean) => {
      const current = drag.current;
      const bound = listeners.current;
      if (bound) {
        window.removeEventListener("pointermove", bound.move);
        window.removeEventListener("pointerup", bound.up);
        window.removeEventListener("pointercancel", bound.cancel);
        document.removeEventListener("touchmove", bound.preventTouch);
      }
      listeners.current = null;
      drag.current = null;
      if (current?.longPress !== null && current?.longPress !== undefined) {
        window.clearTimeout(current.longPress);
      }
      setDraggingId(null);
      if (!current?.activated) return;
      if (save) commit(idsRef.current);
      else preview(current.before);
    };

    const up = () => end(true);
    const cancel = () => end(false);

    listeners.current = { move, up, cancel, preventTouch };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    if (!isMouse) {
      document.addEventListener("touchmove", preventTouch, { passive: false });
      state.longPress = window.setTimeout(activate, 250);
    }
  };

  return { register, onPointerDown, draggingId };
}

/** A thumbnail in a picker grid. The position badge is the selected state:
 * a ring alone says "this one" but not "this one, second". */
function PhotoTile({
  photo,
  position,
  onClick,
  disabled,
  label,
}: {
  photo: SlotPhoto;
  position: number | null;
  onClick?: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={position !== null}
      aria-label={label}
      className={cn(
        "relative aspect-square overflow-hidden rounded-lg ring-1 transition-all",
        position !== null
          ? "ring-2 ring-brand"
          : "ring-foreground/10 hover:ring-foreground/30",
        disabled && "cursor-default opacity-60",
      )}
    >
      <Thumb
        src={photo.thumbUrl}
        fallbackSrc={photo.url}
        className="size-full bg-white/[0.04] object-cover"
      />
      {position !== null ? (
        <span className="absolute inset-0 bg-brand/15" />
      ) : null}
      {position !== null ? (
        <PositionBadge position={position} className="absolute left-1.5 top-1.5" />
      ) : null}
    </button>
  );
}

// --- Hero slot --------------------------------------------------------------

function HeroSlotSection({
  tripId,
  slot,
  disabled,
  onSaved,
}: {
  tripId: string;
  slot: HeroSlot;
  disabled: boolean;
  onSaved: () => void;
}) {
  const [chosenId, setChosenId] = useState<string | null>(slot.chosen?.id ?? null);
  const [saving, setSaving] = useState(false);
  const serverId = slot.chosen?.id ?? null;
  const [prevServerId, setPrevServerId] = useState(serverId);
  if (prevServerId !== serverId) {
    setPrevServerId(serverId);
    setChosenId(serverId);
  }

  const preview =
    slot.candidates.find((photo) => photo.id === chosenId) ?? slot.automatic;
  const isAutomatic = chosenId === null;

  async function save(next: string | null) {
    if (disabled) {
      toast.error(DEMO_READONLY_MESSAGE);
      return;
    }
    const before = chosenId;
    setChosenId(next);
    setSaving(true);
    const result = await setTripHeroPhotoAction(tripId, next).catch(() => ({
      error: "Could not save the hero photo.",
    }));
    setSaving(false);
    if ("error" in result) {
      setChosenId(before);
      toast.error(result.error);
      return;
    }
    onSaved();
  }

  return (
    <SlotSection
      title="Trip hero"
      where="Opens the Year in Travel recap and backs the share card."
      status={saving ? "Saving..." : isAutomatic ? "Automatic" : "Chosen"}
      accent={!isAutomatic}
      summary={preview ? <ThumbStrip photos={[preview]} dim={isAutomatic} /> : undefined}
      // Every photo on the trip is a candidate here, so this is the section
      // that gets long first and the one that most needs to start folded.
      defaultOpen={slot.candidates.length <= LONG_SECTION}
    >
      {/* The one full-size image in the panel, and the one place SafeImage's
          skeleton and error state earn what they cost. */}
      <div className="relative isolate aspect-[16/9] w-full overflow-hidden rounded-lg bg-white/[0.04] ring-1 ring-foreground/10">
        {preview ? (
          <SafeImage
            src={preview.url}
            alt=""
            loading="lazy"
            className={cn(
              "size-full object-cover",
              isAutomatic && "opacity-70 saturate-[0.85]",
            )}
          />
        ) : null}
        <span
          className={cn(
            "absolute bottom-2 left-2 rounded-md px-2 py-1 text-[0.7rem] font-medium backdrop-blur",
            isAutomatic
              ? "bg-black/60 text-white/75"
              : "bg-brand/90 text-brand-foreground",
          )}
        >
          {isAutomatic ? "Automatic" : "Your pick"}
        </span>
      </div>
      <div className="mt-2 flex items-start justify-between gap-3">
        <p className="text-xs text-foreground/45">
          {isAutomatic ? slot.automaticReason : "Your pick opens the recap."}
        </p>
        {isAutomatic ? null : (
          <button
            type="button"
            onClick={() => void save(null)}
            className="shrink-0 text-xs text-foreground/50 transition-colors hover:text-foreground"
          >
            Use automatic
          </button>
        )}
      </div>

      {slot.candidates.length > 0 ? (
        <div className="mt-4">
          <CandidateGrid
            photos={slot.candidates}
            positionOf={(photo) => (photo.id === chosenId ? 1 : null)}
            labelOf={(_photo, chosen) =>
              chosen ? "Remove as the trip hero" : "Use as the trip hero"
            }
            onPick={(photo) =>
              void save(photo.id === chosenId ? null : photo.id)
            }
          />
        </div>
      ) : (
        <p className="mt-3 text-xs text-foreground/45">
          No photos on this trip yet.
        </p>
      )}
    </SlotSection>
  );
}

// --- Stop photo slots -------------------------------------------------------

function StopSlotSection({
  tripId,
  slot,
  disabled,
  defaultOpen,
  onSaved,
}: {
  tripId: string;
  slot: StopPhotoSlot;
  disabled: boolean;
  defaultOpen: boolean;
  onSaved: () => void;
}) {
  const serverIds = slot.chosen.map((photo) => photo.id);
  const serverKey = serverIds.join("|");
  const [ids, setIds] = useState<string[]>(serverIds);
  const [prevKey, setPrevKey] = useState(serverKey);
  const [open, setOpen] = useState(defaultOpen);
  const [saving, setSaving] = useState(false);
  if (prevKey !== serverKey) {
    setPrevKey(serverKey);
    setIds(serverIds);
  }

  const byId = useMemo(
    () => new Map(slot.candidates.map((photo) => [photo.id, photo])),
    [slot.candidates],
  );
  const chosen = ids
    .map((id) => byId.get(id))
    .filter((photo): photo is SlotPhoto => Boolean(photo));

  const save = useCallback(
    async (next: string[]) => {
      if (disabled) {
        toast.error(DEMO_READONLY_MESSAGE);
        return;
      }
      const before = ids;
      setIds(next);
      setSaving(true);
      const result = await setStopPhotosAction(
        tripId,
        slot.destinationId,
        next,
        slot.candidates.map((photo) => photo.id),
      ).catch(() => ({ error: "Could not save this stop's photos." }));
      setSaving(false);
      if ("error" in result) {
        setIds(before);
        toast.error(result.error);
        return;
      }
      onSaved();
    },
    [disabled, ids, onSaved, slot.candidates, slot.destinationId, tripId],
  );

  const drag = useSlotDrag(ids, setIds, (next) => void save(next), disabled);

  function toggle(id: string) {
    if (ids.includes(id)) {
      void save(ids.filter((current) => current !== id));
      return;
    }
    if (ids.length >= SLOT_CAPACITY.stopPhotos) {
      toast.error(
        `This slot holds ${SLOT_CAPACITY.stopPhotos} photos. Remove one first.`,
      );
      return;
    }
    void save([...ids, id]);
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    const next = [...ids];
    [next[index], next[target]] = [next[target], next[index]];
    void save(next);
  }

  const isAutomatic = ids.length === 0;
  const dayCount = slot.dayDates.length;
  const suggestion = suggestStopCount(slot, chosen);

  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-foreground/40 transition-transform",
            !open && "-rotate-90",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">
            {slot.destinationName}
          </span>
          {/* The dates come first because they are what distinguishes two
              stays in the same city, which is a shape one trip in ten has. */}
          {slot.dateLabel || dayCount > 0 ? (
            <span className="block truncate text-[0.7rem] text-foreground/40">
              {[
                slot.dateLabel,
                dayCount > 0
                  ? `${dayCount} ${dayCount === 1 ? "day slide" : "day slides"}`
                  : null,
              ]
                .filter((part): part is string => part !== null)
                .join(" · ")}
            </span>
          ) : null}
        </span>
        <ThumbStrip
          photos={isAutomatic ? slot.automatic : chosen}
          dim={isAutomatic}
        />
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[0.7rem] font-medium",
            isAutomatic
              ? "bg-white/[0.06] text-foreground/50"
              : "bg-brand/15 text-brand",
          )}
        >
          {saving
            ? "Saving..."
            : isAutomatic
              ? "Automatic"
              : `${ids.length} of ${SLOT_CAPACITY.stopPhotos}`}
        </span>
      </button>

      {open ? (
        <div className="border-t border-white/[0.07] p-3">
          {isAutomatic ? (
            <p className="mb-3 text-xs text-foreground/45">
              {dayCount > 0
                ? `Automatic: ${dayCount === 1 ? "this stop's one day slide leads" : `these ${dayCount} day slides lead`} with the earliest photos of each. Pick up to ${SLOT_CAPACITY.stopPhotos} and they are spread across the same days instead.`
                : `Automatic: the first photos of this stop, in the order they were taken. Pick up to ${SLOT_CAPACITY.stopPhotos} to lead its slides instead.`}
            </p>
          ) : (
            <>
              {/* What this selection will actually produce, from the same
                  function the story places the photographs with. A rule the
                  traveller has to infer is a rule nobody follows. */}
              <p className="mb-1 text-xs text-foreground/70">
                {describeStopSelection(slot, chosen)}
              </p>
              {suggestion ? (
                <p className="mb-2 text-xs text-foreground/40">{suggestion}</p>
              ) : null}
              <p className="mb-2 text-xs text-foreground/45">
                Drag to reorder, or use the arrows.
              </p>
              <ul className="mb-3 flex flex-wrap gap-2">
                {chosen.map((photo, index) => (
                  <li
                    key={photo.id}
                    ref={drag.register(photo.id)}
                    onPointerDown={(event) =>
                      drag.onPointerDown(event, photo.id)
                    }
                    onDragStart={(event) => event.preventDefault()}
                    className={cn(
                      "relative w-20 cursor-grab touch-none select-none",
                      drag.draggingId === photo.id && "opacity-60",
                    )}
                  >
                    <span className="relative block aspect-square overflow-hidden rounded-lg bg-white/[0.04] ring-2 ring-brand">
                      <Thumb
                        src={photo.thumbUrl}
                        fallbackSrc={photo.url}
                        className="size-full object-cover"
                      />
                      <PositionBadge
                        position={index + 1}
                        className="absolute left-1 top-1"
                      />
                      <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded bg-black/55 text-white/70">
                        <GripVerticalIcon className="size-3" />
                      </span>
                    </span>
                    <span className="mt-1 flex items-center justify-center gap-0.5">
                      <button
                        type="button"
                        aria-label={`Move ${index + 1} earlier`}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                        className="flex size-6 items-center justify-center rounded text-foreground/50 transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-25 disabled:hover:bg-transparent"
                      >
                        <ArrowLeftIcon className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove photo ${index + 1}`}
                        onClick={() => toggle(photo.id)}
                        className="flex size-6 items-center justify-center rounded text-foreground/50 transition-colors hover:bg-white/10 hover:text-foreground"
                      >
                        <XIcon className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${index + 1} later`}
                        disabled={index === chosen.length - 1}
                        onClick={() => move(index, 1)}
                        className="flex size-6 items-center justify-center rounded text-foreground/50 transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-25 disabled:hover:bg-transparent"
                      >
                        <ArrowRightIcon className="size-3.5" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <CandidateGrid
            photos={slot.candidates}
            positionOf={(photo) => {
              const position = ids.indexOf(photo.id);
              return position === -1 ? null : position + 1;
            }}
            labelOf={(_photo, chosenHere) =>
              chosenHere
                ? `Remove from ${slot.destinationName}`
                : `Add to ${slot.destinationName}`
            }
            onPick={(photo) => toggle(photo.id)}
          />
        </div>
      ) : null}
    </div>
  );
}

// --- Highlights slot --------------------------------------------------------

function HighlightsSlotSection({
  tripId,
  slot,
  disabled,
  onSaved,
}: {
  tripId: string;
  slot: HighlightsSlot;
  disabled: boolean;
  onSaved: () => void;
}) {
  const serverIds = slot.chosen.map((experience) => experience.id);
  const serverKey = serverIds.join("|");
  const [ids, setIds] = useState<string[]>(serverIds);
  const [prevKey, setPrevKey] = useState(serverKey);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  if (prevKey !== serverKey) {
    setPrevKey(serverKey);
    setIds(serverIds);
  }

  const byId = useMemo(
    () => new Map(slot.candidates.map((item) => [item.id, item])),
    [slot.candidates],
  );
  const chosen = ids
    .map((id) => byId.get(id))
    .filter((item): item is SlotExperience => Boolean(item));

  const save = useCallback(
    async (next: string[]) => {
      if (disabled) {
        toast.error(DEMO_READONLY_MESSAGE);
        return;
      }
      const before = ids;
      setIds(next);
      setSaving(true);
      const result = await setTripHighlightsAction(tripId, next).catch(() => ({
        error: "Could not save the highlights.",
      }));
      setSaving(false);
      if ("error" in result) {
        setIds(before);
        toast.error(result.error);
        return;
      }
      onSaved();
    },
    [disabled, ids, onSaved, tripId],
  );

  const drag = useSlotDrag(ids, setIds, (next) => void save(next), disabled);

  function toggle(id: string) {
    if (ids.includes(id)) {
      void save(ids.filter((current) => current !== id));
      return;
    }
    if (ids.length >= SLOT_CAPACITY.highlights) {
      toast.error(
        `The highlights hold ${SLOT_CAPACITY.highlights}. Remove one first.`,
      );
      return;
    }
    void save([...ids, id]);
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    const next = [...ids];
    [next[index], next[target]] = [next[target], next[index]];
    void save(next);
  }

  const isAutomatic = ids.length === 0;
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? slot.candidates.filter(
        (item) =>
          item.name.toLowerCase().includes(needle) ||
          item.destinationName.toLowerCase().includes(needle),
      )
    : slot.candidates;

  // Grouped by stop, in the trip's own stop order, which is how somebody
  // remembers a trip. The list is already sorted best-rated first inside each
  // group by the model. Runs break on the destination ID, not its name: a trip
  // that returns to the same city has two stays there, and folding them
  // together under one heading would hide which visit an experience was on.
  const groups: { id: string | null; name: string; items: SlotExperience[] }[] =
    [];
  for (const item of filtered) {
    const last = groups[groups.length - 1];
    if (last && last.id === item.destinationId) last.items.push(item);
    else {
      groups.push({
        id: item.destinationId,
        name: item.destinationName,
        items: [item],
      });
    }
  }

  return (
    <SlotSection
      title={`Trip highlights (${SLOT_CAPACITY.highlights})`}
      where="The share card's list, the story's closing, and the recap's moments."
      status={
        saving
          ? "Saving..."
          : isAutomatic
            ? "Automatic"
            : `${ids.length} of ${SLOT_CAPACITY.highlights}`
      }
      accent={!isAutomatic}
      defaultOpen={slot.candidates.length <= LONG_SECTION}
    >
      {isAutomatic ? (
        <div>
          <p className="mb-2 text-xs text-foreground/45">
            {slot.automatic.length > 0
              ? "Automatic: your best-rated on this trip."
              : "Nothing rated on this trip yet, so the highlights row is left out."}
          </p>
          <ol className="flex flex-col gap-1.5">
            {slot.automatic.map((item, index) => (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-lg bg-white/[0.02] px-3 py-2 opacity-65 ring-1 ring-foreground/[0.07]"
              >
                <span className="flex size-6 items-center justify-center rounded-full bg-white/[0.07] text-[0.7rem] tabular-nums text-foreground/60">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">
                    {item.name}
                  </span>
                  <span className="block truncate text-xs text-foreground/45">
                    {item.destinationName}
                  </span>
                </span>
                {item.rating !== null ? (
                  <RatingDisplay rating={item.rating} size={12} />
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div>
          <div className="mb-2 flex items-start justify-between gap-3">
            <p className="text-xs text-foreground/45">
              Drag to reorder, or use the arrows. Number one leads.
            </p>
            <button
              type="button"
              onClick={() => void save([])}
              className="shrink-0 text-xs text-foreground/50 transition-colors hover:text-foreground"
            >
              Use automatic
            </button>
          </div>
          <ol className="flex flex-col gap-1.5">
            {chosen.map((item, index) => (
              <li
                key={item.id}
                ref={drag.register(item.id)}
                onPointerDown={(event) => drag.onPointerDown(event, item.id)}
                onDragStart={(event) => event.preventDefault()}
                className={cn(
                  "flex cursor-grab touch-none select-none items-center gap-2.5 rounded-lg bg-brand/[0.08] px-3 py-2 ring-1 ring-brand/30",
                  drag.draggingId === item.id && "opacity-60",
                )}
              >
                <GripVerticalIcon className="size-4 shrink-0 text-foreground/35" />
                <PositionBadge position={index + 1} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">
                    {item.name}
                  </span>
                  <span className="block truncate text-xs text-foreground/45">
                    {item.destinationName}
                    {item.rating === null ? " · not rated" : ""}
                  </span>
                </span>
                {item.rating !== null ? (
                  <RatingDisplay
                    rating={item.rating}
                    size={12}
                    className="hidden sm:inline-flex"
                  />
                ) : null}
                <span className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    aria-label={`Move ${item.name} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    className="flex size-7 items-center justify-center rounded text-foreground/50 transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-25 disabled:hover:bg-transparent"
                  >
                    <ArrowUpIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${item.name} down`}
                    disabled={index === chosen.length - 1}
                    onClick={() => move(index, 1)}
                    className="flex size-7 items-center justify-center rounded text-foreground/50 transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-25 disabled:hover:bg-transparent"
                  >
                    <ArrowDownIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${item.name}`}
                    onClick={() => toggle(item.id)}
                    className="flex size-7 items-center justify-center rounded text-foreground/50 transition-colors hover:bg-white/10 hover:text-foreground"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {slot.candidates.length === 0 ? (
        <p className="mt-3 text-xs text-foreground/45">
          Nothing logged on this trip yet.
        </p>
      ) : (
        <div className="mt-4">
          {slot.candidates.length > 8 ? (
            <div className="relative mb-2">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-foreground/35" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find an experience"
                aria-label="Find an experience"
                className="h-9 pl-8 text-sm"
              />
            </div>
          ) : null}
          <div className="max-h-64 overflow-y-auto rounded-lg ring-1 ring-foreground/[0.07]">
            {groups.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-foreground/45">
                Nothing matches {`"${query.trim()}"`}.
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.id ?? group.name}>
                  <p className="sticky top-0 z-10 bg-card px-3 py-1.5 text-[0.68rem] font-medium uppercase tracking-wide text-foreground/35">
                    {group.name}
                  </p>
                  <ul>
                    {group.items.map((item) => {
                      const position = ids.indexOf(item.id);
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => toggle(item.id)}
                            aria-pressed={position !== -1}
                            className={cn(
                              "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
                              position === -1
                                ? "hover:bg-white/[0.04]"
                                : "bg-brand/[0.09]",
                            )}
                          >
                            {position === -1 ? (
                              <span
                                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-foreground/45"
                                style={
                                  item.categoryColor
                                    ? { color: item.categoryColor }
                                    : undefined
                                }
                              >
                                <CategoryIcon
                                  icon={item.categoryIcon}
                                  className="size-3.5"
                                />
                              </span>
                            ) : (
                              <PositionBadge position={position + 1} />
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm text-foreground">
                                {item.name}
                              </span>
                              <span className="block truncate text-xs text-foreground/40">
                                {item.rating === null
                                  ? "Not rated, so it will not print a star"
                                  : (item.categoryLabel ?? "")}
                              </span>
                            </span>
                            {item.rating !== null ? (
                              <RatingDisplay
                                rating={item.rating}
                                size={11}
                                showNumber={false}
                              />
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </SlotSection>
  );
}

// --- The panel --------------------------------------------------------------

/**
 * The panel body, mounted only while the dialog is open.
 *
 * Its own component for one reason: buildCurationSlots folds the whole trip
 * (and now builds its story slides, to know how many days each stop has), and
 * on a photo-heavy trip that is real work to do on every render of a page
 * whose dialog is shut. Behind the open flag it runs once, when somebody asks.
 */
function CurationPanel({
  trip,
  isDemo,
  onSaved,
}: {
  trip: StoryTrip;
  isDemo: boolean;
  onSaved: () => void;
}) {
  const slots = useMemo(() => buildCurationSlots(trip), [trip]);
  const stopsChosen = slots.stops.filter((stop) => stop.chosen.length > 0).length;

  return (
    <div className="flex flex-col gap-3">
      <HeroSlotSection
        tripId={trip.id}
        slot={slots.hero}
        disabled={isDemo}
        onSaved={onSaved}
      />

      {slots.stops.length > 0 ? (
        <SlotSection
          title={`Photos per stop (${SLOT_CAPACITY.stopPhotos})`}
          where="Spread across that stop's day slides in the trip story."
          status={
            stopsChosen > 0
              ? `${stopsChosen} of ${slots.stops.length} chosen`
              : "Automatic"
          }
          accent={stopsChosen > 0}
          defaultOpen={slots.stops.length <= 6}
        >
          <div className="flex flex-col gap-2">
            {slots.stops.map((stop, index) => (
              <StopSlotSection
                key={stop.destinationId}
                tripId={trip.id}
                slot={stop}
                disabled={isDemo}
                defaultOpen={slots.stops.length === 1 && index === 0}
                onSaved={onSaved}
              />
            ))}
          </div>
        </SlotSection>
      ) : null}

      <HighlightsSlotSection
        tripId={trip.id}
        slot={slots.highlights}
        disabled={isDemo}
        onSaved={onSaved}
      />

      <p className="text-center text-[0.7rem] text-foreground/35">
        Changes save as you make them.
      </p>
    </div>
  );
}

export function TripCurationButton({
  trip,
  isDemo,
  className,
}: {
  trip: StoryTrip;
  isDemo: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Cheap enough to run every render, unlike the slots themselves: it is two
  // length checks and stops at the first experience it finds.
  if (!hasCurationSlots(trip)) return null;

  // The button's brand tint used to need the whole model built just to know
  // whether anything was elected. One scan of the rows answers the same
  // question without folding the trip.
  const curated =
    trip.photos.some((photo) => (photo.featuredRank ?? 0) > 0) ||
    trip.destinations.some((destination) =>
      destination.experiences.some(
        (experience) => (experience.featuredRank ?? 0) > 0,
      ),
    );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border border-white/20 bg-black/40 px-3 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-black/60",
          curated && "border-brand/50 text-brand",
          className,
        )}
      >
        <SparklesIcon className="size-4" />
        Curate
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Curate {trip.name}</DialogTitle>
            <DialogDescription>
              {isDemo
                ? "This is the read-only demo account, so the slots below show what was chosen but cannot be changed."
                : "Choose what represents this trip. Every slot below already has an answer; picking one replaces it, and clearing goes back to automatic."}
            </DialogDescription>
          </DialogHeader>

          <CurationPanel
            trip={trip}
            isDemo={isDemo}
            onSaved={() => router.refresh()}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

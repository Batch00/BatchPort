"use client";

// A tooltip that works on touch. The native `title` attribute never fires on
// touch devices (there is no hover) and is slow and unstyled on desktop, so
// every informational tip in the app goes through this component instead.
//
// Two Radix primitives back it, picked by what the pointer can actually do:
//
// - Fine pointer (mouse, trackpad, stylus): Radix Tooltip. Opens on hover and
//   on keyboard focus, closes on leave/blur/Escape. No click required, which is
//   what a mouse user expects.
// - Coarse pointer (touch): Radix Popover. Opens on tap, closes on tap-outside,
//   Escape, or scroll. Tooltip is deliberately not used here: its touch support
//   relies on long-press and it dismisses itself on the click that follows, so
//   a tap either does nothing or flashes.
//
// Both engines render the same trigger and the same portalled content, so the
// only difference the user can perceive is the gesture that opens it.

import {
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Popover, Tooltip } from "radix-ui";

import { cn } from "@/lib/utils";

type Side = ComponentProps<typeof Tooltip.Content>["side"];
type Align = ComponentProps<typeof Tooltip.Content>["align"];

interface InfoTipProps {
  /** The tip body. Kept to text or simple inline nodes: this is not a dialog. */
  tip: ReactNode;
  /** The visible trigger content (a chip, a truncated label, an icon). */
  children: ReactNode;
  /**
   * Accessible name for the trigger button. Needed whenever the trigger is an
   * icon or an abbreviation, since the visible text alone would not say what
   * pressing it reveals.
   */
  label?: string;
  side?: Side;
  align?: Align;
  /** Classes for the trigger button. It inherits type styling by default. */
  className?: string;
  /** Classes for the tip bubble, e.g. to widen it for longer copy. */
  contentClassName?: string;
}

const CONTENT_CLASS =
  // Dark, minimal, brand-tinted border. max-w plus break-words is what keeps a
  // long language list readable at 380px instead of running off-screen; the
  // portal keeps it out of any clipping overflow container.
  //
  // Enter animation only, deliberately no exit animation. Radix keeps closed
  // content mounted until an exit animation reports animationend, and a bubble
  // that closes on tap-outside or scroll can flip state before the animation
  // ever starts, which strands a visible "closed" tip on the page. Unmounting
  // straight away is both correct and what a tooltip should feel like.
  "z-[60] max-w-[min(16rem,calc(100vw-2rem))] rounded-lg border border-brand/25 bg-[#0f1117]/95 px-2.5 py-1.5 text-xs leading-snug text-foreground/90 shadow-xl backdrop-blur-md break-words duration-150 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=open]:animate-in data-[state=open]:fade-in-0";

const ARROW_CLASS = "fill-[#0f1117]/95";

const TRIGGER_CLASS =
  // Inherits the surrounding type so a chip or truncated label looks unchanged.
  // Cursor-help signals "there is more here" without implying navigation.
  "cursor-help text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background rounded-[inherit]";

const COARSE_QUERY = "(hover: none), (pointer: coarse)";

function subscribeToPointer(onChange: () => void): () => void {
  const query = window.matchMedia(COARSE_QUERY);
  // Convertible laptops and devtools emulation flip this live.
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * True when the primary pointer cannot hover, i.e. a touchscreen.
 *
 * useSyncExternalStore rather than an effect: the media query is external state
 * that React must read, and this gets the SSR snapshot right in one pass. The
 * server has no pointer to query, so it reports false (the hover engine), which
 * is the harmless direction to guess: hydration then corrects it before any
 * interaction, and a mis-guessed touch device would still open on tap-focus.
 */
function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribeToPointer,
    () => window.matchMedia(COARSE_QUERY).matches,
    () => false,
  );
}

export function InfoTip({
  tip,
  children,
  label,
  side = "top",
  align = "center",
  className,
  contentClassName,
}: InfoTipProps) {
  const coarse = useCoarsePointer();
  const [open, setOpen] = useState(false);
  const describedBy = useId();

  // Touch only: dismiss on scroll. A tip anchored to a chip inside a scrolling
  // panel would otherwise drift away from its trigger. Capture phase so it
  // still fires for scrolls inside nested containers, which do not bubble.
  useEffect(() => {
    if (!coarse || !open) return;
    const onScroll = () => setOpen(false);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () =>
      window.removeEventListener("scroll", onScroll, { capture: true });
  }, [coarse, open]);

  // Stop the click here so a tip sitting inside a clickable card or row reveals
  // the tip without also firing the card's action. Two things this deliberately
  // does NOT do, both verified against real (trusted) browser events:
  //
  // - No preventDefault. Radix composes its own trigger handler with this one
  //   and skips its half when the event's default has been prevented, so
  //   preventDefault would stop the popover ever opening on touch. The trigger
  //   is type="button", so there is no native default worth suppressing.
  // - No stopPropagation on pointerdown. Radix's dismissable layer tracks
  //   pointerdown at the document to tell inside from outside presses; starving
  //   it leaves that bookkeeping stale and the next real tap opens and instantly
  //   closes again. Enclosing cards latch on click anyway, which is covered.
  const triggerProps = {
    type: "button" as const,
    "aria-label": label,
    "aria-describedby": open ? describedBy : undefined,
    className: cn(TRIGGER_CLASS, className),
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
    },
  };

  if (coarse) {
    return (
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger {...triggerProps}>{children}</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            id={describedBy}
            role="tooltip"
            side={side}
            align={align}
            sideOffset={6}
            collisionPadding={12}
            // Keeps focus on the chip: this is a read-only bubble, so moving
            // focus into it would trap a screen reader user in a dead end.
            onOpenAutoFocus={(event) => event.preventDefault()}
            className={cn(CONTENT_CLASS, contentClassName)}
          >
            {tip}
            <Popover.Arrow className={ARROW_CLASS} width={10} height={5} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  return (
    // delayDuration 150 is short enough to feel immediate, unlike the ~1s the
    // browser takes to surface a native title.
    <Tooltip.Provider delayDuration={150} skipDelayDuration={300}>
      <Tooltip.Root open={open} onOpenChange={setOpen}>
        <Tooltip.Trigger {...triggerProps}>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            id={describedBy}
            side={side}
            align={align}
            sideOffset={6}
            collisionPadding={12}
            className={cn(CONTENT_CLASS, contentClassName)}
          >
            {tip}
            <Tooltip.Arrow className={ARROW_CLASS} width={10} height={5} />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

/**
 * A hover/focus tip for an element that already does something when pressed
 * (a real button). The child stays the trigger, so no nested button is created
 * and its own onClick is untouched.
 *
 * Deliberately hover-only: hijacking a tap on an action button to show a tip
 * would swallow the action, which is worse than no tip. Coarse pointers get the
 * child rendered bare, so anything a touch user must know has to live in the
 * child's visible label or its aria-label, not here.
 */
export function ActionTip({
  tip,
  children,
  side = "top",
  align = "center",
  contentClassName,
}: {
  tip: ReactNode;
  children: ReactNode;
  side?: Side;
  align?: Align;
  contentClassName?: string;
}) {
  const coarse = useCoarsePointer();
  if (coarse) return <>{children}</>;

  return (
    <Tooltip.Provider delayDuration={150} skipDelayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side={side}
            align={align}
            sideOffset={6}
            collisionPadding={12}
            className={cn(CONTENT_CLASS, contentClassName)}
          >
            {tip}
            <Tooltip.Arrow className={ARROW_CLASS} width={10} height={5} />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

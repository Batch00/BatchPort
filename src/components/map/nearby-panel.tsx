"use client";

// Nearby mode's chrome: the top-left status card. It answers, in order, the
// three things worth knowing while standing somewhere:
//
//   1. Where am I, in the terms of my own travel history ("You are in Kyoto")?
//   2. Am I at something I planned, and can I tick it off from here?
//   3. Can I log what I am looking at right now?
//
// The failure states live here too, and they are deliberately flat: an
// explanation, one button to try again, one to leave. Nothing re-asks the
// browser for permission on its own.

import Link from "next/link";
import {
  CheckIcon,
  Loader2Icon,
  MapPinIcon,
  PlusIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDateRange } from "@/lib/format";
import {
  CONTEXT_RADIUS_KM,
  formatProximity,
  type PlannedExperiencePoint,
} from "@/lib/nearby";
import type { NearbyStatus } from "./use-nearby";
import type { GlobeDestination } from "./globe-types";

// No width of its own: the host positions the card with both a left and a
// right inset, so the map's own edges size it and it cannot spill past them.
// (A `w-full` here resolved against the map container, not against the space
// between the insets, which is what pushed the card past the right edge on a
// phone.) max-w-sm only caps it once the map is wide enough to matter.
const CARD_CLASS =
  "pointer-events-auto max-w-sm rounded-2xl border border-white/10 bg-black/80 p-3.5 text-sm shadow-2xl backdrop-blur-md";

const ACTION_CLASS =
  "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50";

const PRIMARY_CLASS =
  "inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground transition-colors hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50";

/** True when today falls inside the trip's dates, so the trip page's plan
 * block is the thing worth linking to rather than a finished trip's record. */
function isUnderway(destination: GlobeDestination): boolean {
  if (destination.planned) return true;
  const today = new Date().toISOString().slice(0, 10);
  const start = destination.tripStartDate;
  const end = destination.tripEndDate;
  if (!start) return false;
  return start <= today && (!end || today <= end);
}

export function NearbyPanel({
  status,
  context,
  plannedNear,
  checkingOff,
  className,
  onLogHere,
  onCheckoff,
  onDismissCheckoff,
  onRetry,
  onRefresh,
  onExit,
}: {
  status: NearbyStatus;
  /** The stop the fix landed in, when one is within the context radius. */
  context: { destination: GlobeDestination; km: number } | null;
  /** A planned experience close enough to offer the checkoff. */
  plannedNear: { point: PlannedExperiencePoint; km: number } | null;
  checkingOff: boolean;
  className?: string;
  onLogHere: () => void;
  onCheckoff: () => void;
  onDismissCheckoff: () => void;
  onRetry: () => void;
  onRefresh: () => void;
  onExit: () => void;
}) {
  if (status === "off") return null;

  if (status === "locating") {
    return (
      <div className={cn(CARD_CLASS, className)}>
        <p className="flex items-center gap-2 text-foreground/80">
          <Loader2Icon className="size-4 shrink-0 animate-spin text-brand" />
          Finding your location...
        </p>
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={onExit} className={ACTION_CLASS}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (status !== "active") {
    const message =
      status === "denied"
        ? "Nearby needs your location, and this site does not have permission. You can allow it in your browser's site settings, then try again."
        : status === "unavailable"
          ? "This browser cannot share a location. Nearby needs one to show what is around you."
          : "Your location could not be worked out just now. It sometimes helps to move somewhere with a clearer view of the sky.";
    return (
      <div className={cn(CARD_CLASS, className)}>
        <p className="text-foreground/70">{message}</p>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onExit} className={ACTION_CLASS}>
            Exit nearby
          </button>
          {status === "unavailable" ? null : (
            <button type="button" onClick={onRetry} className={PRIMARY_CLASS}>
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  const destination = context?.destination ?? null;
  const dates = destination
    ? formatDateRange(destination.arrivalDate, destination.departureDate)
    : "";

  return (
    <div className={cn(CARD_CLASS, className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]"
            />
            <span className="min-w-0 break-words">
              {destination ? `You are in ${destination.name}` : "You are here"}
            </span>
          </p>
          {destination ? (
            <p className="mt-0.5 truncate text-xs text-foreground/50">
              {destination.tripName}
              {dates ? ` · ${dates}` : ""}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-foreground/50">
              No stop of yours within {CONTEXT_RADIUS_KM}km. Anything you log
              can still go on one.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onExit}
          aria-label="Exit nearby mode"
          title="Exit nearby mode"
          className="-mr-1 -mt-1 shrink-0 rounded-full p-1.5 text-foreground/50 transition-colors hover:bg-white/10 hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>
      </div>

      {/* The planner's payoff: the app noticed you are where you planned to
          be. Offered once per experience per session, dismissable. */}
      {plannedNear ? (
        <div className="mt-3 rounded-xl border border-brand/30 bg-brand/10 p-2.5">
          <p className="text-xs text-foreground/85">
            You are near{" "}
            <span className="font-medium text-foreground">
              {plannedNear.point.name}
            </span>{" "}
            <span className="text-foreground/50">
              ({formatProximity(plannedNear.km)})
            </span>
            . Mark it done?
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onCheckoff}
              disabled={checkingOff}
              className={cn(PRIMARY_CLASS, "disabled:opacity-60")}
            >
              {checkingOff ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <CheckIcon className="size-3.5" />
              )}
              Mark done
            </button>
            <button
              type="button"
              onClick={onDismissCheckoff}
              className={ACTION_CLASS}
            >
              Not yet
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onLogHere} className={PRIMARY_CLASS}>
          <PlusIcon className="size-3.5" />
          Log something here
        </button>
        {destination ? (
          <>
            <Link
              href={`/trips/${destination.tripId}/destinations/${destination.id}`}
              className={cn(ACTION_CLASS, "max-w-full")}
            >
              <MapPinIcon className="size-3.5 shrink-0" />
              <span className="truncate">{destination.name}</span>
            </Link>
            <Link
              href={`/trips/${destination.tripId}`}
              className={ACTION_CLASS}
            >
              {isUnderway(destination) ? "Open plan" : "Open trip"}
            </Link>
          </>
        ) : null}
        <button
          type="button"
          onClick={onRefresh}
          aria-label="Update your location"
          title="Update your location"
          className={cn(ACTION_CLASS, "px-2")}
        >
          <RefreshCwIcon className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

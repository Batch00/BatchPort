"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  BikeIcon,
  BusIcon,
  CarIcon,
  FootprintsIcon,
  PlaneIcon,
  RouteIcon,
  ShipIcon,
  TrainFrontIcon,
  type LucideIcon,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteTransportLegAction,
  saveTransportLegAction,
} from "@/lib/actions/transport";
import {
  GROUND_ARC_COLOR,
  SEA_ARC_COLOR,
  TRANSPORT_MODES,
  arcFamily,
  legSummary,
  type TransportLeg,
  type TransportMode,
} from "@/lib/transport";
import { cn } from "@/lib/utils";

// The connector between two stops on the trip page: "How did you get here?"
// when nothing is recorded, the mode and its details once something is.
//
// Entry friction is the whole design. The sheet opens on a grid of eight mode
// buttons, and tapping one saves immediately: a leg with only a mode is a
// complete leg, and everything else (carrier, duration, distance, notes) sits
// behind a "Add details" disclosure that most people will never open. Recording
// "we took the train" should cost one tap, because the alternative is that
// nobody records anything.
//
// The mode dot repeats the colour the globe draws that family of arc in, so
// the styling language is learnable in the one place a leg is authored. That
// is deliberately instead of a legend floating over the map: the globe's
// overlay corners are spoken for, and a legend explaining three line styles
// would cost more attention than it returns.

const MODE_ICONS: Record<TransportMode, LucideIcon> = {
  flight: PlaneIcon,
  train: TrainFrontIcon,
  bus: BusIcon,
  car: CarIcon,
  ferry: ShipIcon,
  bike: BikeIcon,
  walk: FootprintsIcon,
  other: RouteIcon,
};

/** The arc colour a mode reads as, for the small dot on the row. Air uses the
 * brand token rather than a hex, so it tracks the theme like every other
 * brand-coloured thing on the page. */
function modeDotStyle(mode: TransportMode): { className: string; color?: string } {
  const family = arcFamily(mode);
  if (family === "ground") return { className: "", color: GROUND_ARC_COLOR };
  if (family === "sea") return { className: "", color: SEA_ARC_COLOR };
  return { className: "bg-brand" };
}

export function TransportModeIcon({
  mode,
  className,
}: {
  mode: TransportMode;
  className?: string;
}) {
  const Icon = MODE_ICONS[mode];
  return <Icon className={className} />;
}

/** The shared row body, so the editable and read-only versions cannot drift. */
function LegLine({
  leg,
  isFirst,
  className,
}: {
  leg: TransportLeg;
  isFirst: boolean;
  className?: string;
}) {
  const dot = modeDotStyle(leg.mode);
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <span
        aria-hidden
        style={dot.color ? { backgroundColor: dot.color } : undefined}
        className={cn("size-1.5 shrink-0 rounded-full", dot.className)}
      />
      <TransportModeIcon
        mode={leg.mode}
        className="size-3.5 shrink-0 text-foreground/50"
      />
      <span className="min-w-0 break-words text-xs text-foreground/60">
        {isFirst ? `${legSummary(leg)} to get there` : legSummary(leg)}
      </span>
    </span>
  );
}

/** The read-only rendering used by /demo and /share/[slug]. An unrecorded leg
 * renders nothing at all there: a visitor has no way to fill it in. */
export function TransportLegReadOnly({
  leg,
  isFirst = false,
}: {
  leg: TransportLeg | null;
  isFirst?: boolean;
}) {
  if (!leg) return null;
  return (
    <div className="flex items-center gap-2 py-1 pl-1">
      <span aria-hidden className="h-4 w-px shrink-0 bg-white/10" />
      <LegLine leg={leg} isFirst={isFirst} />
    </div>
  );
}

export function TransportLegRow({
  tripId,
  destinationId,
  destinationName,
  leg,
  isFirst = false,
  isDemo = false,
}: {
  tripId: string;
  destinationId: string;
  destinationName: string;
  leg: TransportLeg | null;
  /** The leg into the first stop is the journey out from home, so it says so. */
  isFirst?: boolean;
  isDemo?: boolean;
}) {
  const [open, setOpen] = useState(false);

  // The demo account cannot write, so an empty row would be an invitation with
  // no destination. A recorded leg still shows.
  if (isDemo) return <TransportLegReadOnly leg={leg} isFirst={isFirst} />;

  return (
    <>
      <div className="flex items-center gap-2 py-1 pl-1">
        <span aria-hidden className="h-4 w-px shrink-0 bg-white/10" />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-white/[0.04]"
        >
          {leg ? (
            <LegLine leg={leg} isFirst={isFirst} />
          ) : (
            <span className="text-xs text-foreground/30">
              {isFirst ? "How did you get there?" : "How did you get here?"}
            </span>
          )}
        </button>
      </div>
      {open ? (
        <TransportLegDialog
          tripId={tripId}
          destinationId={destinationId}
          destinationName={destinationName}
          leg={leg}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

// Minutes in, "2:20" out, for the duration field. Kept as two plain number
// inputs rather than a parsed free-text field: "1h30" versus "1:30" versus
// "90m" is a guessing game nobody asked to play.
function splitDuration(minutes: number | null): { hours: string; mins: string } {
  if (minutes === null) return { hours: "", mins: "" };
  return {
    hours: String(Math.floor(minutes / 60) || ""),
    mins: String(minutes % 60 || ""),
  };
}

function TransportLegDialog({
  tripId,
  destinationId,
  destinationName,
  leg,
  onClose,
}: {
  tripId: string;
  destinationId: string;
  destinationName: string;
  leg: TransportLeg | null;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<TransportMode | null>(leg?.mode ?? null);
  const [carrier, setCarrier] = useState(leg?.carrier ?? "");
  const initialDuration = splitDuration(leg?.duration_minutes ?? null);
  const [hours, setHours] = useState(initialDuration.hours);
  const [mins, setMins] = useState(initialDuration.mins);
  const [distance, setDistance] = useState(
    leg?.distance_km ? String(leg.distance_km) : "",
  );
  const [notes, setNotes] = useState(leg?.notes ?? "");
  // Details stay folded away unless the leg already has some: the common case
  // is a mode and nothing else.
  const [detailsOpen, setDetailsOpen] = useState(
    Boolean(leg?.carrier || leg?.duration_minutes || leg?.distance_km || leg?.notes),
  );
  const [busy, setBusy] = useState(false);

  async function save(next: TransportMode) {
    setBusy(true);
    const durationMinutes =
      (Number(hours) || 0) * 60 + (Number(mins) || 0) || null;
    const result = await saveTransportLegAction(tripId, destinationId, {
      mode: next,
      carrier: carrier || null,
      duration_minutes: durationMinutes,
      distance_km: Number(distance) || null,
      notes: notes || null,
    }).catch(() => ({ error: "Could not save that leg." }));
    setBusy(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    onClose();
  }

  async function remove() {
    setBusy(true);
    const result = await deleteTransportLegAction(destinationId).catch(() => ({
      error: "Could not remove that leg.",
    }));
    setBusy(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    onClose();
  }

  // Picking a mode with no details open is the whole interaction: save on tap.
  // With details open it only selects, so the fields below can be filled first.
  function pick(next: TransportMode) {
    setMode(next);
    if (!detailsOpen) void save(next);
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>How did you get to {destinationName}?</DialogTitle>
          <DialogDescription>
            Pick how you travelled. Everything else is optional.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-4 gap-2">
          {TRANSPORT_MODES.map((info) => {
            const active = info.mode === mode;
            return (
              <button
                key={info.mode}
                type="button"
                disabled={busy}
                aria-pressed={active}
                onClick={() => pick(info.mode)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border px-1 py-2.5 text-[11px] transition-colors disabled:opacity-50",
                  active
                    ? "border-brand bg-brand/15 text-foreground"
                    : "border-white/10 bg-white/[0.03] text-foreground/60 hover:bg-white/[0.07] hover:text-foreground",
                )}
              >
                <TransportModeIcon mode={info.mode} className="size-4" />
                {info.label}
              </button>
            );
          })}
        </div>

        {detailsOpen ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="leg-carrier">Carrier or label</Label>
              <Input
                id="leg-carrier"
                value={carrier}
                onChange={(event) => setCarrier(event.target.value)}
                placeholder="Eurostar, BA 342, the night bus"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="leg-hours">Hours</Label>
                <Input
                  id="leg-hours"
                  type="number"
                  min={0}
                  value={hours}
                  onChange={(event) => setHours(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="leg-mins">Minutes</Label>
                <Input
                  id="leg-mins"
                  type="number"
                  min={0}
                  max={59}
                  value={mins}
                  onChange={(event) => setMins(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="leg-distance">Distance (km)</Label>
                <Input
                  id="leg-distance"
                  type="number"
                  min={0}
                  value={distance}
                  onChange={(event) => setDistance(event.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="leg-notes">Notes</Label>
              <Textarea
                id="leg-notes"
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Anything worth remembering about the journey"
              />
            </div>
            <p className="text-xs text-foreground/35">
              Distance is optional. Without it, this leg is measured as the
              straight line between the two stops.
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDetailsOpen(true)}
            className="self-start text-xs text-foreground/45 transition-colors hover:text-foreground/80"
          >
            Add details
          </button>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {leg ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={remove}
            >
              Remove
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            {detailsOpen ? (
              <Button
                type="button"
                disabled={!mode || busy}
                onClick={() => mode && save(mode)}
                className="bg-brand text-brand-foreground hover:bg-brand/90"
              >
                {busy ? "Saving..." : "Save"}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { setPhotoLocation } from "@/lib/actions/photos";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";

/** A destination the fix-location picker can snap a photo to. */
export interface FixLocationDestination {
  id: string;
  name: string;
}

// Manual location override for a mislocated photo: snap it to one of the
// user's destinations, or clear its GPS so it falls back to its owner's
// location. Two taps: pick a destination, confirm.
export function FixLocationDialog({
  photoId,
  destinations,
  isDemo = false,
  onDone,
  onCancel,
}: {
  photoId: string;
  destinations: FixLocationDestination[];
  isDemo?: boolean;
  /** Called after a successful update so the host can refresh its data. */
  onDone: () => void;
  onCancel: () => void;
}) {
  const [destId, setDestId] = useState("");
  const [busy, setBusy] = useState(false);

  async function apply(target: { destinationId: string } | "clear") {
    if (isDemo) {
      toast.error(DEMO_READONLY_MESSAGE);
      return;
    }
    setBusy(true);
    const result = await setPhotoLocation(photoId, target).catch(() => ({
      error: "Could not update the photo location.",
    }));
    setBusy(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success(
      target === "clear"
        ? "Photo location cleared. It now follows its destination."
        : "Photo location updated.",
    );
    onDone();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Fix photo location</DialogTitle>
          <DialogDescription>
            Place this photo at one of your destinations, or clear its GPS so
            it falls back to where it is tagged.
          </DialogDescription>
        </DialogHeader>

        <Select value={destId} onValueChange={setDestId}>
          <SelectTrigger aria-label="Destination">
            <SelectValue placeholder="Choose destination" />
          </SelectTrigger>
          <SelectContent>
            {destinations.map((dest) => (
              <SelectItem key={dest.id} value={dest.id}>
                {dest.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => apply("clear")}
          >
            Clear GPS
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!destId || busy}
              onClick={() => apply({ destinationId: destId })}
              className="bg-brand text-brand-foreground hover:bg-brand/90"
            >
              {busy ? "Saving..." : "Use destination"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

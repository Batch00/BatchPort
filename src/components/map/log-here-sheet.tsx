"use client";

// The point of Nearby mode: one or two taps from opening the app to a logged
// experience at the coordinates you are standing on.
//
// Everything that can be inferred already is. The name arrives prefilled when
// a geosearch result is close enough to be the thing in front of you, the
// category follows from that result, the destination defaults to the stop the
// device fix landed in, and the visited date is today. On a good day the user
// types nothing and taps Save.

import { useState } from "react";
import { toast } from "sonner";
import { Loader2Icon, MapPinIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RatingInput } from "@/components/rating-input";
import { CategoryIcon } from "@/components/category-icon";
import { createExperienceAction } from "@/lib/actions/experiences";
import { enqueue } from "@/lib/offline/queue";
import { useOnlineStatus } from "@/lib/offline/use-offline";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { formatProximity, localToday, type NearbyPosition } from "@/lib/nearby";
import type { Category } from "@/lib/types";

/** A destination the log can be filed under, with its distance from the fix
 * when one is known (used to order and label the picker). */
export interface LogHereDestination {
  id: string;
  name: string;
  tripId: string;
  tripName: string;
  km: number | null;
}

interface LogHereSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: NearbyPosition;
  categories: Category[];
  /** Every destination the user has, nearest first. */
  destinations: LogHereDestination[];
  /** The stop the fix landed in, preselected when there is one. */
  defaultDestinationId: string | null;
  /** Name of the closest attraction, when one is close enough to be it. */
  defaultName: string;
  isDemo: boolean;
  onLogged: () => void;
}

export function LogHereSheet(props: LogHereSheetProps) {
  const { open, onOpenChange } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log something here</DialogTitle>
        </DialogHeader>
        {/* Keyed on the prefill so a new nearest attraction remounts the form
            with fresh defaults instead of stranding stale ones. */}
        <LogHereForm
          key={`${props.defaultName}|${props.defaultDestinationId ?? ""}`}
          {...props}
        />
      </DialogContent>
    </Dialog>
  );
}

function LogHereForm({
  position,
  categories,
  destinations,
  defaultDestinationId,
  defaultName,
  isDemo,
  onOpenChange,
  onLogged,
}: LogHereSheetProps) {
  const [name, setName] = useState(defaultName);
  // The geosearch layer that supplies the name prefill carries no category, so
  // this is the one field that always starts empty.
  const [categoryId, setCategoryId] = useState("");
  const [rating, setRating] = useState(0);
  const [destinationId, setDestinationId] = useState(
    defaultDestinationId ?? "",
  );
  const [submitting, setSubmitting] = useState(false);
  const online = useOnlineStatus();

  const destination = destinations.find((item) => item.id === destinationId);
  const canSave = name.trim().length > 0 && Boolean(destination);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!destination || submitting) return;
    if (isDemo) {
      toast.error(DEMO_READONLY_MESSAGE);
      return;
    }
    setSubmitting(true);

    // Standing somewhere with no signal is the case this sheet was built for,
    // so it queues rather than refusing. The coordinate is still the one the
    // user deliberately attached to a record they are creating, and it goes no
    // further than this device until the write replays.
    if (!online) {
      const stored = await enqueue({
        kind: "experience.create",
        destinationId: destination.id,
        destinationName: destination.name,
        name: name.trim(),
        categoryId: categoryId || null,
        rating: rating || null,
        visitedDate: localToday(),
        notes: null,
        status: "done",
        lat: position.lat,
        lng: position.lng,
      });
      setSubmitting(false);
      if (!stored) {
        toast.error("Could not save that offline.", {
          description:
            "This browser is not storing offline changes, so nothing was recorded.",
        });
        return;
      }
      toast.success(`Logged ${name.trim()} in ${destination.name}`, {
        description: "Queued on this device, sending when you reconnect.",
      });
      onOpenChange(false);
      return;
    }

    const result = await createExperienceAction(
      destination.tripId,
      destination.id,
      {
        name: name.trim(),
        category_id: categoryId || null,
        rating: rating || null,
        visited_date: localToday(),
        notes: null,
        status: "done",
        // The one place a device coordinate is written anywhere: this record,
        // which the user is deliberately creating.
        lat: position.lat,
        lng: position.lng,
      },
    );
    setSubmitting(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success(`Logged ${name.trim()} in ${destination.name}`);
    onOpenChange(false);
    onLogged();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="nearby-name">What is it</Label>
        <Input
          id="nearby-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name this place or moment"
          autoComplete="off"
          required
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nearby-category">Category</Label>
          <Select
            value={categoryId}
            onValueChange={(value) => setCategoryId(value)}
          >
            <SelectTrigger id="nearby-category">
              <SelectValue placeholder="Optional" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  <span className="flex items-center gap-2">
                    <CategoryIcon icon={category.icon} className="size-3.5" />
                    {category.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nearby-destination">Destination</Label>
          <Select
            value={destinationId}
            onValueChange={(value) => setDestinationId(value)}
          >
            <SelectTrigger id="nearby-destination">
              <SelectValue placeholder="Choose a stop" />
            </SelectTrigger>
            <SelectContent>
              {destinations.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                  <span className="text-foreground/45">
                    {" "}
                    ·{" "}
                    {item.km !== null ? formatProximity(item.km) : item.tripName}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Rating</Label>
        <div className="flex flex-wrap items-center gap-3">
          <RatingInput value={rating} onChange={setRating} size={26} />
          {rating > 0 ? (
            <button
              type="button"
              onClick={() => setRating(0)}
              className="text-xs text-foreground/50 underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              Clear
            </button>
          ) : (
            <span className="text-xs text-foreground/40">Optional</span>
          )}
        </div>
      </div>

      <p className="flex items-start gap-1.5 text-xs text-foreground/45">
        <MapPinIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Saved at your current coordinates, dated today
          {position.accuracyM !== null
            ? `. Your device reports about ${position.accuracyM}m of accuracy.`
            : "."}
        </span>
      </p>

      {destinations.length === 0 ? (
        <p className="text-xs text-amber-300/80">
          Add a destination to a trip first, then this can file itself under it.
        </p>
      ) : null}

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave || submitting || isDemo}>
          {submitting ? <Loader2Icon className="animate-spin" /> : null}
          Log it
        </Button>
      </DialogFooter>
    </form>
  );
}

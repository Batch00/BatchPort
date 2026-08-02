"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CoverPhotoPicker } from "@/components/photos/cover-photo-picker";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { createTripAction, updateTripAction } from "@/lib/actions/trips";
import { formatDateRange } from "@/lib/format";
import type { TripInput } from "@/lib/trips";
import type { CoverPosition, Photo, TripStatus } from "@/lib/types";

export interface TripFormValues {
  name: string;
  start_date: string;
  end_date: string;
  status: TripStatus;
  notes: string;
}

interface TripFormProps {
  mode: "create" | "edit";
  tripId?: string;
  userId: string;
  isDemo: boolean;
  defaultValues?: TripFormValues;
  coverPhotos?: Photo[];
  coverPhotoId?: string | null;
  coverPosition?: CoverPosition | null;
  /** The range this trip's dated stops describe, when they describe one. Its
   * presence means the trip's dates are not the user's to type here: they come
   * from the destinations, and the field shows the result instead of inviting
   * an entry the next destination write would overwrite. */
  derivedDates?: { start: string; end: string } | null;
}

const EMPTY: TripFormValues = {
  name: "",
  start_date: "",
  end_date: "",
  status: "completed",
  notes: "",
};

function toInput(values: TripFormValues): TripInput {
  return {
    name: values.name.trim(),
    start_date: values.start_date || null,
    end_date: values.end_date || null,
    status: values.status,
    notes: values.notes.trim() || null,
  };
}

export function TripForm({
  mode,
  tripId,
  userId,
  isDemo,
  defaultValues,
  coverPhotos = [],
  coverPhotoId = null,
  coverPosition = null,
  derivedDates = null,
}: TripFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<TripFormValues>(defaultValues ?? EMPTY);
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof TripFormValues>(key: K, value: TripFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!values.name.trim()) {
      toast.error("Trip name is required.");
      return;
    }
    if (
      values.start_date &&
      values.end_date &&
      values.end_date < values.start_date
    ) {
      toast.error("End date cannot be before the start date.");
      return;
    }
    setSubmitting(true);
    const input = toInput(values);
    const result =
      mode === "create"
        ? await createTripAction(input)
        : await updateTripAction(tripId as string, input);

    // A successful action redirects and never returns. A returned error means
    // the write was blocked (for example, the demo account).
    if (result && "error" in result) {
      toast.error(result.error);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="grid gap-2">
        <Label htmlFor="name">Trip name</Label>
        <Input
          id="name"
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Western Europe Summer 2023"
          required
          disabled={submitting}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="trip_dates">Dates</Label>
        {derivedDates ? (
          // The stops already say when this trip was. Showing a second,
          // editable answer would be offering the user a way to be wrong.
          <>
            <div
              id="trip_dates"
              className="flex h-10 w-full items-center rounded-md border border-white/10 bg-white/[0.03] px-3 text-sm text-foreground/80"
            >
              {formatDateRange(derivedDates.start, derivedDates.end)}
            </div>
            <p className="text-xs text-foreground/50">
              Taken from this trip&apos;s destinations, from the earliest
              arrival to the latest departure. Edit a stop&apos;s dates to
              change it.
            </p>
          </>
        ) : (
          <>
            <DateRangePicker
              id="trip_dates"
              start={values.start_date}
              end={values.end_date}
              onChange={(start, end) =>
                setValues((prev) => ({
                  ...prev,
                  start_date: start,
                  end_date: end,
                }))
              }
              disabled={submitting}
              placeholder="Pick the trip dates"
            />
            <p className="text-xs text-foreground/50">
              Once your destinations have dates, this range comes from them
              instead.
            </p>
          </>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="status">Status</Label>
        <Select
          value={values.status}
          onValueChange={(value) => set("status", value as TripStatus)}
          disabled={submitting}
        >
          <SelectTrigger id="status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="ongoing">Ongoing</SelectItem>
            <SelectItem value="planned">Planned</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          value={values.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="Anything worth remembering about this trip"
          disabled={submitting}
        />
      </div>

      <div className="grid gap-2">
        <Label>Cover photo</Label>
        <CoverPhotoPicker
          ownerType="trip"
          ownerId={mode === "edit" ? tripId : undefined}
          userId={userId}
          isDemo={isDemo}
          photos={coverPhotos}
          coverPhotoId={coverPhotoId}
          coverPosition={coverPosition}
        />
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="submit"
          disabled={submitting}
          className="bg-brand text-brand-foreground hover:bg-brand/90"
        >
          {submitting ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : mode === "create" ? (
            "Create trip"
          ) : (
            "Save changes"
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={submitting}
          onClick={() =>
            router.push(mode === "edit" && tripId ? `/trips/${tripId}` : "/dashboard")
          }
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

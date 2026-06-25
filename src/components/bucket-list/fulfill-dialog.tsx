"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fulfillBucketItem } from "@/lib/actions/bucket-list";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { bucketItemName } from "@/lib/bucket-format";
import { formatDateRange } from "@/lib/format";
import type { BucketItem } from "@/lib/bucket-list";

export interface TripOption {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
}

interface FulfillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: BucketItem;
  trips: TripOption[];
  isDemo: boolean;
  onFulfilled: () => void;
}

export function FulfillDialog({
  open,
  onOpenChange,
  item,
  trips,
  isDemo,
  onFulfilled,
}: FulfillDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark as completed</DialogTitle>
          <DialogDescription>
            Which trip took you to {bucketItemName(item)}?
          </DialogDescription>
        </DialogHeader>
        <FulfillForm
          item={item}
          trips={trips}
          isDemo={isDemo}
          onCancel={() => onOpenChange(false)}
          onFulfilled={() => {
            onOpenChange(false);
            onFulfilled();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function FulfillForm({
  item,
  trips,
  isDemo,
  onCancel,
  onFulfilled,
}: {
  item: BucketItem;
  trips: TripOption[];
  isDemo: boolean;
  onCancel: () => void;
  onFulfilled: () => void;
}) {
  const [tripId, setTripId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    if (isDemo) {
      toast.error(DEMO_READONLY_MESSAGE);
      return;
    }
    if (!tripId) {
      toast.error("Select the trip that completed this.");
      return;
    }
    setSubmitting(true);
    const result = await fulfillBucketItem(item.id, tripId);
    setSubmitting(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    onFulfilled();
  }

  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="fulfill-trip">Trip</Label>
        {trips.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You have no trips yet. Add a trip first.
          </p>
        ) : (
          <Select value={tripId} onValueChange={setTripId}>
            <SelectTrigger id="fulfill-trip">
              <SelectValue placeholder="Select a trip" />
            </SelectTrigger>
            <SelectContent>
              {trips.map((trip) => (
                <SelectItem key={trip.id} value={trip.id}>
                  {trip.name}
                  {formatDateRange(trip.start_date, trip.end_date)
                    ? ` (${formatDateRange(trip.start_date, trip.end_date)})`
                    : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          disabled={submitting}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          disabled={submitting || trips.length === 0}
          onClick={handleConfirm}
          className="bg-brand text-brand-foreground hover:bg-brand/90"
        >
          {submitting ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            "Mark completed"
          )}
        </Button>
      </DialogFooter>
    </>
  );
}

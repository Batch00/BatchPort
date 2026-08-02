"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import { LocationSearch } from "@/components/location-search";
import { CountryCombobox } from "@/components/bucket-list/country-combobox";
import { createBucketItem, updateBucketItem } from "@/lib/actions/bucket-list";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { useConnectionGuard } from "@/lib/offline/use-offline";
import { cn } from "@/lib/utils";
import type {
  BucketItem,
  BucketItemInput,
  BucketType,
  CountryOption,
} from "@/lib/bucket-list";
import type { GeoLocation } from "@/lib/types";

interface BucketItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: BucketItem | null;
  countries: CountryOption[];
  isDemo: boolean;
  onSaved: () => void;
}

// The dialog keeps the open state; the form lives in a child so it mounts fresh
// (and therefore resets from the current item) each time the dialog opens,
// without a reset effect.
export function BucketItemDialog({
  open,
  onOpenChange,
  item,
  countries,
  isDemo,
  onSaved,
}: BucketItemDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {item ? "Edit bucket list item" : "Add to bucket list"}
          </DialogTitle>
        </DialogHeader>
        <BucketItemForm
          item={item}
          countries={countries}
          isDemo={isDemo}
          onCancel={() => onOpenChange(false)}
          onSaved={() => {
            onOpenChange(false);
            onSaved();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function BucketItemForm({
  item,
  countries,
  isDemo,
  onCancel,
  onSaved,
}: {
  item: BucketItem | null;
  countries: CountryOption[];
  isDemo: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<BucketType>(item?.type ?? "country");
  const [countryCode, setCountryCode] = useState<string | null>(
    item?.country_code ?? null,
  );
  const [placeName, setPlaceName] = useState(item?.place_name ?? "");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    item && item.lat !== null && item.lng !== null
      ? { lat: item.lat, lng: item.lng }
      : null,
  );
  const [targetDate, setTargetDate] = useState(item?.target_date ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const blockedOffline = useConnectionGuard();

  function handlePlaceChange(location: GeoLocation) {
    setPlaceName(location.name);
    setCoords({ lat: location.lat, lng: location.lng });
    // Default the optional country override to the geocoded country.
    if (location.country_code) setCountryCode(location.country_code);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blockedOffline("Saving a bucket list item")) return;
    if (isDemo) {
      toast.error(DEMO_READONLY_MESSAGE);
      return;
    }
    if (type === "country" && !countryCode) {
      toast.error("Choose a country.");
      return;
    }
    if (type === "place" && !placeName.trim()) {
      toast.error("Search for and select a place.");
      return;
    }

    const input: BucketItemInput = {
      type,
      country_code: countryCode,
      place_name: type === "place" ? placeName.trim() : null,
      lat: type === "place" ? coords?.lat ?? null : null,
      lng: type === "place" ? coords?.lng ?? null : null,
      // Rank is set by dragging on the board; editing keeps the current rank.
      priority: item?.priority ?? null,
      target_date: targetDate || null,
      notes: notes.trim() || null,
    };

    setSubmitting(true);
    const result = item
      ? await updateBucketItem(item.id, input)
      : await createBucketItem(input);
    setSubmitting(false);

    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label>Type</Label>
        <div className="grid grid-cols-2 gap-2">
          {(["country", "place"] as BucketType[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setType(option)}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                type === option
                  ? "border-brand bg-brand/15 text-foreground"
                  : "border-input bg-input/30 text-foreground/60 hover:text-foreground",
              )}
            >
              {option === "country" ? "Country" : "Specific place"}
            </button>
          ))}
        </div>
      </div>

      {type === "country" ? (
        <div className="grid gap-2">
          <Label htmlFor="bucket-country">Country</Label>
          <CountryCombobox
            id="bucket-country"
            countries={countries}
            value={countryCode}
            onChange={setCountryCode}
          />
        </div>
      ) : (
        <>
          <div className="grid gap-2">
            <Label htmlFor="bucket-place">Place</Label>
            <LocationSearch
              id="bucket-place"
              defaultQuery={item?.place_name ?? ""}
              placeholder="Search for a place"
              onChange={handlePlaceChange}
            />
            {placeName ? (
              <p className="text-sm text-foreground/70">
                Selected:{" "}
                <span className="font-medium text-foreground">{placeName}</span>
              </p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bucket-place-country">Country (optional)</Label>
            <CountryCombobox
              id="bucket-place-country"
              countries={countries}
              value={countryCode}
              onChange={setCountryCode}
              allowClear
            />
          </div>
        </>
      )}

      <div className="grid gap-2">
        <Label htmlFor="bucket-target">Target date</Label>
        <Input
          id="bucket-target"
          type="date"
          value={targetDate}
          onChange={(event) => setTargetDate(event.target.value)}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="bucket-notes">Notes</Label>
        <Textarea
          id="bucket-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Why this place? e.g., cherry blossom season, Anna's recommendation"
          rows={3}
        />
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
          type="submit"
          disabled={submitting}
          className="bg-brand text-brand-foreground hover:bg-brand/90"
        >
          {submitting ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : item ? (
            "Save changes"
          ) : (
            "Add to bucket list"
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}

"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2Icon, MapIcon, MapPinIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LocationSearch } from "@/components/location-search";
import { CoverPhotoPicker } from "@/components/photos/cover-photo-picker";
import {
  createDestinationAction,
  updateDestinationAction,
} from "@/lib/actions/destinations";
import { CountryFlag } from "@/components/country-flag";
import type { DestinationInput } from "@/lib/destinations";
import type { CoverPosition, GeoLocation, Photo } from "@/lib/types";
import type { GlobeBucketPlace } from "@/components/map/globe";
import type { PickerDestination } from "@/components/destinations/map-destination-picker";

// The map picker pulls in the whole globe stack, so it stays out of the form
// bundle until the user actually opens it.
const MapDestinationPicker = dynamic(
  () =>
    import("@/components/destinations/map-destination-picker").then(
      (module) => module.MapDestinationPicker,
    ),
  { ssr: false },
);

interface DestinationFormProps {
  mode: "create" | "edit";
  tripId: string;
  destinationId?: string;
  userId: string;
  isDemo: boolean;
  defaultLocation?: GeoLocation | null;
  defaultLocationQuery?: string;
  defaultArrival?: string;
  defaultDeparture?: string;
  defaultNotes?: string;
  coverPhotos?: Photo[];
  coverPhotoId?: string | null;
  coverPosition?: CoverPosition | null;
  // Context for the "Pick on map" flow; the button only shows when provided.
  pickerDestinations?: PickerDestination[];
  pickerBucketPlaces?: GlobeBucketPlace[];
}

export function DestinationForm({
  mode,
  tripId,
  destinationId,
  userId,
  isDemo,
  defaultLocation = null,
  defaultLocationQuery = "",
  defaultArrival = "",
  defaultDeparture = "",
  defaultNotes = "",
  coverPhotos = [],
  coverPhotoId = null,
  coverPosition = null,
  pickerDestinations,
  pickerBucketPlaces = [],
}: DestinationFormProps) {
  const router = useRouter();
  const [location, setLocation] = useState<GeoLocation | null>(defaultLocation);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [arrival, setArrival] = useState(defaultArrival);
  const [departure, setDeparture] = useState(defaultDeparture);
  const [notes, setNotes] = useState(defaultNotes);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!location) {
      toast.error("Search for and select a location.");
      return;
    }
    if (arrival && departure && departure < arrival) {
      toast.error("Departure date cannot be before the arrival date.");
      return;
    }
    setSubmitting(true);
    const input: DestinationInput = {
      name: location.name,
      country_code: location.country_code,
      admin_region: location.admin_region,
      lat: location.lat,
      lng: location.lng,
      arrival_date: arrival || null,
      departure_date: departure || null,
      notes: notes.trim() || null,
    };
    const result =
      mode === "create"
        ? await createDestinationAction(tripId, input)
        : await updateDestinationAction(tripId, destinationId as string, input);

    if (result && "error" in result) {
      toast.error(result.error);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="grid gap-2">
        <Label htmlFor="location">Location</Label>
        <div className="flex gap-2">
          <LocationSearch
            id="location"
            // Remount after a map pick so the input shows the picked name.
            key={location ? `${location.name}:${location.lat}` : "empty"}
            defaultQuery={location?.name ?? defaultLocationQuery}
            onChange={setLocation}
            className="flex-1"
          />
          {pickerDestinations ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setPickerOpen(true)}
              disabled={submitting}
              title="Pick on map"
            >
              <MapIcon />
              <span className="hidden sm:inline">Pick on map</span>
            </Button>
          ) : null}
        </div>
        {location ? (
          <p className="flex items-center gap-1.5 text-sm text-foreground/70">
            <MapPinIcon className="size-3.5 text-brand" />
            <span className="font-medium text-foreground">{location.name}</span>
            {location.country_code ? (
              <span className="text-foreground/50">
                <CountryFlag code={location.country_code} />{" "}
                {[location.admin_region, location.country]
                  .filter(Boolean)
                  .join(", ") || location.country_code}
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="arrival">Arrival date</Label>
          <Input
            id="arrival"
            type="date"
            value={arrival}
            onChange={(e) => setArrival(e.target.value)}
            disabled={submitting}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="departure">Departure date</Label>
          <Input
            id="departure"
            type="date"
            value={departure}
            onChange={(e) => setDeparture(e.target.value)}
            disabled={submitting}
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="dest-notes">Notes</Label>
        <Textarea
          id="dest-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Where you stayed, how you got around, anything notable"
          disabled={submitting}
        />
      </div>

      <div className="grid gap-2">
        <Label>Cover photo</Label>
        <CoverPhotoPicker
          ownerType="destination"
          ownerId={mode === "edit" ? destinationId : undefined}
          userId={userId}
          isDemo={isDemo}
          photos={coverPhotos}
          coverPhotoId={coverPhotoId}
          coverPosition={coverPosition}
          suggestQuery={location?.name}
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
            "Add destination"
          ) : (
            "Save changes"
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={submitting}
          onClick={() =>
            router.push(
              mode === "edit" && destinationId
                ? `/trips/${tripId}/destinations/${destinationId}`
                : `/trips/${tripId}`,
            )
          }
        >
          Cancel
        </Button>
      </div>

      {pickerOpen && pickerDestinations ? (
        <MapDestinationPicker
          destinations={pickerDestinations}
          bucketPlaces={pickerBucketPlaces}
          onPick={(picked) => {
            setLocation(picked);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </form>
  );
}

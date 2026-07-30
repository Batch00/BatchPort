"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HouseIcon, Loader2Icon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { LocationSearch } from "@/components/location-search";
import { CountryFlag } from "@/components/country-flag";
import { updateHomeLocation } from "@/lib/actions/home-location";
import { homeLabel, type HomeLocation } from "@/lib/home-location";
import type { GeoLocation } from "@/lib/types";

interface HomeLocationFormProps {
  initial: HomeLocation | null;
  isDemo: boolean;
}

// Home city picker. Setting a home unlocks the distance-from-home lines on
// trips and destinations, the furthest-from-home stat, and the timezone chip
// on trip planning. Leaving it unset is a first-class state: nothing anywhere
// nags about it, so the copy here explains the upside rather than the gap.
export function HomeLocationForm({ initial, isDemo }: HomeLocationFormProps) {
  const router = useRouter();
  const [home, setHome] = useState<HomeLocation | null>(initial);
  const [saving, setSaving] = useState(false);

  async function handleSelect(location: GeoLocation) {
    if (isDemo) {
      toast.error("Demo account settings are read-only.");
      return;
    }
    setSaving(true);
    const result = await updateHomeLocation({
      name: location.name,
      country_code: location.country_code,
      lat: location.lat,
      lng: location.lng,
    });
    setSaving(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    setHome({
      name: location.name,
      country_code: location.country_code,
      lat: location.lat,
      lng: location.lng,
    });
    toast.success("Home location saved.");
    router.refresh();
  }

  async function handleClear() {
    if (isDemo) {
      toast.error("Demo account settings are read-only.");
      return;
    }
    setSaving(true);
    const result = await updateHomeLocation(null);
    setSaving(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    setHome(null);
    toast.success("Home location cleared.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium text-foreground">Home location</p>
        <p className="text-xs text-muted-foreground">
          Your home city unlocks distance-from-home on trips and destinations, a
          furthest-from-home record, and local time offsets while planning.
        </p>
      </div>

      {home ? (
        <div className="flex min-w-0 items-center gap-2 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <HouseIcon className="size-4" />
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            {home.country_code ? (
              <CountryFlag code={home.country_code} className="h-3.5" />
            ) : null}
            <span className="min-w-0 truncate text-sm text-foreground">
              {homeLabel(home)}
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving || isDemo}
            onClick={handleClear}
          >
            {saving ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <>
                <XIcon />
                Clear
              </>
            )}
          </Button>
        </div>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor="home-location-search">
          {home ? "Change your home city" : "Set your home city"}
        </Label>
        <LocationSearch
          id="home-location-search"
          placeholder="Search for your home city"
          onChange={handleSelect}
        />
      </div>
    </div>
  );
}

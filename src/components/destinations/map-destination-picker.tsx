"use client";

import { useEffect, useState } from "react";
import { Loader2Icon, MapPinIcon, XIcon } from "lucide-react";

import { Globe, type GlobeBucketPlace } from "@/components/map/globe";
import { flagEmoji } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { GeoLocation } from "@/lib/types";
import type { DiscoverCity } from "@/lib/discover";

// Full-screen map picker for the add-destination form. Clicking any country
// surfaces its top cities (the discover cities data); clicking a city, or the
// "Use as destination" action on an amber bucket place pin, fills the form's
// location fields exactly as the typeahead would. A picker, not a second
// discovery panel: no summaries, no photos beyond what the city list carries.

/** An existing stop on the trip, drawn for context and centering. */
export interface PickerDestination {
  id: string;
  name: string;
  countryCode: string | null;
  lat: number;
  lng: number;
}

interface MapDestinationPickerProps {
  destinations: PickerDestination[];
  bucketPlaces: GlobeBucketPlace[];
  onPick: (location: GeoLocation) => void;
  onClose: () => void;
}

function formatPopulation(population: number | null): string | null {
  if (!population || population <= 0) return null;
  if (population >= 1_000_000) return `${(population / 1_000_000).toFixed(1)}M`;
  if (population >= 1_000) return `${Math.round(population / 1_000)}K`;
  return String(population);
}

export function MapDestinationPicker({
  destinations,
  bucketPlaces,
  onPick,
  onClose,
}: MapDestinationPickerProps) {
  // The country whose city list is open, from a map click.
  const [country, setCountry] = useState<{ code: string; name: string } | null>(
    null,
  );
  const [cities, setCities] = useState<DiscoverCity[] | null>(null);

  // Fetch the top cities whenever a country is picked. The list is reset to
  // its loading state by the click handler that sets the country.
  useEffect(() => {
    if (!country) return;
    const controller = new AbortController();
    fetch(`/api/discover/cities?code=${country.code}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : []))
      .then((data: DiscoverCity[]) => setCities(Array.isArray(data) ? data : []))
      .catch(() => {
        if (!controller.signal.aborted) setCities([]);
      });
    return () => controller.abort();
  }, [country]);

  // Escape closes the city list first, then the picker.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setCountry((current) => {
        if (current) return null;
        onClose();
        return current;
      });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function pickCity(city: DiscoverCity) {
    if (!country) return;
    onPick({
      name: city.name,
      country: country.name,
      country_code: country.code,
      admin_region: null,
      lat: city.lat,
      lng: city.lng,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0a0a0a]">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">
            Pick a destination on the map
          </h2>
          <p className="truncate text-xs text-foreground/50">
            Click a country for its top cities, or use one of your bucket list
            pins.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close map picker"
          className="-m-2 shrink-0 rounded-md p-2.5 text-foreground/60 transition-colors hover:bg-white/5 hover:text-foreground"
        >
          <XIcon className="size-5" />
        </button>
      </div>

      {/* Map */}
      <div className="relative flex-1 overflow-hidden">
        <Globe
          visitedCountryCodes={[]}
          destinations={destinations.map((destination) => ({
            id: destination.id,
            tripId: "",
            tripName: "This trip",
            name: destination.name,
            countryCode: destination.countryCode,
            lat: destination.lat,
            lng: destination.lng,
            arrivalDate: null,
            departureDate: null,
            categoryColor: null,
          }))}
          arcs={[]}
          bucketPlaces={bucketPlaces}
          onExplorePlace={(place) =>
            onPick({
              name: place.name,
              country: null,
              country_code: place.countryCode,
              admin_region: null,
              lat: place.lat,
              lng: place.lng,
            })
          }
          explorePlaceLabel="Use as destination"
          autoRotate={false}
          fitToData={destinations.length > 0}
          enableDiscovery
          onDiscoverCountry={(selection) => {
            setCountry(selection);
            setCities(null);
          }}
        />

        {/* City list: side card on desktop, bottom sheet on mobile. */}
        {country ? (
          <div className="absolute inset-x-0 bottom-0 z-30 flex max-h-[45dvh] flex-col rounded-t-2xl border-t border-white/10 bg-black/90 shadow-2xl backdrop-blur-md sm:inset-x-auto sm:bottom-auto sm:right-3 sm:top-3 sm:max-h-[calc(100%-1.5rem)] sm:w-72 sm:rounded-xl sm:border">
            <div className="flex items-start justify-between gap-2 border-b border-white/10 px-4 py-3">
              <div className="min-w-0">
                <h3 className="flex items-center gap-1.5 truncate text-sm font-semibold">
                  <span>{flagEmoji(country.code)}</span>
                  <span className="truncate">{country.name}</span>
                </h3>
                <p className="text-xs text-foreground/45">
                  Pick a city to use as the destination
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCountry(null)}
                aria-label="Close city list"
                className="-m-1.5 shrink-0 rounded-md p-2 text-foreground/60 transition-colors hover:bg-white/5 hover:text-foreground"
              >
                <XIcon className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:pb-2">
              {cities === null ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-foreground/50">
                  <Loader2Icon className="size-4 animate-spin" />
                  Loading cities
                </div>
              ) : cities.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-foreground/45">
                  No city data for {country.name}. Use the search field instead.
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {cities.map((city) => {
                    const population = formatPopulation(city.population);
                    return (
                      <li key={city.name}>
                        <button
                          type="button"
                          onClick={() => pickCity(city)}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors",
                            "hover:bg-brand/15 focus-visible:bg-brand/15 focus-visible:outline-none",
                          )}
                        >
                          <MapPinIcon className="size-3.5 shrink-0 text-brand" />
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">
                            {city.name}
                          </span>
                          {population ? (
                            <span className="shrink-0 text-xs text-foreground/40">
                              {population}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

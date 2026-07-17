"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  XIcon,
  MapPinIcon,
  PlusIcon,
  BarChart3Icon,
  CompassIcon,
} from "lucide-react";

import {
  Globe,
  type GlobeDestination,
  type GlobeCountrySelection,
} from "./globe";
import type { MapData, MapDestination } from "@/lib/map-data";
import { flagEmoji, formatDateRange } from "@/lib/format";
import { placeKey } from "@/lib/geo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";

import type { DiscoveryCityTarget } from "@/components/discover/discovery-panel";
import {
  GlobeSearch,
  type GlobeSearchSelection,
} from "@/components/discover/globe-search";

// The discovery panel (hero, summaries, city grid) only mounts on demand, so
// it stays out of the initial dashboard bundle.
const DiscoveryPanel = dynamic(
  () =>
    import("@/components/discover/discovery-panel").then(
      (module) => module.DiscoveryPanel,
    ),
  { ssr: false },
);

interface DashboardGlobeProps {
  data: MapData;
}

interface TripGroup {
  tripId: string;
  tripName: string;
  destinations: MapDestination[];
}

// What the discovery panel is pointed at: a country, optionally opened straight
// onto one of its cities (from a search result).
interface DiscoverTarget {
  code: string;
  name: string;
  city: DiscoveryCityTarget | null;
}

// Group the selected country's destinations by trip, preserving the order they
// arrive in (already sorted by trip start date, then visit order).
function groupByTrip(destinations: MapDestination[]): TripGroup[] {
  const groups = new Map<string, TripGroup>();
  for (const destination of destinations) {
    const existing = groups.get(destination.tripId);
    if (existing) {
      existing.destinations.push(destination);
    } else {
      groups.set(destination.tripId, {
        tripId: destination.tripId,
        tripName: destination.tripName,
        destinations: [destination],
      });
    }
  }
  return Array.from(groups.values());
}

export function DashboardGlobe({ data }: DashboardGlobeProps) {
  const {
    destinations,
    visitedCountryCodes,
    plannedCountryCodes,
    bucketCountryCodes,
    bucketPlaces,
    arcs,
    stats,
  } = data;
  const [selected, setSelected] = useState<GlobeCountrySelection | null>(null);
  // Discovery panel target: a country picked on the globe, from the drill-down's
  // Explore button, or from search (optionally landing straight on a city view).
  // Only one panel is open at a time, so opening either closes the other.
  const [discover, setDiscover] = useState<DiscoverTarget | null>(null);
  // Camera fly-to target, set when a search result opens discovery so the map
  // travels to what the panel is showing.
  const [focus, setFocus] = useState<{
    lat: number;
    lng: number;
    zoom?: number;
  } | null>(null);
  const router = useRouter();
  // Manual refresh: re-fetches the dashboard's server data (map + stats)
  // without a full page reload. The transition keeps the spinner going until
  // the refreshed payload has streamed in.
  const [refreshing, startRefresh] = useTransition();
  // While the replay runs, the dashboard chrome (stats pills, search, panels)
  // steps aside so the globe tells the story alone.
  const [replayActive, setReplayActive] = useState(false);

  const isEmpty = destinations.length === 0;
  const canReplay = destinations.some((d) => !d.planned);

  const globeDestinations = useMemo<GlobeDestination[]>(
    () =>
      destinations.map((d) => ({
        id: d.id,
        tripId: d.tripId,
        tripName: d.tripName,
        name: d.name,
        countryCode: d.countryCode,
        lat: d.lat,
        lng: d.lng,
        arrivalDate: d.arrivalDate,
        departureDate: d.departureDate,
        categoryColor: d.category?.color ?? null,
        planned: d.planned,
        tripStartDate: d.tripStartDate,
        tripEndDate: d.tripEndDate,
        orderIndex: d.orderIndex,
      })),
    [destinations],
  );

  // Stable identity so the discovery panel does not re-render on unrelated
  // dashboard state changes.
  const bucketPlaceKeys = useMemo(
    () => bucketPlaces.map((place) => placeKey(place.name, place.countryCode)),
    [bucketPlaces],
  );

  // Amber pins need coordinates; items saved without them stay list-only.
  const globeBucketPlaces = useMemo(
    () =>
      bucketPlaces
        .filter((place) => place.lat !== null && place.lng !== null)
        .map((place) => ({
          id: place.id,
          name: place.name,
          countryCode: place.countryCode,
          lat: place.lat as number,
          lng: place.lng as number,
        })),
    [bucketPlaces],
  );

  const selectedGroups = useMemo<TripGroup[]>(() => {
    if (!selected) return [];
    return groupByTrip(
      destinations.filter((d) => d.countryCode === selected.code),
    );
  }, [selected, destinations]);

  // Escape dismisses the drill-down.
  useEffect(() => {
    if (!selected) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected]);

  return (
    <div className="relative h-[45vh] min-h-[300px] w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0d0d0d] sm:h-[60vh] sm:min-h-[380px]">
      <Globe
        visitedCountryCodes={visitedCountryCodes}
        bucketCountryCodes={bucketCountryCodes}
        plannedCountryCodes={plannedCountryCodes}
        destinations={globeDestinations}
        arcs={arcs}
        bucketPlaces={globeBucketPlaces}
        onExplorePlace={(place) => {
          if (!place.countryCode) return;
          setSelected(null);
          setDiscover({
            code: place.countryCode,
            // Placeholder until the country fetch supplies the display name.
            name: place.countryCode,
            city: { name: place.name, lat: place.lat, lng: place.lng },
          });
        }}
        focus={focus}
        autoRotate={false}
        fitToData={!isEmpty}
        enableDestinationLinks
        enableCountryDrilldown
        onCountrySelect={(selection) => {
          setSelected(selection);
          if (selection) setDiscover(null);
        }}
        enableDiscovery
        onDiscoverCountry={(selection) => {
          setDiscover(
            selection
              ? { code: selection.code, name: selection.name, city: null }
              : null,
          );
          if (selection) setSelected(null);
        }}
        onRefresh={() => startRefresh(() => router.refresh())}
        refreshing={refreshing}
        enableReplay={canReplay}
        onReplayActiveChange={(active) => {
          setReplayActive(active);
          if (active) {
            setSelected(null);
            setDiscover(null);
          }
        }}
      />

      {/* Stats overlay. Wraps within the card on narrow screens so the pills
          never push past the globe's edge. Hidden during replay, which brings
          its own readout. */}
      {!isEmpty && !replayActive ? (
        <div className="absolute left-4 right-4 top-4 z-20 flex flex-wrap items-center gap-2 pr-14">
          <div className="pointer-events-none rounded-full border border-white/10 bg-black/60 px-3.5 py-1.5 text-xs font-medium text-foreground/80 shadow-md backdrop-blur-md">
            {stats.countries} {stats.countries === 1 ? "country" : "countries"},{" "}
            {stats.trips} {stats.trips === 1 ? "trip" : "trips"},{" "}
            {stats.destinations}{" "}
            {stats.destinations === 1 ? "destination" : "destinations"}
          </div>
          <Link
            href="/dashboard/stats"
            className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand/15 px-3 py-1.5 text-xs font-medium text-foreground shadow-md backdrop-blur-md transition-colors hover:bg-brand/25"
          >
            <BarChart3Icon className="size-3.5 text-brand" />
            View stats
          </Link>
        </div>
      ) : null}

      {/* Empty state */}
      {isEmpty ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-6">
          <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-white/10 bg-black/70 px-8 py-10 text-center shadow-xl backdrop-blur-md">
            <p className="text-balance text-foreground/80">
              Your world map is empty. Add your first trip to light it up.
            </p>
            <Link
              href="/trips/new"
              className={cn(
                buttonVariants({ size: "lg" }),
                "bg-brand text-brand-foreground hover:bg-brand/90",
              )}
            >
              <PlusIcon />
              Add your first trip
            </Link>
          </div>
        </div>
      ) : null}

      {/* Country drill-down panel */}
      {selected ? (
        <div className="absolute inset-y-0 right-0 z-30 flex w-80 max-w-[85%] flex-col border-l border-white/10 bg-black/85 shadow-2xl backdrop-blur-md">
          <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 truncate text-base font-semibold tracking-tight">
                <span>{flagEmoji(selected.code)}</span>
                <span className="truncate">{selected.name}</span>
              </h2>
              <p className="mt-0.5 text-xs text-foreground/50">
                {selectedGroups.reduce((sum, g) => sum + g.destinations.length, 0)}{" "}
                {selectedGroups.reduce((sum, g) => sum + g.destinations.length, 0) ===
                1
                  ? "destination"
                  : "destinations"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label="Close"
              className="-m-2 rounded-md p-2.5 text-foreground/60 transition-colors hover:bg-white/5 hover:text-foreground"
            >
              <XIcon className="size-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {selectedGroups.length === 0 ? (
              <p className="text-sm text-foreground/50">
                No destinations in this country.
              </p>
            ) : (
              <div className="flex flex-col gap-5">
                {selectedGroups.map((group) => (
                  <div key={group.tripId} className="flex flex-col gap-2">
                    <h3 className="text-xs font-medium uppercase tracking-wide text-foreground/45">
                      {group.tripName}
                    </h3>
                    <ul className="flex flex-col gap-1">
                      {group.destinations.map((destination) => (
                        <li key={destination.id}>
                          <Link
                            href={`/trips/${destination.tripId}/destinations/${destination.id}`}
                            className="group flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/5"
                          >
                            <MapPinIcon className="mt-0.5 size-3.5 shrink-0 text-brand" />
                            <span className="min-w-0">
                              <span className="block truncate text-sm text-foreground/90 group-hover:text-foreground">
                                {destination.name}
                              </span>
                              {formatDateRange(
                                destination.arrivalDate,
                                destination.departureDate,
                              ) ? (
                                <span className="block truncate text-xs text-foreground/45">
                                  {formatDateRange(
                                    destination.arrivalDate,
                                    destination.departureDate,
                                  )}
                                </span>
                              ) : null}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Switch to the discovery view for this country. */}
          <div className="border-t border-white/10 px-4 py-3">
            <button
              type="button"
              onClick={() => {
                const target = selected;
                setSelected(null);
                setDiscover({
                  code: target.code,
                  name: target.name,
                  city: null,
                });
              }}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-brand/30 bg-brand/15 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-brand/25"
            >
              <CompassIcon className="size-4 text-brand" />
              Explore {selected.name}
            </button>
          </div>
        </div>
      ) : null}

      {/* Search: explore any city or country by name. z-30 keeps the expanded
          dropdown above the stats pills. Hidden during replay. */}
      {replayActive ? null : (
        <div className="absolute right-4 top-4 z-30 flex justify-end">
          <GlobeSearch
            onSelect={(selection: GlobeSearchSelection) => {
              setSelected(null);
              setDiscover({
                code: selection.code,
                name: selection.countryName,
                city: selection.city,
              });
              // Fly the camera to the result so the globe matches the panel.
              setFocus({
                lat: selection.lat,
                lng: selection.lng,
                zoom: selection.city ? 5.5 : 3,
              });
            }}
          />
        </div>
      )}

      {/* Discovery panel */}
      {discover ? (
        <DiscoveryPanel
          key={`${discover.code}:${discover.city?.name ?? ""}`}
          code={discover.code}
          name={discover.name}
          isOnBucketList={bucketCountryCodes.includes(discover.code)}
          bucketPlaceKeys={bucketPlaceKeys}
          initialCity={discover.city}
          onClose={() => setDiscover(null)}
          onBucketAdded={() => startRefresh(() => router.refresh())}
        />
      ) : null}
    </div>
  );
}

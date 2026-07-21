"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlusIcon, BarChart3Icon } from "lucide-react";

import {
  Globe,
  type GlobeDestination,
  type GlobeCountrySelection,
} from "./globe";
import { CountryDrilldown, groupByTrip, type TripGroup } from "./country-drilldown";
import { useGlobeFullscreen } from "./use-globe-fullscreen";
import type { MapData } from "@/lib/map-data";
import type { PhotoMapData } from "@/lib/photo-map-data";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDiscovery } from "@/components/discover/discovery-host";
import {
  GlobeSearch,
  type GlobeSearchSelection,
} from "@/components/discover/globe-search";

interface DashboardGlobeProps {
  data: MapData;
  photoData?: PhotoMapData;
}

export function DashboardGlobe({ data, photoData }: DashboardGlobeProps) {
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
  // The page-level discovery host: globe clicks, search, the drill-down's
  // Explore button, and the dashboard bucket cards all open the same panel.
  const { target: discoverTarget, open: openDiscover, close: closeDiscover } =
    useDiscovery();
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
  // Photo map mode hides the same chrome (its own header pill takes over).
  const [photoActive, setPhotoActive] = useState(false);
  // Fullscreen: the card swaps to a fixed full-viewport container. Escape is
  // panel-first: with a drill-down or discovery panel open it walks that up
  // instead of collapsing the globe.
  const { fullscreen, toggle: toggleFullscreen } = useGlobeFullscreen(
    Boolean(selected || discoverTarget),
  );

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

  // Only one panel at a time: discovery opened elsewhere on the page (a bucket
  // card below the globe) also dismisses the drill-down. Render-time state
  // reset (the React pattern for deriving state from props without an effect).
  const [prevTarget, setPrevTarget] = useState(discoverTarget);
  if (prevTarget !== discoverTarget) {
    setPrevTarget(discoverTarget);
    if (discoverTarget) setSelected(null);
  }

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
    <div
      className={cn(
        "overflow-hidden bg-[#0d0d0d]",
        // z-30 keeps the fullscreen globe below the discovery overlay host
        // (z-40) so the panel still layers above it.
        fullscreen
          ? "fixed inset-0 z-30"
          : "relative h-[45vh] min-h-[300px] w-full rounded-2xl border border-white/10 sm:h-[60vh] sm:min-h-[380px]",
      )}
    >
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
          openDiscover({
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
          if (selection) closeDiscover();
        }}
        enableDiscovery
        onDiscoverCountry={(selection) => {
          if (selection) {
            setSelected(null);
            openDiscover({
              code: selection.code,
              name: selection.name,
              city: null,
            });
          } else {
            closeDiscover();
          }
        }}
        onRefresh={() => startRefresh(() => router.refresh())}
        refreshing={refreshing}
        enableReplay={canReplay}
        onReplayActiveChange={(active) => {
          setReplayActive(active);
          if (active) {
            setSelected(null);
            closeDiscover();
          }
        }}
        photos={photoData?.photos}
        photoUnlocatedCount={photoData?.unlocatedCount}
        unlocatedPhotos={photoData?.unlocated}
        onPhotoModeActiveChange={(active) => {
          setPhotoActive(active);
          if (active) {
            setSelected(null);
            closeDiscover();
          }
        }}
        onFullscreenToggle={toggleFullscreen}
        fullscreen={fullscreen}
      />

      {/* Stats overlay. Wraps within the card on narrow screens so the pills
          never push past the globe's edge. Hidden during replay and photo
          mode, which bring their own readouts. */}
      {!isEmpty && !replayActive && !photoActive ? (
        <div
          className={cn(
            "absolute left-4 right-4 z-20 flex flex-wrap items-center gap-2 pr-14",
            fullscreen ? "top-[max(1rem,env(safe-area-inset-top))]" : "top-4",
          )}
        >
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
        <CountryDrilldown
          selection={selected}
          groups={selectedGroups}
          linkDestinations
          onClose={() => setSelected(null)}
          onExplore={() => {
            const target = selected;
            setSelected(null);
            openDiscover({ code: target.code, name: target.name, city: null });
          }}
        />
      ) : null}

      {/* Search: explore any city or country by name. z-30 keeps the expanded
          dropdown above the stats pills. Hidden during replay and photo mode. */}
      {replayActive || photoActive ? null : (
        <div
          className={cn(
            "absolute right-4 z-30 flex justify-end",
            fullscreen ? "top-[max(1rem,env(safe-area-inset-top))]" : "top-4",
          )}
        >
          <GlobeSearch
            onSelect={(selection: GlobeSearchSelection) => {
              setSelected(null);
              openDiscover({
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
    </div>
  );
}

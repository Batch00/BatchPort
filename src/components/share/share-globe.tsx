"use client";

import { useEffect, useMemo, useState } from "react";

import {
  Globe,
  type GlobeDestination,
  type GlobeCountrySelection,
} from "@/components/map/globe";
import {
  CountryDrilldown,
  groupByTrip,
  type TripGroup,
} from "@/components/map/country-drilldown";
import { useDiscovery } from "@/components/discover/discovery-host";
import {
  GlobeSearch,
  type GlobeSearchSelection,
} from "@/components/discover/globe-search";
import { useGlobeFullscreen } from "@/components/map/use-globe-fullscreen";
import { cn } from "@/lib/utils";
import type { MapData } from "@/lib/map-data";
import type { PhotoMapData } from "@/lib/photo-map-data";

// Globe for the public share and demo surfaces. Exploration works like the
// dashboard (discovery on unvisited countries, drill-down with Explore on
// visited ones, search), but strictly read-only: the page-level discovery host
// runs in readOnly mode and the drill-down never links into protected routes.
export function ShareGlobe({
  data,
  photoData,
}: {
  data: MapData;
  photoData?: PhotoMapData;
}) {
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
  const { target: discoverTarget, open: openDiscover, close: closeDiscover } =
    useDiscovery();
  const [focus, setFocus] = useState<{
    lat: number;
    lng: number;
    zoom?: number;
  } | null>(null);

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

  // Bucket place pins are part of the profile story; their popup Explore
  // opens the read-only discovery city view.
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

  const isEmpty = destinations.length === 0;
  const canReplay = destinations.some((d) => !d.planned);
  // The stats pill yields to the replay's own date and counter readout.
  const [replayActive, setReplayActive] = useState(false);
  // Photo map mode likewise brings its own header pill.
  const [photoActive, setPhotoActive] = useState(false);
  // Fullscreen mirrors the dashboard globe: fixed full-viewport CSS container,
  // panel-first Escape handling.
  const { fullscreen, toggle: toggleFullscreen } = useGlobeFullscreen(
    Boolean(selected || discoverTarget),
  );

  // Only one panel at a time: discovery opened from a bucket card below the
  // globe also dismisses the drill-down. Render-time state reset (the React
  // pattern for deriving state from props without an effect).
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
        // z-30 stays below the discovery overlay host (z-40).
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
            name: place.countryCode,
            city: { name: place.name, lat: place.lat, lng: place.lng },
          });
        }}
        focus={focus}
        autoRotate={false}
        fitToData={!isEmpty}
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

      {!isEmpty && !replayActive && !photoActive ? (
        <div
          className={cn(
            "pointer-events-none absolute left-4 z-20 rounded-full border border-white/10 bg-black/60 px-3.5 py-1.5 text-xs font-medium text-foreground/80 shadow-md backdrop-blur-md",
            fullscreen ? "top-[max(1rem,env(safe-area-inset-top))]" : "top-4",
          )}
        >
          {stats.countries} {stats.countries === 1 ? "country" : "countries"},{" "}
          {stats.trips} {stats.trips === 1 ? "trip" : "trips"},{" "}
          {stats.destinations}{" "}
          {stats.destinations === 1 ? "destination" : "destinations"}
        </div>
      ) : null}

      {/* Read-only drill-down: destination names without app links. */}
      {selected ? (
        <CountryDrilldown
          selection={selected}
          groups={selectedGroups}
          linkDestinations={false}
          onClose={() => setSelected(null)}
          onExplore={() => {
            const target = selected;
            setSelected(null);
            openDiscover({ code: target.code, name: target.name, city: null });
          }}
        />
      ) : null}

      {/* Search: explore any city or country by name. Hidden during replay
          and photo mode. */}
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

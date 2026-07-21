"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowLeftIcon,
  CheckIcon,
  ChurchIcon,
  LandmarkIcon,
  MapPinIcon,
  PlaneIcon,
  PlusIcon,
  SparklesIcon,
  TicketIcon,
  TreesIcon,
  WavesIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { createBucketItem } from "@/lib/actions/bucket-list";
import { startTripFromCityAction } from "@/lib/actions/trips";
import { addPoiExperienceAction } from "@/lib/actions/experiences";
import { CountryFlag } from "@/components/country-flag";
import { CountryFactsRow } from "@/components/discover/country-facts";
import { ClimateSection } from "@/components/discover/climate-line";
import { placeKey } from "@/lib/geo";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { SafeImage } from "@/components/photos/safe-image";
import type { TripDestinationOption } from "@/lib/trips";
import type {
  DiscoverCity,
  DiscoverCityDetail,
  DiscoverCountry,
  DiscoverPoi,
  DiscoverPoiDetail,
  PoiCategory,
} from "@/lib/discover";

// Discovery panel: country view (hero, Wikipedia summary, bucket list add,
// top city cards) and an in-panel city view (hero, summary, highlights, and
// trip planning actions) reached by clicking a city card or from search.
// Renders as a right-side panel on desktop (matching the country drill-down)
// and a bottom sheet on mobile. Shells paint immediately from the known name;
// each content section streams in as its fetch resolves.

/** A city the panel can show: from a city card, search, or a bucket item.
 * Coordinates are optional (bucket places saved without them); the city view
 * then degrades to summary and hero only. */
export interface DiscoveryCityTarget {
  name: string;
  lat?: number | null;
  lng?: number | null;
  population?: number | null;
}

/** A POI the panel can drill into from a city's highlight row or from a POI
 * detail's nearby list. Category is null for nearby items, which come from
 * Wikipedia geosearch and carry no OSM tag. */
interface DiscoveryPoiTarget {
  name: string;
  lat: number;
  lng: number;
  category: PoiCategory | null;
  /** The highlight row's thumbnail, shown as the hero until detail loads. */
  imageUrl?: string | null;
}

interface DiscoveryPanelProps {
  code: string;
  /** Country name from the globe click or search, shown before any fetch. */
  name: string;
  /** Whether the country is already an unfulfilled bucket list item. */
  isOnBucketList: boolean;
  /**
   * placeKey() identities of the user's unfulfilled place-type bucket items,
   * so a city already on the list shows the checked state instead of Add.
   */
  bucketPlaceKeys?: string[];
  /** When set, the panel opens directly on this city's view. */
  initialCity?: DiscoveryCityTarget | null;
  /**
   * Anon and demo surfaces: replaces the mutation actions (bucket add, start
   * trip) with a single request-access conversion link. The truthful "On your
   * bucket list" state still shows; no server action is reachable.
   */
  readOnly?: boolean;
  /**
   * The user's trips with destinations, for the POI detail's "Add to a trip"
   * picker. Empty or absent (read-only surfaces) hides the picker.
   */
  tripOptions?: TripDestinationOption[];
  onClose: () => void;
  /** Called after a successful bucket add so the parent can refresh map data. */
  onBucketAdded?: () => void;
}

const POI_ICONS: Record<PoiCategory, LucideIcon> = {
  museum: LandmarkIcon,
  attraction: TicketIcon,
  nature: TreesIcon,
  beach: WavesIcon,
  worship: ChurchIcon,
};

const POI_LABELS: Record<PoiCategory, string> = {
  museum: "Museum",
  attraction: "Attraction",
  nature: "Nature",
  beach: "Beach",
  worship: "Place of worship",
};

// The visit month (1-12) for a city reached from a planned or ongoing trip:
// the matching destination's arrival date, else the trip's start date. Null
// when no planning trip covers this city, so the climate line only shows when
// a month is actually known (climate without a month is noise).
function planningMonthForCity(
  cityName: string,
  tripOptions: TripDestinationOption[],
): number | null {
  const normalized = cityName.trim().toLowerCase();
  for (const trip of tripOptions) {
    if (trip.status !== "planned" && trip.status !== "ongoing") continue;
    const match = trip.destinations.find(
      (destination) => destination.name.trim().toLowerCase() === normalized,
    );
    if (!match) continue;
    const date = match.arrival_date ?? trip.start_date;
    if (!date) return null;
    const month = Number(date.slice(5, 7));
    return month >= 1 && month <= 12 ? month : null;
  }
  return null;
}

function formatPopulation(population: number | null): string | null {
  if (!population || population <= 0) return null;
  if (population >= 1_000_000) {
    return `${(population / 1_000_000).toFixed(1)}M people`;
  }
  if (population >= 1_000) {
    return `${Math.round(population / 1_000)}K people`;
  }
  return `${population} people`;
}

// The one conversion treatment for read-only surfaces: styled like the primary
// action it replaces, but linking out to the request-access site instead of
// performing any write. Used identically for the country and city actions.
function ConversionCta() {
  return (
    <a
      href="https://www.batch-apps.com"
      className={cn(
        buttonVariants(),
        "w-full bg-brand text-brand-foreground hover:bg-brand/90",
      )}
    >
      <SparklesIcon />
      Request access to save places
    </a>
  );
}

// Wikipedia extract with a ~4 line clamp and a Read more toggle.
function SummaryBlock({
  summary,
  loading,
}: {
  summary: string | null;
  loading: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        <div className="h-3 animate-pulse rounded bg-white/10" />
        <div className="h-3 animate-pulse rounded bg-white/10" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-white/10" />
      </div>
    );
  }
  if (!summary) {
    return (
      <p className="text-sm text-foreground/40">No summary available.</p>
    );
  }
  return (
    <div>
      <p
        className={cn(
          "text-sm leading-relaxed text-foreground/60",
          !expanded && "line-clamp-4",
        )}
      >
        {summary}
      </p>
      {summary.length > 220 ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 text-xs font-medium text-brand transition-colors hover:text-brand/80"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      ) : null}
    </div>
  );
}

function CityCard({
  city,
  onClick,
}: {
  city: DiscoverCity;
  onClick?: (city: DiscoverCity) => void;
}) {
  const population = formatPopulation(city.population);
  return (
    <button
      type="button"
      className={cn(
        "relative block aspect-[4/3] w-full overflow-hidden rounded-lg border border-white/10 bg-white/5 text-left transition-colors",
        onClick
          ? "cursor-pointer hover:border-brand/40"
          : "cursor-default",
      )}
      onClick={onClick ? () => onClick(city) : undefined}
    >
      {city.imageUrl ? (
        <SafeImage
          src={city.imageUrl}
          alt={city.name}
          loading="lazy"
          className="size-full object-cover"
        />
      ) : (
        <div className="size-full bg-gradient-to-br from-brand/15 via-white/5 to-transparent" />
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-2.5 pb-2 pt-6">
        <p className="truncate text-xs font-medium text-foreground/95">
          {city.name}
        </p>
        {population ? (
          <p className="truncate text-[10px] text-foreground/50">{population}</p>
        ) : null}
      </div>
    </button>
  );
}

function CityCardSkeleton() {
  return (
    <div className="aspect-[4/3] animate-pulse rounded-lg border border-white/10 bg-white/5" />
  );
}

function PoiRow({
  poi,
  onClick,
}: {
  poi: DiscoverPoi;
  onClick: (poi: DiscoverPoi) => void;
}) {
  const Icon = POI_ICONS[poi.category];
  return (
    <li>
      <button
        type="button"
        onClick={() => onClick(poi)}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5"
      >
        <div className="relative size-12 shrink-0 overflow-hidden rounded-md border border-white/10 bg-white/5">
          {poi.imageUrl ? (
            <SafeImage
              src={poi.imageUrl}
              alt={poi.name}
              loading="lazy"
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-foreground/30">
              <Icon className="size-5" />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm text-foreground/90">{poi.name}</p>
          <p className="flex items-center gap-1 text-xs text-foreground/45">
            <Icon className="size-3" />
            {POI_LABELS[poi.category]}
          </p>
        </div>
      </button>
    </li>
  );
}

// --- Country view body -------------------------------------------------------

function CountryBody({
  code,
  name,
  isOnBucketList,
  readOnly,
  country,
  countryLoading,
  cities,
  onOpenCity,
  onBucketAdded,
}: {
  code: string;
  name: string;
  isOnBucketList: boolean;
  readOnly: boolean;
  country: DiscoverCountry | null;
  countryLoading: boolean;
  cities: DiscoverCity[] | null;
  onOpenCity: (city: DiscoveryCityTarget) => void;
  onBucketAdded?: () => void;
}) {
  const [added, setAdded] = useState(false);
  const [adding, startAdding] = useTransition();
  const onList = added || isOnBucketList;
  // Representative point for the country's climate: the largest city with
  // coordinates. Climate varies across large countries, but the top city is a
  // sensible "what is it like there" proxy, and it lets discovery show climate
  // at the country level without a planned trip.
  const climatePoint = cities?.find(
    (city) => Number.isFinite(city.lat) && Number.isFinite(city.lng),
  );

  function handleAdd() {
    startAdding(async () => {
      const result = await createBucketItem({
        type: "country",
        country_code: code,
        place_name: null,
        lat: null,
        lng: null,
        priority: null,
        target_date: null,
        notes: null,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${name} added to your bucket list.`);
      setAdded(true);
      onBucketAdded?.();
    });
  }

  return (
    <>
      <SummaryBlock summary={country?.summary ?? null} loading={countryLoading} />

      {country?.facts ? (
        <CountryFactsRow facts={country.facts} className="mt-4" />
      ) : null}

      {climatePoint ? (
        <ClimateSection
          lat={climatePoint.lat}
          lng={climatePoint.lng}
          className="mt-4"
        />
      ) : null}

      <div className="mt-4 flex flex-col gap-2">
        {onList ? (
          <Button variant="secondary" className="w-full" disabled>
            <CheckIcon className="text-brand" />
            On your bucket list
          </Button>
        ) : readOnly ? (
          <ConversionCta />
        ) : (
          <Button
            onClick={handleAdd}
            disabled={adding}
            className="w-full bg-brand text-brand-foreground hover:bg-brand/90"
          >
            <PlusIcon />
            {adding ? "Adding..." : "Add to bucket list"}
          </Button>
        )}
      </div>

      <div className="mt-6">
        <h3 className="text-xs font-medium uppercase tracking-wide text-foreground/45">
          Top cities
        </h3>
        {cities === null ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {Array.from({ length: 4 }, (_, index) => (
              <CityCardSkeleton key={index} />
            ))}
          </div>
        ) : cities.length > 0 ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {cities.map((city) => (
              <CityCard key={city.name} city={city} onClick={onOpenCity} />
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-foreground/40">
            No city data available yet.
          </p>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-0.5 border-t border-white/10 pt-3 text-[10px] leading-relaxed text-foreground/35">
        {country?.attribution ? <p>Photo: {country.attribution}</p> : null}
        {country?.summary ? <p>Summary via Wikipedia (CC BY-SA 4.0)</p> : null}
        {cities && cities.some((city) => city.imageUrl) ? (
          <p>City photos via Wikimedia Commons</p>
        ) : null}
      </div>
    </>
  );
}

// --- City view body ----------------------------------------------------------

function CityBody({
  city,
  countryCode,
  isOnBucketList,
  planningTripName,
  climateMonth,
  readOnly,
  onHeroLoaded,
  onOpenPoi,
  onBucketAdded,
}: {
  city: DiscoveryCityTarget;
  countryCode: string;
  /** Whether this city already matches a place-type bucket item. */
  isOnBucketList: boolean;
  /** A planned or ongoing trip with a destination named like this city. */
  planningTripName: string | null;
  /** Calendar month 1-12 to open the climate selector on, when one is known
   * (arrived here from a planned-trip context). Null defaults to this month. */
  climateMonth: number | null;
  readOnly: boolean;
  /** Reports the city hero URL up so the shared shell hero can show it. */
  onHeroLoaded: (cityName: string, url: string | null) => void;
  /** Clicking a highlight row drills into that POI's detail view. */
  onOpenPoi: (poi: DiscoveryPoiTarget) => void;
  onBucketAdded?: () => void;
}) {
  const [detail, setDetail] = useState<DiscoverCityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [added, setAdded] = useState(false);
  const [adding, startAdding] = useTransition();
  const [starting, startStarting] = useTransition();
  const onList = added || isOnBucketList;
  const hasCoords =
    typeof city.lat === "number" && typeof city.lng === "number";

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ name: city.name });
    if (typeof city.lat === "number" && typeof city.lng === "number") {
      query.set("lat", String(city.lat));
      query.set("lng", String(city.lng));
    }
    if (countryCode) query.set("code", countryCode);
    fetch(`/api/discover/city?${query.toString()}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: DiscoverCityDetail | null) => {
        setDetail(data);
        setLoading(false);
        if (data?.heroImageUrl) onHeroLoaded(city.name, data.heroImageUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // onHeroLoaded is a stable setState wrapper from the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city.name, city.lat, city.lng, countryCode]);

  function handleAddPlace() {
    startAdding(async () => {
      const result = await createBucketItem({
        type: "place",
        country_code: countryCode || null,
        place_name: city.name,
        lat: city.lat ?? null,
        lng: city.lng ?? null,
        priority: null,
        target_date: null,
        notes: null,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${city.name} added to your bucket list.`);
      setAdded(true);
      onBucketAdded?.();
    });
  }

  function handleStartTrip() {
    if (!hasCoords) return;
    startStarting(async () => {
      const result = await startTripFromCityAction({
        name: city.name,
        lat: city.lat as number,
        lng: city.lng as number,
        country_code: countryCode || null,
      });
      // A successful action redirects to the new trip and never returns.
      if (result && "error" in result) {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      {planningTripName ? (
        <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-xs text-brand">
          <PlaneIcon className="size-3" />
          Planning a trip here · {planningTripName}
        </p>
      ) : null}
      <SummaryBlock summary={detail?.summary ?? null} loading={loading} />

      {hasCoords ? (
        <ClimateSection
          lat={city.lat as number}
          lng={city.lng as number}
          defaultMonth={climateMonth}
          className="mt-3"
        />
      ) : null}

      {readOnly ? (
        // Both mutation actions collapse into the one conversion treatment;
        // the truthful bucket state keeps showing for the profile's own items.
        <div className="mt-4 flex flex-col gap-2">
          {onList ? (
            <Button variant="secondary" className="w-full" disabled>
              <CheckIcon className="text-brand" />
              On your list
            </Button>
          ) : null}
          <ConversionCta />
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {onList ? (
            <Button variant="secondary" disabled>
              <CheckIcon className="text-brand" />
              On your list
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={handleAddPlace}
              disabled={adding}
            >
              <PlusIcon />
              {adding ? "Adding..." : "Bucket list"}
            </Button>
          )}
          <Button
            onClick={handleStartTrip}
            disabled={starting || !hasCoords}
            title={
              hasCoords ? undefined : "This place was saved without coordinates"
            }
            className="bg-brand text-brand-foreground hover:bg-brand/90"
          >
            <PlaneIcon />
            {starting ? "Creating..." : "Start a trip"}
          </Button>
        </div>
      )}

      <div className="mt-6">
        <h3 className="text-xs font-medium uppercase tracking-wide text-foreground/45">
          Highlights
        </h3>
        {loading ? (
          <div className="mt-2 flex flex-col gap-2">
            {Array.from({ length: 4 }, (_, index) => (
              <div
                key={index}
                className="h-12 animate-pulse rounded-lg bg-white/5"
              />
            ))}
          </div>
        ) : detail && detail.pois.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1">
            {detail.pois.map((poi) => (
              <PoiRow
                key={`${poi.name}:${poi.lat}`}
                poi={poi}
                onClick={(clicked) =>
                  onOpenPoi({
                    name: clicked.name,
                    lat: clicked.lat,
                    lng: clicked.lng,
                    category: clicked.category,
                    imageUrl: clicked.imageUrl,
                  })
                }
              />
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-foreground/40">
            No highlights found for this city.
          </p>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-0.5 border-t border-white/10 pt-3 text-[10px] leading-relaxed text-foreground/35">
        {detail?.attribution ? <p>Photo: {detail.attribution}</p> : null}
        {detail?.summary ? <p>Summary via Wikipedia (CC BY-SA 4.0)</p> : null}
        {detail && detail.pois.some((poi) => poi.imageUrl) ? (
          <p>Highlight photos via Wikimedia Commons</p>
        ) : null}
      </div>
    </>
  );
}

// --- POI detail view body ----------------------------------------------------

// Two-step inline picker: choose a trip, then one of its destinations, and the
// POI is logged as an experience there. Destinations in the POI's country sort
// first; the rest stay available since city-to-destination matching from a
// name alone is fuzzy.
function AddToTripPicker({
  poi,
  countryCode,
  trips,
}: {
  poi: DiscoveryPoiTarget;
  countryCode: string;
  trips: TripDestinationOption[];
}) {
  const [open, setOpen] = useState(false);
  const [trip, setTrip] = useState<TripDestinationOption | null>(null);
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  function handlePick(
    destinationId: string,
    destinationName: string,
    tripStatus: string,
  ) {
    // On a planned or ongoing trip the POI is saved as an idea (a planned
    // experience); on a completed trip it is logged as done, as before.
    const planned = tripStatus === "planned" || tripStatus === "ongoing";
    startSaving(async () => {
      const result = await addPoiExperienceAction({
        destinationId,
        name: poi.name,
        categorySlug: poi.category,
        lat: poi.lat,
        lng: poi.lng,
        status: planned ? "planned" : "done",
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        planned
          ? `Added to ${destinationName} plans.`
          : `${poi.name} added to ${destinationName}.`,
      );
      setSavedTo(destinationName);
      setOpen(false);
      setTrip(null);
    });
  }

  if (savedTo) {
    return (
      <Button variant="secondary" className="w-full" disabled>
        <CheckIcon className="text-brand" />
        Added to {savedTo}
      </Button>
    );
  }

  if (trips.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-white/10 px-3 py-2.5 text-center text-xs text-foreground/45">
        Create a trip with a destination to save this place.
      </p>
    );
  }

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        className="w-full bg-brand text-brand-foreground hover:bg-brand/90"
      >
        <PlusIcon />
        Add to a trip
      </Button>
    );
  }

  // Destinations in the POI's country first, keeping trip order within groups.
  const orderedDestinations = trip
    ? [
        ...trip.destinations.filter((d) => d.country_code === countryCode),
        ...trip.destinations.filter((d) => d.country_code !== countryCode),
      ]
    : [];

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-2">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <p className="text-xs font-medium text-foreground/60">
          {trip ? `Destination in ${trip.name}` : "Choose a trip"}
        </p>
        <button
          type="button"
          onClick={() => (trip ? setTrip(null) : setOpen(false))}
          className="text-xs text-foreground/45 transition-colors hover:text-foreground"
        >
          {trip ? "Back" : "Cancel"}
        </button>
      </div>
      <ul className="flex max-h-44 flex-col gap-0.5 overflow-y-auto">
        {trip
          ? orderedDestinations.map((destination) => (
              <li key={destination.id}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    handlePick(destination.id, destination.name, trip.status)
                  }
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground/85 transition-colors hover:bg-white/10 disabled:opacity-50"
                >
                  <span className="truncate">{destination.name}</span>
                  {destination.country_code ? (
                    <CountryFlag
                      code={destination.country_code}
                      className="h-3 shrink-0"
                    />
                  ) : null}
                </button>
              </li>
            ))
          : trips.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  onClick={() => setTrip(option)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground/85 transition-colors hover:bg-white/10"
                >
                  <span className="truncate">{option.name}</span>
                  <span className="shrink-0 text-xs text-foreground/40">
                    {option.destinations.length}{" "}
                    {option.destinations.length === 1 ? "stop" : "stops"}
                  </span>
                </button>
              </li>
            ))}
      </ul>
    </div>
  );
}

function PoiBody({
  poi,
  countryCode,
  readOnly,
  tripOptions,
  onHeroLoaded,
  onOpenNearby,
}: {
  poi: DiscoveryPoiTarget;
  countryCode: string;
  readOnly: boolean;
  tripOptions: TripDestinationOption[];
  /** Reports the POI hero URL up so the shared shell hero can show it. */
  onHeroLoaded: (poiName: string, url: string | null) => void;
  /** A nearby item opens as its own POI detail (replacing this one). */
  onOpenNearby: (target: DiscoveryPoiTarget) => void;
}) {
  const [detail, setDetail] = useState<DiscoverPoiDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({
      name: poi.name,
      lat: String(poi.lat),
      lng: String(poi.lng),
    });
    fetch(`/api/discover/poi?${query.toString()}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: DiscoverPoiDetail | null) => {
        setDetail(data);
        setLoading(false);
        if (data?.heroImageUrl) onHeroLoaded(poi.name, data.heroImageUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // onHeroLoaded is a stable setState wrapper from the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poi.name, poi.lat, poi.lng]);

  const CategoryIcon = poi.category ? POI_ICONS[poi.category] : MapPinIcon;
  const categoryLabel = poi.category ? POI_LABELS[poi.category] : null;
  const noInfo = !loading && !detail?.summary;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {categoryLabel ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-foreground/70">
            <CategoryIcon className="size-3" />
            {categoryLabel}
          </span>
        ) : null}
        {detail?.description ? (
          <span className="text-xs text-foreground/50">
            {detail.description}
          </span>
        ) : null}
      </div>

      {noInfo ? (
        <p className="text-sm text-foreground/40">
          No further info available for this place.{" "}
          <span className="whitespace-nowrap">
            {poi.lat.toFixed(4)}, {poi.lng.toFixed(4)}
          </span>
        </p>
      ) : (
        <SummaryBlock summary={detail?.summary ?? null} loading={loading} />
      )}

      <div className="mt-4 flex flex-col gap-2">
        {readOnly ? (
          <ConversionCta />
        ) : (
          <AddToTripPicker
            poi={poi}
            countryCode={countryCode}
            trips={tripOptions}
          />
        )}
      </div>

      {detail && detail.nearby.length > 0 ? (
        <div className="mt-6">
          <h3 className="text-xs font-medium uppercase tracking-wide text-foreground/45">
            Nearby
          </h3>
          <ul className="mt-2 flex flex-col gap-0.5">
            {detail.nearby.map((item) => (
              <li key={`${item.name}:${item.lat}`}>
                <button
                  type="button"
                  onClick={() =>
                    onOpenNearby({
                      name: item.name,
                      lat: item.lat,
                      lng: item.lng,
                      category: null,
                    })
                  }
                  className="flex w-full flex-col rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5"
                >
                  <span className="truncate text-sm text-foreground/90">
                    {item.name}
                  </span>
                  {item.description ? (
                    <span className="truncate text-xs text-foreground/45">
                      {item.description}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-6 flex flex-col gap-0.5 border-t border-white/10 pt-3 text-[10px] leading-relaxed text-foreground/35">
        {detail?.attribution ? <p>Photo: {detail.attribution}</p> : null}
        {detail?.summary ? <p>Summary via Wikipedia (CC BY-SA 4.0)</p> : null}
      </div>
    </>
  );
}

// --- Panel shell ---------------------------------------------------------------

export function DiscoveryPanel({
  code,
  name,
  isOnBucketList,
  bucketPlaceKeys = [],
  initialCity = null,
  readOnly = false,
  tripOptions = [],
  onClose,
  onBucketAdded,
}: DiscoveryPanelProps) {
  // Navigation depth: country (both null), city (cityView set), or POI detail
  // (both set; a POI is always reached through a city).
  const [cityView, setCityView] = useState<DiscoveryCityTarget | null>(
    initialCity,
  );
  const [poiView, setPoiView] = useState<DiscoveryPoiTarget | null>(null);
  const [country, setCountry] = useState<DiscoverCountry | null>(null);
  // Items saved without a country code have nothing country-level to fetch;
  // the panel then only ever shows the city view, non-loading.
  const [countryLoading, setCountryLoading] = useState(() => Boolean(code));
  const [cities, setCities] = useState<DiscoverCity[] | null>(() =>
    code ? null : [],
  );
  const [cityHeroes, setCityHeroes] = useState<Record<string, string>>({});
  const [poiHeroes, setPoiHeroes] = useState<Record<string, string>>({});

  // The country payload always loads (it is the back target and supplies the
  // region line); the cities grid loads alongside it.
  useEffect(() => {
    if (!code) return;
    const controller = new AbortController();

    fetch(`/api/discover/country?code=${code}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: DiscoverCountry | null) => {
        setCountry(data);
        setCountryLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCountryLoading(false);
      });

    fetch(`/api/discover/cities?code=${code}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : []))
      .then((data: DiscoverCity[]) => setCities(Array.isArray(data) ? data : []))
      .catch(() => {
        if (!controller.signal.aborted) setCities([]);
      });

    return () => controller.abort();
  }, [code]);

  // Escape walks up one level: POI to city, city to country, then dismisses
  // the panel. Refs keep the listener stable across navigation.
  const poiViewRef = useRef(poiView);
  const cityViewRef = useRef(cityView);
  useEffect(() => {
    poiViewRef.current = poiView;
    cityViewRef.current = cityView;
  });
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (poiViewRef.current) {
        setPoiView(null);
      } else if (cityViewRef.current) {
        setCityView(null);
      } else {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const regionLine = [country?.continent, country?.region]
    .filter(Boolean)
    .join(" · ");

  // City heroes come back with the city detail; remember them so returning to
  // a city (or the card grid image) stays instant.
  const cityCardImage = cityView
    ? cities?.find((c) => c.name === cityView.name)?.imageUrl ?? null
    : null;
  const cityHero = cityView
    ? cityHeroes[cityView.name] ?? cityCardImage
    : null;
  // POI hero: the detail's resolved image, falling back to the highlight
  // row's thumbnail until it loads.
  const poiHero = poiView
    ? poiHeroes[poiView.name] ?? poiView.imageUrl ?? null
    : null;

  const heroImage = poiView
    ? poiHero
    : cityView
      ? cityHero
      : country?.heroImageUrl ?? null;
  const heroAlt = poiView ? poiView.name : cityView ? cityView.name : name;

  return (
    <>
      {/* Mobile backdrop: tap outside the sheet to dismiss. */}
      <div
        className="fixed inset-0 z-40 bg-black/50 sm:hidden"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-label={`Discover ${
          poiView?.name ?? cityView?.name ?? name
        }`}
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col overflow-hidden rounded-t-2xl border-t border-white/10 bg-black/90 shadow-2xl backdrop-blur-md sm:absolute sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:z-30 sm:max-h-none sm:w-96 sm:max-w-[85%] sm:rounded-none sm:border-l sm:border-t-0 sm:bg-black/85"
      >
        {/* Hero */}
        <div className="relative h-36 shrink-0 overflow-hidden sm:h-44">
          {heroImage ? (
            <SafeImage
              key={heroImage}
              src={heroImage}
              alt={heroAlt}
              className="size-full object-cover"
            />
          ) : (
            <div
              className={cn(
                "size-full bg-gradient-to-br from-brand/25 via-[#101623] to-[#0a0a0a]",
                countryLoading && !cityView && "animate-pulse",
              )}
            />
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent px-5 pb-3 pt-10">
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <CountryFlag code={code} className="h-4" />
              <span className="truncate">
                {poiView
                  ? poiView.name
                  : cityView
                    ? cityView.name
                    : country?.name ?? name}
              </span>
            </h2>
            {poiView && cityView ? (
              <p className="mt-0.5 text-xs text-foreground/60">
                {cityView.name}
              </p>
            ) : cityView ? (
              <p className="mt-0.5 text-xs text-foreground/60">
                {country?.name ?? name}
              </p>
            ) : regionLine ? (
              <p className="mt-0.5 text-xs text-foreground/60">{regionLine}</p>
            ) : null}
          </div>
          {poiView && cityView ? (
            <button
              type="button"
              onClick={() => setPoiView(null)}
              aria-label={`Back to ${cityView.name}`}
              className="absolute left-3 top-3 rounded-md bg-black/40 p-2 text-foreground/70 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-foreground"
            >
              <ArrowLeftIcon className="size-4" />
            </button>
          ) : cityView ? (
            <button
              type="button"
              onClick={() => setCityView(null)}
              aria-label={`Back to ${country?.name ?? name}`}
              className="absolute left-3 top-3 rounded-md bg-black/40 p-2 text-foreground/70 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-foreground"
            >
              <ArrowLeftIcon className="size-4" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 rounded-md bg-black/40 p-2 text-foreground/70 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        {/* Scrollable body, with safe-area padding for the mobile sheet. */}
        <div className="flex-1 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 sm:pb-5">
          {poiView ? (
            <PoiBody
              key={`${poiView.name}:${poiView.lat}`}
              poi={poiView}
              countryCode={code}
              readOnly={readOnly}
              tripOptions={tripOptions}
              onHeroLoaded={(poiName, url) =>
                setPoiHeroes((current) =>
                  url ? { ...current, [poiName]: url } : current,
                )
              }
              onOpenNearby={(target) => setPoiView(target)}
            />
          ) : cityView ? (
            <CityBody
              key={cityView.name}
              city={cityView}
              countryCode={code}
              isOnBucketList={bucketPlaceKeys.includes(
                placeKey(cityView.name, code),
              )}
              planningTripName={
                tripOptions.find(
                  (trip) =>
                    (trip.status === "planned" || trip.status === "ongoing") &&
                    trip.destinations.some(
                      (destination) =>
                        destination.name.trim().toLowerCase() ===
                        cityView.name.trim().toLowerCase(),
                    ),
                )?.name ?? null
              }
              climateMonth={planningMonthForCity(cityView.name, tripOptions)}
              readOnly={readOnly}
              onHeroLoaded={(cityName, url) =>
                setCityHeroes((current) =>
                  url ? { ...current, [cityName]: url } : current,
                )
              }
              onOpenPoi={(poi) => setPoiView(poi)}
              onBucketAdded={onBucketAdded}
            />
          ) : (
            <CountryBody
              code={code}
              name={name}
              isOnBucketList={isOnBucketList}
              readOnly={readOnly}
              country={country}
              countryLoading={countryLoading}
              cities={cities}
              onOpenCity={(city) => setCityView(city)}
              onBucketAdded={onBucketAdded}
            />
          )}
        </div>
      </div>
    </>
  );
}

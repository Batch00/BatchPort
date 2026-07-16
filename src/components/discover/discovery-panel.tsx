"use client";

import { useEffect, useState, useTransition } from "react";
import { CheckIcon, PlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { createBucketItem } from "@/lib/actions/bucket-list";
import { flagEmoji } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SafeImage } from "@/components/photos/safe-image";
import type { DiscoverCity, DiscoverCountry } from "@/lib/discover";

// Discovery panel for unvisited countries: hero photo, Wikipedia summary,
// bucket list add, and top city photo cards. Renders as a right-side panel on
// desktop (matching the country drill-down) and a bottom sheet on mobile. The
// shell and country name paint immediately from the globe click; the photo,
// summary, and cities stream in as their fetches resolve.

interface DiscoveryPanelProps {
  code: string;
  /** Country name from the globe click, shown before any fetch resolves. */
  name: string;
  /** Whether the country is already an unfulfilled bucket list item. */
  isOnBucketList: boolean;
  onClose: () => void;
  /** Called after a successful bucket add so the parent can refresh map data. */
  onBucketAdded?: () => void;
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

// Display-only for phase 1; the onClick prop keeps a city detail view (phase 2)
// a one-line change.
function CityCard({
  city,
  onClick,
}: {
  city: DiscoverCity;
  onClick?: (city: DiscoverCity) => void;
}) {
  const population = formatPopulation(city.population);
  return (
    <div
      className={cn(
        "relative aspect-[4/3] overflow-hidden rounded-lg border border-white/10 bg-white/5",
        onClick && "cursor-pointer",
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
    </div>
  );
}

function CityCardSkeleton() {
  return (
    <div className="aspect-[4/3] animate-pulse rounded-lg border border-white/10 bg-white/5" />
  );
}

export function DiscoveryPanel({
  code,
  name,
  isOnBucketList,
  onClose,
  onBucketAdded,
}: DiscoveryPanelProps) {
  const [country, setCountry] = useState<DiscoverCountry | null>(null);
  const [countryLoading, setCountryLoading] = useState(true);
  const [cities, setCities] = useState<DiscoverCity[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [added, setAdded] = useState(false);
  const [adding, startAdding] = useTransition();

  // Fetch the country aggregate and the city list in parallel; each fills its
  // section independently as it resolves. The parent keys this component by
  // country code, so a new country remounts with fresh initial state.
  useEffect(() => {
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

  // Escape dismisses the panel.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const onList = added || isOnBucketList;

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

  const regionLine = [country?.continent, country?.region]
    .filter(Boolean)
    .join(" · ");

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
        aria-label={`Discover ${name}`}
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col overflow-hidden rounded-t-2xl border-t border-white/10 bg-black/90 shadow-2xl backdrop-blur-md sm:absolute sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:z-30 sm:max-h-none sm:w-96 sm:max-w-[85%] sm:rounded-none sm:border-l sm:border-t-0 sm:bg-black/85"
      >
        {/* Hero */}
        <div className="relative h-36 shrink-0 overflow-hidden sm:h-44">
          {country?.heroImageUrl ? (
            <SafeImage
              src={country.heroImageUrl}
              alt={name}
              className="size-full object-cover"
            />
          ) : (
            <div
              className={cn(
                "size-full bg-gradient-to-br from-brand/25 via-[#101623] to-[#0a0a0a]",
                countryLoading && "animate-pulse",
              )}
            />
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent px-5 pb-3 pt-10">
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <span>{flagEmoji(code)}</span>
              <span className="truncate">{country?.name ?? name}</span>
            </h2>
            {regionLine ? (
              <p className="mt-0.5 text-xs text-foreground/60">{regionLine}</p>
            ) : null}
          </div>
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
          {/* Summary */}
          {countryLoading ? (
            <div className="flex flex-col gap-2">
              <div className="h-3 animate-pulse rounded bg-white/10" />
              <div className="h-3 animate-pulse rounded bg-white/10" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-white/10" />
            </div>
          ) : country?.summary ? (
            <div>
              <p
                className={cn(
                  "text-sm leading-relaxed text-foreground/60",
                  !expanded && "line-clamp-4",
                )}
              >
                {country.summary}
              </p>
              {country.summary.length > 220 ? (
                <button
                  type="button"
                  onClick={() => setExpanded((value) => !value)}
                  className="mt-1 text-xs font-medium text-brand transition-colors hover:text-brand/80"
                >
                  {expanded ? "Show less" : "Read more"}
                </button>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-foreground/40">
              No summary available for this country.
            </p>
          )}

          {/* Bucket list */}
          <div className="mt-4">
            {onList ? (
              <Button variant="secondary" className="w-full" disabled>
                <CheckIcon className="text-brand" />
                On your bucket list
              </Button>
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

          {/* Top cities */}
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
                  <CityCard key={city.name} city={city} />
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-foreground/40">
                No city data available yet.
              </p>
            )}
          </div>

          {/* Attribution */}
          <div className="mt-6 flex flex-col gap-0.5 border-t border-white/10 pt-3 text-[10px] leading-relaxed text-foreground/35">
            {country?.attribution ? <p>Photo: {country.attribution}</p> : null}
            {country?.summary ? (
              <p>Summary via Wikipedia (CC BY-SA 4.0)</p>
            ) : null}
            {cities && cities.some((city) => city.imageUrl) ? (
              <p>City photos via Wikimedia Commons</p>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

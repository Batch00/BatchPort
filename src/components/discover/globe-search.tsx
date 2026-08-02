"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2Icon, MapPinIcon, SearchIcon, XIcon } from "lucide-react";

import { CountryFlag } from "@/components/country-flag";
import { cn } from "@/lib/utils";
import { useOnlineStatus } from "@/lib/offline/use-offline";
import type { GeoLocation } from "@/lib/types";
import type { DiscoveryCityTarget } from "./discovery-panel";

// Compact search overlay for the dashboard globe: a round icon button that
// expands into a typeahead. Country results open the discovery panel's country
// view; anything else opens the city view at the result's coordinates. Escape
// and outside clicks collapse it.

export interface GlobeSearchSelection {
  code: string;
  countryName: string;
  city: DiscoveryCityTarget | null;
  /** The result's coordinates (country centroid or city), for a camera fly-to. */
  lat: number;
  lng: number;
}

interface GlobeSearchProps {
  onSelect: (selection: GlobeSearchSelection) => void;
  className?: string;
}

const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;

const BUTTON_CLASS =
  "flex size-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-foreground/80 shadow-lg backdrop-blur-md transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60";

export function GlobeSearch({ onSelect, className }: GlobeSearchProps) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const online = useOnlineStatus();

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function collapse() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setExpanded(false);
    setQuery("");
    setResults([]);
    setSearched(false);
    setLoading(false);
  }

  // Outside clicks and Escape collapse the search.
  useEffect(() => {
    if (!expanded) return;
    function onDocMouseDown(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        collapse();
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") collapse();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function runSearch(value: string) {
    const trimmed = value.trim();
    if (trimmed.length < MIN_CHARS) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    fetch(`/api/geocode/search?q=${encodeURIComponent(trimmed)}`)
      .then(async (response) => {
        if (!response.ok) return [] as GeoLocation[];
        const data = (await response.json()) as unknown;
        return Array.isArray(data) ? (data as GeoLocation[]) : [];
      })
      .then((data) => {
        setResults(data);
        setSearched(true);
      })
      .catch(() => {
        setResults([]);
        setSearched(true);
      })
      .finally(() => setLoading(false));
  }

  function handleInput(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(value), DEBOUNCE_MS);
  }

  function handleSelect(result: GeoLocation) {
    // Discovery needs a country code; results without one cannot be opened.
    if (!result.country_code) return;
    const isCountry = result.kind === "country";
    onSelect({
      code: result.country_code,
      countryName: result.country ?? result.name,
      city: isCountry
        ? null
        : { name: result.name, lat: result.lat, lng: result.lng },
      lat: result.lat,
      lng: result.lng,
    });
    collapse();
  }

  if (!expanded) {
    return (
      <div className={className}>
        <button
          type="button"
          onClick={() => {
            setExpanded(true);
            // Focus after the input mounts.
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          aria-label="Search for a place to explore"
          title="Explore a place"
          className={BUTTON_CLASS}
        >
          <SearchIcon className="size-5" />
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn("w-64 max-w-[70vw]", className)}>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground/50" />
        <input
          ref={inputRef}
          value={query}
          autoComplete="off"
          placeholder="Explore a city or country"
          className="h-11 w-full rounded-full border border-white/10 bg-black/70 pl-9 pr-9 text-sm text-foreground shadow-lg backdrop-blur-md placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
          onChange={(event) => handleInput(event.target.value)}
        />
        <button
          type="button"
          onClick={collapse}
          aria-label="Close search"
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1.5 text-foreground/50 transition-colors hover:text-foreground"
        >
          {loading ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <XIcon className="size-4" />
          )}
        </button>
      </div>

      {searched || loading ? (
        <div className="mt-1 overflow-hidden rounded-xl border border-white/10 bg-black/85 shadow-xl backdrop-blur-md">
          {results.length === 0 ? (
            <div className="px-3 py-2.5 text-sm text-foreground/45">
              {loading
                ? "Searching..."
                : online
                  ? "No results"
                  : "Finding new places needs a connection."}
            </div>
          ) : (
            <ul className="max-h-64 overflow-y-auto py-1">
              {results.map((result, index) => (
                <li key={`${result.lat},${result.lng},${index}`}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-white/5 focus-visible:bg-white/5"
                    onClick={() => handleSelect(result)}
                  >
                    <span className="flex items-center leading-none">
                      {result.country_code ? (
                        <CountryFlag code={result.country_code} />
                      ) : (
                        <MapPinIcon className="size-4 text-foreground/40" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground/90">
                        {result.name}
                      </span>
                      <span className="block truncate text-xs text-foreground/45">
                        {result.kind === "country"
                          ? "Country"
                          : [result.admin_region, result.country]
                              .filter(Boolean)
                              .join(", ")}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

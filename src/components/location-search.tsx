"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2Icon, MapPinIcon, SearchIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { CountryFlag } from "@/components/country-flag";
import { cn } from "@/lib/utils";
import { useOnlineStatus } from "@/lib/offline/use-offline";
import type { GeoLocation } from "@/lib/types";

interface LocationSearchProps {
  onChange: (location: GeoLocation) => void;
  defaultQuery?: string;
  placeholder?: string;
  id?: string;
  className?: string;
}

const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;

export function LocationSearch({
  onChange,
  defaultQuery = "",
  placeholder = "Search for a city",
  id,
  className,
}: LocationSearchProps) {
  const [query, setQuery] = useState(defaultQuery);
  const [results, setResults] = useState<GeoLocation[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [searched, setSearched] = useState(false);
  const online = useOnlineStatus();

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close the dropdown when clicking outside the component.
  useEffect(() => {
    function onDocMouseDown(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function runSearch(value: string) {
    const trimmed = value.trim();
    if (trimmed.length < MIN_CHARS) {
      setResults([]);
      setOpen(false);
      setSearched(false);
      return;
    }
    setLoading(true);
    setOpen(true);
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

  async function handleSelect(result: GeoLocation) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setOpen(false);
    setQuery(result.name);
    setConfirming(true);
    try {
      const response = await fetch(
        `/api/geocode/lookup?lat=${result.lat}&lng=${result.lng}`,
      );
      if (response.ok) {
        const confirmed = (await response.json()) as GeoLocation;
        // Keep the typeahead's name/country if the reverse lookup is sparse.
        onChange({
          name: confirmed.name || result.name,
          country: confirmed.country ?? result.country,
          country_code: confirmed.country_code ?? result.country_code,
          admin_region: confirmed.admin_region ?? result.admin_region,
          lat: result.lat,
          lng: result.lng,
        });
      } else {
        onChange(result);
      }
    } catch {
      onChange(result);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          value={query}
          autoComplete="off"
          placeholder={placeholder}
          className="pr-8 pl-8"
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => {
            if (results.length > 0) setOpen(true);
          }}
        />
        {loading || confirming ? (
          <Loader2Icon className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {open ? (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              Searching
            </div>
          ) : results.length === 0 ? (
            searched ? (
              <div className="px-3 py-3 text-sm text-muted-foreground">
                {online ? "No results" : "Looking up places needs a connection."}
              </div>
            ) : null
          ) : (
            <ul className="max-h-72 overflow-y-auto py-1">
              {results.map((result, index) => (
                <li key={`${result.lat},${result.lng},${index}`}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
                    onClick={() => handleSelect(result)}
                  >
                    <span className="flex items-center leading-none">
                      {result.country_code ? (
                        <CountryFlag code={result.country_code} />
                      ) : (
                        <MapPinIcon className="size-4 text-muted-foreground" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {result.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[result.admin_region, result.country]
                          .filter(Boolean)
                          .join(", ")}
                      </span>
                    </span>
                    {result.country_code ? (
                      <span className="text-xs text-muted-foreground">
                        {result.country_code}
                      </span>
                    ) : null}
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

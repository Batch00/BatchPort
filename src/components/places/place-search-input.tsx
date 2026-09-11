"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2Icon, SearchIcon } from "lucide-react";

import { PlaceTypeIcon } from "@/components/places/place-type-icon";
import { Input } from "@/components/ui/input";
import { useOnlineStatus } from "@/lib/offline/use-offline";
import { SEARCH_MIN_CHARS, type PlaceSearchResult } from "@/lib/place-search";
import { cn } from "@/lib/utils";

// The typeahead over /api/places/search. Same shape as LocationSearch (debounce,
// click-outside, loading state) with two differences that matter:
//
//  * There is NO reverse-lookup confirm step. LocationSearch fires a second
//    request to /api/geocode/lookup to fill in the fields its typeahead does
//    not carry; this route already returns locality, region, and country on
//    every row, so a pick is one tap and no further network.
//
//  * A catalog row wears its catalogs as a badge. That is the whole visible
//    difference between "somewhere" and "a venue this app is tracking", and it
//    has to be legible before the tap, not after: picking the Photon copy of a
//    stadium instead of the catalog row is invisible until the visit fails to
//    count toward that catalog later.

const DEBOUNCE_MS = 300;

interface PlaceSearchInputProps {
  onPick: (result: PlaceSearchResult) => void;
  /** Optional map or device bias passed through to the route. */
  bias?: { lat: number; lng: number };
  id?: string;
  placeholder?: string;
  className?: string;
}

export function PlaceSearchInput({
  onPick,
  bias,
  id,
  placeholder = "Search for a place or venue",
  className,
}: PlaceSearchInputProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const online = useOnlineStatus();

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Only the newest response may set state: a slow "fis" landing after a fast
  // "fiserv" would otherwise replace the better list with the worse one.
  const requestRef = useRef(0);

  useEffect(() => {
    function onDocMouseDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
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
    if (trimmed.length < SEARCH_MIN_CHARS) {
      setResults([]);
      setOpen(false);
      setSearched(false);
      return;
    }
    const ticket = ++requestRef.current;
    setLoading(true);
    setOpen(true);

    const params = new URLSearchParams({ q: trimmed });
    if (bias) {
      params.set("lat", String(bias.lat));
      params.set("lng", String(bias.lng));
    }

    fetch(`/api/places/search?${params.toString()}`)
      .then(async (response) => {
        if (!response.ok) return [] as PlaceSearchResult[];
        const data = (await response.json()) as unknown;
        return Array.isArray(data) ? (data as PlaceSearchResult[]) : [];
      })
      .then((data) => {
        if (ticket !== requestRef.current) return;
        setResults(data);
        setSearched(true);
      })
      .catch(() => {
        if (ticket !== requestRef.current) return;
        setResults([]);
        setSearched(true);
      })
      .finally(() => {
        if (ticket === requestRef.current) setLoading(false);
      });
  }

  function handleInput(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(value), DEBOUNCE_MS);
  }

  function handleSelect(result: PlaceSearchResult) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setOpen(false);
    setQuery(result.name);
    onPick(result);
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
        {loading ? (
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
                {online ? "No results" : "Searching for places needs a connection."}
              </div>
            ) : null
          ) : (
            <ul className="max-h-72 overflow-y-auto py-1">
              {results.map((result) => (
                <li key={result.key}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
                    onClick={() => handleSelect(result)}
                  >
                    <PlaceTypeIcon
                      type={result.place_type}
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        result.catalog_item_id ? "text-brand" : "text-muted-foreground",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{result.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[result.locality_name, result.admin_region, result.country_code]
                          .filter(Boolean)
                          .join(", ") || "Location unknown"}
                      </span>
                      {result.catalogs.length > 0 ? (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {result.catalogs.map((catalog) => (
                            <span
                              key={catalog.slug}
                              className="rounded border border-brand/40 bg-brand/10 px-1.5 py-0.5 text-[10px] leading-none text-brand"
                            >
                              {catalog.label}
                            </span>
                          ))}
                        </span>
                      ) : null}
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

"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2Icon, SearchIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { haversineKm } from "@/lib/geo";
import type { PoiResult } from "@/lib/types";

interface PoiSearchProps {
  onSelect: (poi: PoiResult) => void;
  // Bias coordinates (the destination center) so nearby places rank first.
  lat?: number | null;
  lng?: number | null;
  id?: string;
  placeholder?: string;
}

const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

// Typeahead that searches POIs near a destination and reports the selection.
// Optional: the user can ignore it and type the experience name manually.
export function PoiSearch({
  onSelect,
  lat = null,
  lng = null,
  id,
  placeholder = "Search for a place (optional)",
}: PoiSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PoiResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

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
    const params = new URLSearchParams({ q: trimmed });
    if (lat !== null && lng !== null) {
      params.set("lat", String(lat));
      params.set("lng", String(lng));
    }
    fetch(`/api/geocode/poi?${params.toString()}`)
      .then(async (response) => {
        if (!response.ok) return [] as PoiResult[];
        const data = (await response.json()) as unknown;
        return Array.isArray(data) ? (data as PoiResult[]) : [];
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

  function handleSelect(poi: PoiResult) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setOpen(false);
    setQuery(poi.name);
    onSelect(poi);
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          value={query}
          autoComplete="off"
          placeholder={placeholder}
          className="pr-8 pl-8"
          onChange={(event) => handleInput(event.target.value)}
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
                No places found
              </div>
            ) : null
          ) : (
            <ul className="max-h-72 overflow-y-auto py-1">
              {results.map((poi, index) => {
                const distance =
                  lat !== null && lng !== null
                    ? formatDistance(haversineKm(lat, lng, poi.lat, poi.lng))
                    : null;
                return (
                  <li key={`${poi.lat},${poi.lng},${index}`}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
                      onClick={() => handleSelect(poi)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {poi.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {poi.type}
                          {poi.address ? ` · ${poi.address}` : ""}
                        </span>
                      </span>
                      {distance ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {distance}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

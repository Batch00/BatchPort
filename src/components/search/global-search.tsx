"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  BookmarkIcon,
  Loader2Icon,
  MapPinIcon,
  SearchIcon,
  SparklesIcon,
  TicketIcon,
  type LucideIcon,
} from "lucide-react";

import { CountryFlag } from "@/components/country-flag";
import { RatingDisplay } from "@/components/rating-display";
import { cn } from "@/lib/utils";
import {
  EMPTY_SEARCH_RESULTS,
  isSearchEmpty,
  SEARCH_MIN_CHARS,
  type SearchResult,
  type SearchResultKind,
  type SearchResults,
} from "@/lib/search-types";

// Command-palette search over the user's own data. Opened from the nav icon on
// every authenticated page, or with Cmd+K / Ctrl+K.
//
// This is NOT the globe's place search. That one finds cities in the world and
// lives on the map surface; this one finds things you have already logged and
// lives in the nav. The placeholder, the heading, and the empty state all say
// so, because "search" appearing twice in one product is exactly the kind of
// thing that quietly confuses people.

const DEBOUNCE_MS = 250;

const GROUPS: {
  key: keyof SearchResults;
  label: string;
  icon: LucideIcon;
}[] = [
  { key: "trips", label: "Trips", icon: TicketIcon },
  { key: "destinations", label: "Destinations", icon: MapPinIcon },
  { key: "experiences", label: "Experiences", icon: SparklesIcon },
  { key: "bucket", label: "Bucket list", icon: BookmarkIcon },
];

const KIND_ICON: Record<SearchResultKind, LucideIcon> = {
  trip: TicketIcon,
  destination: MapPinIcon,
  experience: SparklesIcon,
  bucket: BookmarkIcon,
};

export function GlobalSearch({ className }: { className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY_SEARCH_RESULTS);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [active, setActive] = useState(0);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // Guards against a slow earlier request overwriting a newer one's results.
  const requestRef = useRef(0);

  // Flattened in render order, so arrow keys move across group boundaries the
  // way the eye does.
  const flat = useMemo(() => {
    const rows: SearchResult[] = [];
    for (const group of GROUPS) rows.push(...results[group.key]);
    return rows;
  }, [results]);

  const runSearch = useCallback((value: string) => {
    const trimmed = value.trim();
    if (trimmed.length < SEARCH_MIN_CHARS) {
      setResults(EMPTY_SEARCH_RESULTS);
      setSearched(false);
      setLoading(false);
      return;
    }
    const token = requestRef.current + 1;
    requestRef.current = token;
    setLoading(true);
    fetch(`/api/search?q=${encodeURIComponent(trimmed)}`)
      .then(async (response) =>
        response.ok
          ? ((await response.json()) as SearchResults)
          : EMPTY_SEARCH_RESULTS,
      )
      .catch(() => EMPTY_SEARCH_RESULTS)
      .then((data) => {
        if (requestRef.current !== token) return;
        setResults(data);
        setSearched(true);
        setActive(0);
        setLoading(false);
      });
  }, []);

  function handleInput(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(value), DEBOUNCE_MS);
  }

  // Cmd+K / Ctrl+K from anywhere in the authenticated app.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(
      '[data-active="true"]',
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Reset on close so reopening is a fresh search rather than a stale one.
  // Done here rather than in an effect on `open`: this runs for every close
  // path (Escape, overlay click, trigger, navigation) and avoids a cascading
  // render.
  const setOpenAndReset = useCallback((next: boolean) => {
    setOpen(next);
    if (next) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Invalidate any request still in flight so its result cannot land after
    // the palette has been reset.
    requestRef.current += 1;
    setQuery("");
    setResults(EMPTY_SEARCH_RESULTS);
    setSearched(false);
    setLoading(false);
    setActive(0);
  }, []);

  function navigate(result: SearchResult) {
    setOpenAndReset(false);
    router.push(result.href);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (flat.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % flat.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index - 1 + flat.length) % flat.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const result = flat[active];
      if (result) navigate(result);
    }
    // Escape is handled by the dialog itself.
  }

  const empty = searched && !loading && isSearchEmpty(results);
  let flatIndex = -1;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpenAndReset}>
      <DialogPrimitive.Trigger
        aria-label="Search your travels"
        className={cn(
          "flex size-10 items-center justify-center rounded-md text-foreground/60 transition-colors hover:bg-white/5 hover:text-foreground sm:size-8",
          className,
        )}
      >
        <SearchIcon className="size-4" />
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content
          // Top-anchored rather than centred: the input should land near where
          // the trigger was, and on a phone keyboard the panel must not be
          // pushed off screen. Width is capped but never fixed, so 380px works.
          className="fixed inset-x-2 top-3 z-50 mx-auto flex max-h-[85dvh] w-auto max-w-xl flex-col overflow-hidden rounded-xl bg-card text-card-foreground shadow-xl ring-1 ring-foreground/10 duration-150 data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-top-2 data-closed:animate-out data-closed:fade-out-0 sm:inset-x-4 sm:top-[12vh]"
        >
          <DialogPrimitive.Title className="sr-only">
            Search your travels
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Find your own trips, destinations, experiences, and bucket list
            items by name or note.
          </DialogPrimitive.Description>

          <div className="relative shrink-0 border-b border-white/10">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
            {/* Autofocus is the point of a command palette: it opens ready to
                type, and it opens only on an explicit user action. */}
            <input
              autoFocus
              value={query}
              onChange={(event) => handleInput(event.target.value)}
              onKeyDown={onInputKeyDown}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Search your trips, places, and notes"
              aria-label="Search your trips, places, and notes"
              className="w-full bg-transparent py-3.5 pr-4 pl-10 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            {loading ? (
              <Loader2Icon className="absolute top-1/2 right-3.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            ) : null}
          </div>

          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {query.trim().length < SEARCH_MIN_CHARS ? (
              <p className="px-3 py-6 text-center text-sm text-foreground/40">
                Search everything you have logged. To find new places in the
                world, use the search on the globe.
              </p>
            ) : empty ? (
              <p className="px-3 py-6 text-center text-sm text-foreground/40">
                Nothing in your travels matches that.
              </p>
            ) : (
              GROUPS.map((group) => {
                const rows = results[group.key];
                if (rows.length === 0) return null;
                return (
                  <div key={group.key} className="mb-1 last:mb-0">
                    <p className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-foreground/35">
                      {group.label}
                    </p>
                    <ul>
                      {rows.map((result) => {
                        flatIndex += 1;
                        const index = flatIndex;
                        const Icon = KIND_ICON[result.kind];
                        return (
                          <li key={`${result.kind}:${result.id}`}>
                            <button
                              type="button"
                              data-active={index === active}
                              onMouseMove={() => setActive(index)}
                              onClick={() => navigate(result)}
                              className={cn(
                                "flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors",
                                index === active
                                  ? "bg-brand/15"
                                  : "hover:bg-white/[0.04]",
                              )}
                            >
                              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-foreground/40">
                                {result.countryCode ? (
                                  <CountryFlag
                                    code={result.countryCode}
                                    className="h-3"
                                  />
                                ) : (
                                  <Icon className="size-3.5" />
                                )}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2">
                                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                                    {result.title}
                                  </span>
                                  {typeof result.rating === "number" ? (
                                    <RatingDisplay
                                      rating={result.rating}
                                      size={11}
                                      showNumber={false}
                                      className="shrink-0"
                                    />
                                  ) : null}
                                </span>
                                {result.context ? (
                                  <span className="block truncate text-xs text-foreground/45">
                                    {result.context}
                                  </span>
                                ) : null}
                                {result.excerpt ? (
                                  <span className="mt-0.5 block truncate text-xs text-foreground/35 italic">
                                    {result.excerpt}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })
            )}
          </div>

          <div className="hidden shrink-0 items-center gap-3 border-t border-white/10 px-3 py-2 text-[11px] text-foreground/35 sm:flex">
            <span>Arrow keys to move</span>
            <span>Enter to open</span>
            <span>Esc to close</span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

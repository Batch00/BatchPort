"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, XIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { flagEmoji } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CountryOption } from "@/lib/bucket-list";

interface CountryComboboxProps {
  countries: CountryOption[];
  value: string | null;
  onChange: (code: string | null) => void;
  placeholder?: string;
  allowClear?: boolean;
  id?: string;
}

// A lightweight searchable country dropdown. The reference list is small (a
// curated set), so it filters a rendered list rather than needing a virtualized
// command palette.
export function CountryCombobox({
  countries,
  value,
  onChange,
  placeholder = "Search countries",
  allowClear = false,
  id,
}: CountryComboboxProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const selected = value
    ? countries.find((country) => country.code === value) ?? null
    : null;

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

  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? countries.filter(
        (country) =>
          country.name.toLowerCase().includes(normalized) ||
          country.code.toLowerCase().includes(normalized),
      )
    : countries;

  if (selected && !open) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          id={id}
          onClick={() => {
            setQuery("");
            setOpen(true);
          }}
          className="flex h-9 flex-1 items-center gap-2 rounded-lg border border-input bg-input/30 px-3 text-left text-sm"
        >
          <span className="text-base leading-none">
            {flagEmoji(selected.code)}
          </span>
          <span className="flex-1 truncate">{selected.name}</span>
          <ChevronDownIcon className="size-4 text-muted-foreground" />
        </button>
        {allowClear ? (
          <button
            type="button"
            aria-label="Clear country"
            onClick={() => onChange(null)}
            className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        id={id}
        value={query}
        autoComplete="off"
        placeholder={placeholder}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open ? (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg bg-popover py-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              No countries
            </div>
          ) : (
            filtered.map((country) => (
              <button
                key={country.code}
                type="button"
                onClick={() => {
                  onChange(country.code);
                  setQuery("");
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                  country.code === value && "bg-accent/50",
                )}
              >
                <span className="text-base leading-none">
                  {flagEmoji(country.code)}
                </span>
                <span className="flex-1 truncate">{country.name}</span>
                <span className="text-xs text-muted-foreground">
                  {country.code}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

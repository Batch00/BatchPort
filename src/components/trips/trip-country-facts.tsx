"use client";

import { useEffect, useState } from "react";

import { CountryFactsRow } from "@/components/discover/country-facts";
import { CountryFlag } from "@/components/country-flag";
import type { DiscoverCountry } from "@/lib/discover";

// Slim practical-facts strip for planned and ongoing trips: one row per
// country involved, fetched from the cached country aggregate. Rows appear as
// each country resolves; countries without facts contribute nothing, and the
// whole strip stays invisible until at least one row has content.

export interface TripFactsCountry {
  code: string;
  name: string;
}

export function TripCountryFacts({
  countries,
}: {
  countries: TripFactsCountry[];
}) {
  const [byCode, setByCode] = useState<Record<string, DiscoverCountry>>({});

  useEffect(() => {
    const controller = new AbortController();
    for (const country of countries) {
      fetch(`/api/discover/country?code=${country.code}`, {
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: DiscoverCountry | null) => {
          if (data?.facts) {
            setByCode((current) => ({ ...current, [country.code]: data }));
          }
        })
        .catch(() => {
          // Facts are a nicety; a failed fetch just leaves the row out.
        });
    }
    return () => controller.abort();
    // The country list is derived fresh per render but its identity is the
    // codes; refetching on any parent re-render would spam the route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countries.map((country) => country.code).join(",")]);

  const rows = countries.filter((country) => byCode[country.code]?.facts);
  if (rows.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-foreground/40">
        Good to know
      </h2>
      <div className="flex flex-col gap-2">
        {rows.map((country) => (
          <div
            key={country.code}
            className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5"
          >
            {rows.length > 1 ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-foreground/60">
                <CountryFlag code={country.code} className="h-3" />
                {country.name}
              </span>
            ) : null}
            <CountryFactsRow facts={byCode[country.code].facts} />
          </div>
        ))}
      </div>
    </section>
  );
}

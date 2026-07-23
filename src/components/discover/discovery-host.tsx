"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

import type {
  DiscoveryCityTarget,
  DiscoveryPoiTarget,
} from "@/components/discover/discovery-panel";
import type { BucketItem } from "@/lib/bucket-list";
import type { TripDestinationOption } from "@/lib/trips";

// The single discovery panel host for a page. Every surface that can open
// discovery (globe clicks, search, drill-down Explore, bucket cards) renders
// inside a DiscoveryProvider and calls useDiscovery().open(target), so one
// panel instance exists per page and openers never race each other. The
// provider owns the overlay markup that used to live in each host: a fixed
// full-viewport wrapper whose empty area dismisses the panel.

// Heavy panel (heroes, summaries, city grid), only mounted when a target is
// opened; keep it out of every page's initial bundle.
const DiscoveryPanel = dynamic(
  () =>
    import("@/components/discover/discovery-panel").then(
      (module) => module.DiscoveryPanel,
    ),
  { ssr: false },
);

/** What the discovery panel is pointed at: a country, optionally opened
 * straight onto one of its cities (search results, bucket place items) or a
 * POI detail (map attraction markers, which may carry no country context). */
export interface DiscoveryTarget {
  code: string;
  name: string;
  city: DiscoveryCityTarget | null;
  poi?: DiscoveryPoiTarget | null;
}

// How a bucket item opens in discovery, shared by every card grid: country
// items land on the country view, place items straight on the city view
// (with stored coordinates when present). Null when the item lacks the data
// discovery needs.
export function bucketItemDiscoveryTarget(
  item: BucketItem,
): DiscoveryTarget | null {
  if (item.type === "country") {
    if (!item.country_code) return null;
    return {
      code: item.country_code,
      name: item.country_name ?? item.country_code,
      city: null,
    };
  }
  if (!item.place_name) return null;
  return {
    code: item.country_code ?? "",
    name: item.country_name ?? item.country_code ?? "",
    city: { name: item.place_name, lat: item.lat, lng: item.lng },
  };
}

interface DiscoveryContextValue {
  target: DiscoveryTarget | null;
  open: (target: DiscoveryTarget) => void;
  close: () => void;
}

const DiscoveryContext = createContext<DiscoveryContextValue | null>(null);

export function useDiscovery(): DiscoveryContextValue {
  const value = useContext(DiscoveryContext);
  if (!value) {
    throw new Error("useDiscovery must be used inside a DiscoveryProvider");
  }
  return value;
}

interface DiscoveryProviderProps {
  /** Countries on the user's unfulfilled bucket list, for the panel's
   * "On your bucket list" state. */
  bucketCountryCodes: string[];
  /** placeKey() identities of unfulfilled place-type items, likewise. */
  bucketPlaceKeys: string[];
  /**
   * Anon and demo surfaces: the panel swaps its mutation actions for the
   * request-access conversion treatment and skips the post-add refresh.
   */
  readOnly?: boolean;
  /** The user's trips with destinations, for the POI detail's "Add to a
   * trip" picker. Omit on read-only surfaces. */
  tripOptions?: TripDestinationOption[];
  children: ReactNode;
}

export function DiscoveryProvider({
  bucketCountryCodes,
  bucketPlaceKeys,
  readOnly = false,
  tripOptions,
  children,
}: DiscoveryProviderProps) {
  const [target, setTarget] = useState<DiscoveryTarget | null>(null);
  const router = useRouter();

  const open = useCallback((next: DiscoveryTarget) => setTarget(next), []);
  const close = useCallback(() => setTarget(null), []);
  const value = useMemo(
    () => ({ target, open, close }),
    [target, open, close],
  );

  return (
    <DiscoveryContext.Provider value={value}>
      {children}
      {/* The positioned wrapper gives the panel's sm:absolute layout a
          viewport-sized container, and clicking the empty area dismisses. */}
      {target ? (
        <div className="fixed inset-0 z-40" onClick={close}>
          <div
            className="contents"
            onClick={(event) => event.stopPropagation()}
          >
            <DiscoveryPanel
              key={`${target.code}:${target.city?.name ?? ""}:${target.poi?.name ?? ""}`}
              code={target.code}
              name={target.name}
              isOnBucketList={bucketCountryCodes.includes(target.code)}
              bucketPlaceKeys={bucketPlaceKeys}
              initialCity={target.city}
              initialPoi={target.poi ?? null}
              readOnly={readOnly}
              tripOptions={tripOptions}
              onClose={close}
              onBucketAdded={readOnly ? undefined : () => router.refresh()}
            />
          </div>
        </div>
      ) : null}
    </DiscoveryContext.Provider>
  );
}

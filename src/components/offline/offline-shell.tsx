"use client";

import { useEffect, useMemo, useState } from "react";
import { CloudOffIcon, ImageIcon, Loader2Icon } from "lucide-react";

import { Globe } from "@/components/map/globe";
import { StatusBadge } from "@/components/trips/status-badge";
import { CountryFlag } from "@/components/country-flag";
import { OfflineStatus } from "@/components/offline/offline-status";
import { OfflineTripView } from "@/components/offline/offline-trip";
import { formatDateRange } from "@/lib/format";
import { loadSnapshot, refreshSnapshot } from "@/lib/offline/snapshot";
import { useOnlineStatus } from "@/lib/offline/use-offline";
import type { OfflineSnapshot } from "@/lib/offline/types";

// The offline shell: the page the service worker serves when a navigation
// fails, rendered entirely from the IndexedDB snapshot.
//
// It is a real page rather than an error screen, and it is public (no session
// needed) for a specific reason: the whole point is that it renders with no
// server, and a route that redirects unauthenticated visitors cannot be
// precached or served from a cache. It exposes nothing, because it reads only
// what this device already stored for the account that stored it.
//
// Navigation inside it is local state, not routing. Following a real link
// offline would go back to the network, fail, and land here again with the
// trip lost; a state-driven master/detail keeps the whole snapshot reachable
// from one cached document.

type View = { kind: "list" } | { kind: "trip"; id: string };

export function OfflineShell() {
  const online = useOnlineStatus();
  const [snapshot, setSnapshot] = useState<OfflineSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>({ kind: "list" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadSnapshot();
      if (cancelled) return;
      setSnapshot(stored);
      setLoading(false);
      // If there is a connection after all (the user landed here from a
      // failed navigation that has since recovered), take the chance to
      // freshen what is stored.
      if (navigator.onLine) {
        const fresh = await refreshSnapshot();
        if (!cancelled && fresh) setSnapshot(fresh);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const trip = useMemo(
    () =>
      view.kind === "trip"
        ? (snapshot?.trips.find((item) => item.id === view.id) ?? null)
        : null,
    [snapshot, view],
  );

  return (
    <div className="flex min-h-dvh flex-col bg-[#0a0a0a]">
      <header className="border-b border-white/10 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <span className="text-sm font-semibold tracking-tight">
            Batch<span className="text-brand">Port</span>
          </span>
          <div className="flex items-center gap-3">
            <OfflineStatus />
            {online ? (
              // A hard link, not a router push: the point of this button is to
              // leave the cached shell and hit the server again.
              <a
                href="/dashboard"
                className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground transition-colors hover:bg-brand/90"
              >
                Back to the app
              </a>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 p-6 sm:p-8">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-24 text-sm text-foreground/50">
            <Loader2Icon className="size-4 animate-spin" />
            Opening your saved trips
          </div>
        ) : !snapshot ? (
          <EmptyState online={online} />
        ) : trip ? (
          <OfflineTripView
            trip={trip}
            categories={snapshot.categories}
            readOnly={snapshot.demo}
            onBack={() => setView({ kind: "list" })}
          />
        ) : (
          <TripList
            snapshot={snapshot}
            online={online}
            onOpen={(id) => setView({ kind: "trip", id })}
          />
        )}
      </main>
    </div>
  );
}

function EmptyState({ online }: { online: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 px-6 py-16 text-center">
      <CloudOffIcon className="mx-auto size-6 text-foreground/30" />
      <p className="mt-3 text-sm text-foreground/70">
        Nothing is saved on this device yet.
      </p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-foreground/45">
        BatchPort saves a copy of your trips the first time you open it with a
        connection. {online ? "Reload to fetch one now." : "Once you are back online, open the app once and it will be here next time."}
      </p>
      {online ? (
        <a
          href="/dashboard"
          className="mt-4 inline-flex rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground transition-colors hover:bg-brand/90"
        >
          Open the app
        </a>
      ) : null}
    </div>
  );
}

function TripList({
  snapshot,
  online,
  onOpen,
}: {
  snapshot: OfflineSnapshot;
  online: boolean;
  onOpen: (id: string) => void;
}) {
  const savedAt = new Date(snapshot.savedAt);
  const savedLabel = Number.isNaN(savedAt.getTime())
    ? null
    : savedAt.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">
        {online ? "Your saved copy" : "Offline"}
      </h1>
      <p className="mt-1 max-w-prose text-sm leading-relaxed text-foreground/55">
        {online
          ? "This is the copy stored on this device. The live app is available again."
          : "Your trips, stops, plans and journal are here, read from this device. Checking things off and writing in the journal both work: they are queued and sent when you reconnect."}
        {savedLabel ? (
          <span className="text-foreground/35"> Saved {savedLabel}.</span>
        ) : null}
      </p>

      {/* The same Globe component the dashboard renders, on the same payload.
          The dark basemap and the countries outlines are local static files,
          so the map is fully drawn with no network at all. */}
      <div className="mt-6 h-[320px] overflow-hidden rounded-xl ring-1 ring-white/10 sm:h-[380px]">
        <Globe
          visitedCountryCodes={snapshot.map.visitedCountryCodes}
          plannedCountryCodes={snapshot.map.plannedCountryCodes}
          bucketCountryCodes={snapshot.map.bucketCountryCodes}
          destinations={snapshot.map.destinations.map((destination) => ({
            id: destination.id,
            tripId: destination.tripId,
            tripName: destination.tripName,
            name: destination.name,
            countryCode: destination.countryCode,
            lat: destination.lat,
            lng: destination.lng,
            arrivalDate: destination.arrivalDate,
            departureDate: destination.departureDate,
            categoryColor: destination.category?.color ?? null,
            planned: destination.planned,
            orderIndex: destination.orderIndex,
            transportMode: destination.transportMode,
          }))}
          arcs={snapshot.map.arcs.map((arc) => ({
            sourcePosition: arc.sourcePosition,
            targetPosition: arc.targetPosition,
            tripName: arc.tripName,
            sourceCity: arc.sourceCity,
            targetCity: arc.targetCity,
            planned: arc.planned,
            mode: arc.mode,
          }))}
          autoRotate={false}
          fitToData
        />
      </div>

      <h2 className="mb-3 mt-8 text-sm font-medium text-foreground/80">
        Trips
      </h2>

      {snapshot.trips.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 px-6 py-10 text-center text-sm text-foreground/50">
          No trips in the saved copy.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {snapshot.trips.map((trip) => (
            <li key={trip.id}>
              <button
                type="button"
                onClick={() => onOpen(trip.id)}
                className="flex w-full items-center gap-4 rounded-xl bg-white/[0.02] p-3 text-left ring-1 ring-foreground/10 transition-colors hover:ring-brand/40"
              >
                <div className="h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-white/5">
                  {trip.coverThumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={trip.coverThumbUrl}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center text-foreground/25">
                      <ImageIcon className="size-5" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 break-words font-medium">
                      {trip.name}
                    </span>
                    <StatusBadge status={trip.status} />
                  </div>
                  <p className="text-xs text-foreground/45">
                    {formatDateRange(trip.startDate, trip.endDate)}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-foreground/40">
                    {trip.destinations.length}{" "}
                    {trip.destinations.length === 1 ? "stop" : "stops"}
                    {trip.destinations
                      .map((destination) => destination.countryCode)
                      .filter(
                        (code, index, list): code is string =>
                          Boolean(code) && list.indexOf(code) === index,
                      )
                      .slice(0, 6)
                      .map((code) => (
                        <CountryFlag key={code} code={code} />
                      ))}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2Icon,
  DownloadIcon,
  Loader2Icon,
  TrashIcon,
} from "lucide-react";

import { loadSnapshot } from "@/lib/offline/snapshot";
import { tripThumbUrls } from "@/lib/offline/types";
import {
  approxSize,
  readOfflineTrips,
  removeTrip,
  warmTrip,
  type OfflineTripRecord,
} from "@/lib/offline/trip-cache";
import { useOnlineStatus } from "@/lib/offline/use-offline";

// The per-trip "Available offline" control.
//
// It is honest about three things, and each of them is a sentence in the UI
// rather than a footnote:
//
//   1. Trip data is already offline whether or not this is on. The snapshot
//      carries every trip because trip rows are cheap; a toggle deciding
//      whether a trip is readable would only ever fail the person who forgot
//      to flip it before the flight. What this controls is the expensive part.
//   2. What it stores is photo thumbnails, capped, with the count and an
//      approximate size shown after the fact rather than a guess before it.
//   3. It does not download map tiles. MapTiler's terms permit caching what
//      the user has already viewed and prohibit bulk download, so the map
//      caches as you look at it and this button does not pretend otherwise.
//      The dark basemap and country outlines are local files and always work.
//
// Nothing here needs a server. Warming reads the same public URLs the gallery
// does and writes them into Cache Storage, so it is one button with no action
// behind it.

export function TripOfflineToggle({ tripId }: { tripId: string }) {
  const online = useOnlineStatus();
  const [record, setRecord] = useState<OfflineTripRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [trips, snapshot] = await Promise.all([
        readOfflineTrips(),
        loadSnapshot(),
      ]);
      if (cancelled) return;
      setRecord(trips[tripId] ?? null);
      const trip = snapshot?.trips.find((item) => item.id === tripId) ?? null;
      setAvailable(trip ? tripThumbUrls(trip).length : 0);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  async function enable() {
    setBusy(true);
    // Read the snapshot fresh rather than trusting the mount-time count: the
    // user may have added photos since this page loaded.
    const snapshot = await loadSnapshot();
    const trip = snapshot?.trips.find((item) => item.id === tripId) ?? null;
    if (!trip) {
      setBusy(false);
      toast.error("This trip is not in the saved copy yet.", {
        description: "Reload the page once with a connection, then try again.",
      });
      return;
    }
    const urls = tripThumbUrls(trip);
    const result = await warmTrip(tripId, urls);
    const trips = await readOfflineTrips();
    setRecord(trips[tripId] ?? null);
    setAvailable(urls.length);
    setBusy(false);

    if (!result.ok) {
      toast.error(result.error ?? "Could not save this trip offline.");
      return;
    }
    toast.success("Saved for offline", {
      description:
        result.photoCount === 0
          ? "This trip has no photos to store, so its text is all there is (and it was already saved)."
          : `${result.photoCount} photo${result.photoCount === 1 ? "" : "s"} stored, about ${approxSize(result.photoCount)}.${
              result.capped ? " Older photos past the cap were skipped." : ""
            }`,
    });
  }

  async function disable() {
    setBusy(true);
    await removeTrip(tripId);
    setRecord(null);
    setBusy(false);
    toast.success("Offline photos removed", {
      description: "This trip is still readable offline, without its photos.",
    });
  }

  if (!loaded) return null;

  const on = record !== null;

  return (
    <section className="mt-8 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-sm font-medium text-foreground/85">
            {on ? (
              <CheckCircle2Icon className="size-4 shrink-0 text-brand" />
            ) : (
              <DownloadIcon className="size-4 shrink-0 text-foreground/40" />
            )}
            Available offline
          </h2>
          <p className="mt-1 max-w-prose text-xs leading-relaxed text-foreground/50">
            {on
              ? `${record.photoCount} photo${
                  record.photoCount === 1 ? "" : "s"
                } stored on this device, about ${approxSize(record.photoCount)}.`
              : available === 0
                ? "This trip's stops, plans and journal are already saved on this device. It has no photos to store."
                : `This trip's stops, plans and journal are already saved on this device. Turn this on to keep its ${available} photo thumbnail${
                    available === 1 ? "" : "s"
                  } too, about ${approxSize(available)}.`}
          </p>
          <p className="mt-1.5 max-w-prose text-[11px] leading-relaxed text-foreground/35">
            Map tiles are not downloaded ahead of time: MapTiler allows keeping
            what you have already looked at, not bulk downloads. The dark
            basemap and country outlines work offline either way.
          </p>
        </div>

        <button
          type="button"
          disabled={busy || (!on && (!online || available === 0))}
          onClick={() => void (on ? disable() : enable())}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-white/15 px-3 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-white/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : on ? (
            <TrashIcon className="size-3.5" />
          ) : (
            <DownloadIcon className="size-3.5" />
          )}
          {busy ? "Working" : on ? "Remove" : "Save photos"}
        </button>
      </div>

      {!on && !online && available > 0 ? (
        <p className="mt-2 text-[11px] text-amber-300/70">
          Saving photos needs a connection. The trip itself is already readable
          offline.
        </p>
      ) : null}
    </section>
  );
}

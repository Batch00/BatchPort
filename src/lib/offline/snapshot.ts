"use client";

// Client side of the offline snapshot: fetch it when online, keep the last one
// in IndexedDB, hand it to the offline shell when there is no connection.
//
// The refresh is deliberately cheap to trigger and cheap to skip. It runs on
// mount and on every reconnect, and it is a single request the page does not
// wait for: a stale snapshot is far better than a blocked render, and the live
// pages never read from it at all while there is a network.

import { METADATA_STALE_MS } from "./constants";
import { META_SNAPSHOT, metaGet, metaPut } from "./db";
import { SNAPSHOT_VERSION, type OfflineSnapshot } from "./types";

let inFlight: Promise<OfflineSnapshot | null> | null = null;

/** The stored snapshot, or null when there is none or it predates the current
 * shape. A version mismatch is discarded rather than migrated: it is a cache
 * of server data, so the cost of throwing it away is one refetch. */
export async function loadSnapshot(): Promise<OfflineSnapshot | null> {
  const stored = await metaGet<OfflineSnapshot>(META_SNAPSHOT);
  if (!stored || stored.version !== SNAPSHOT_VERSION) return null;
  return stored;
}

/** Whether the stored snapshot is old enough to be worth refreshing. */
export function isStale(snapshot: OfflineSnapshot | null): boolean {
  if (!snapshot) return true;
  const age = Date.now() - Date.parse(snapshot.savedAt);
  return !Number.isFinite(age) || age > METADATA_STALE_MS;
}

/**
 * Fetch a fresh snapshot and store it. Resolves to null on any failure
 * (offline, signed out, server error) and leaves whatever was already stored
 * in place: a failed refresh must never leave the user with less than they had.
 */
export async function refreshSnapshot(): Promise<OfflineSnapshot | null> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const response = await fetch("/api/offline/snapshot", {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) return null;
      const snapshot = (await response.json()) as OfflineSnapshot;
      if (snapshot.version !== SNAPSHOT_VERSION) return null;
      await metaPut(META_SNAPSHOT, snapshot);
      return snapshot;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";

import {
  getQueueState,
  subscribeQueue,
  syncQueue,
  type QueueState,
} from "./queue";

// Client hooks for the offline surfaces.

const SERVER_STATE: QueueState = { entries: [], syncing: false, loaded: false };

/** The pending write queue, live. */
export function useOfflineQueue(): QueueState {
  return useSyncExternalStore(
    subscribeQueue,
    getQueueState,
    () => SERVER_STATE,
  );
}

/**
 * Whether the browser believes it has a connection.
 *
 * navigator.onLine is famously optimistic: it reports true for a device
 * attached to a captive-portal wifi that routes nowhere. That is acceptable
 * here because nothing depends on it being right. A write attempted while
 * "online" but actually offline fails, and the failure path is the same path a
 * queued write takes; a read attempted while "online" falls back to the
 * snapshot. The flag decides which message to show first, not whether data is
 * safe.
 *
 * Rendering starts as online on purpose: the server has no navigator, and
 * flashing an offline notice on every first paint would be worse than being a
 * frame late to show it.
 */
function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/**
 * The guard every mutation that cannot be queued calls first.
 *
 * Returns true when the action must not proceed, having already told the user
 * why. The message names the action, because "you are offline" on its own does
 * not tell someone whether their tap did anything.
 */
export function useConnectionGuard(): (label: string) => boolean {
  const online = useOnlineStatus();
  return useCallback(
    (label: string) => {
      if (online) return false;
      toast.error(`${label} needs a connection.`, {
        description: "Nothing was changed. Try again once you are back online.",
      });
      return true;
    },
    [online],
  );
}

/** Kick the replay loop whenever the connection comes back. Mounted once, by
 * the offline provider. */
export function useReplayOnReconnect(): void {
  useEffect(() => {
    const run = () => void syncQueue();
    window.addEventListener("online", run);
    // Also on mount: a tab restored from the background may have reconnected
    // while it was frozen, with no event delivered.
    if (navigator.onLine) run();
    return () => window.removeEventListener("online", run);
  }, []);
}

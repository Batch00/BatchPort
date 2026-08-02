"use client";

// The offline write queue: a small module-level store over the IndexedDB queue
// table, plus the replay loop that drains it.
//
// Three rules hold this together, and they are the whole reason the feature is
// trustworthy:
//
//   1. A queued write is never dropped. It leaves the queue by succeeding or
//      by the user discarding it, and by nothing else. A replay that fails
//      keeps its row, keeps its error text, and keeps appearing in the panel.
//   2. Enqueueing reports whether it landed. If IndexedDB refuses the write
//      (private mode, quota), the caller shows a refusal rather than a
//      confirmation, because the alternative is telling a user their journal
//      entry is safe when it is in nothing but a React state variable.
//   3. Replay is FIFO and serial. The ops are ordered in intent (check off,
//      then rate) and running them in parallel would let the second land
//      first.
//
// Conflict policy: last write wins, per row. Every queued op is either an
// upsert on a natural key (journal entry, transport-free checkoff) or a create
// guarded by a server-side duplicate check, so replaying it against a row the
// user has since edited on another device overwrites that edit rather than
// merging with it. This is a single-user app; a merge UI for "you changed this
// journal day on two devices" would cost more than it saves. The policy is
// stated in the queue panel too, so it is never a surprise.

import { replayOfflineOp } from "@/lib/actions/offline";
import {
  MAX_ATTEMPTS,
  coalesceKey,
  type QueuedEntry,
  type QueuedOp,
} from "./queue-types";
import { queueAll, queueDelete, queuePut } from "./db";

export interface QueueState {
  entries: QueuedEntry[];
  /** True while the replay loop is running. */
  syncing: boolean;
  /** True once the first read of IndexedDB has completed. */
  loaded: boolean;
}

let state: QueueState = { entries: [], syncing: false, loaded: false };
const listeners = new Set<() => void>();
let loadStarted = false;

function emit() {
  for (const listener of listeners) listener();
}

function setState(next: Partial<QueueState>) {
  state = { ...state, ...next };
  emit();
}

export function getQueueState(): QueueState {
  return state;
}

export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener);
  // First subscriber triggers the initial read. Doing it here rather than at
  // module scope keeps IndexedDB untouched until something actually renders.
  if (!loadStarted) {
    loadStarted = true;
    void reloadQueue();
  }
  return () => listeners.delete(listener);
}

function byCreatedAt(a: QueuedEntry, b: QueuedEntry): number {
  return a.createdAt - b.createdAt;
}

async function reloadQueue(): Promise<void> {
  const rows = await queueAll<QueuedEntry>();
  setState({ entries: rows.sort(byCreatedAt), loaded: true });
}

function newId(): string {
  // Time-prefixed so the natural key order is also the insertion order, and
  // random-suffixed so two writes in the same millisecond cannot collide.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Queue one write for replay. Returns false when it could not be stored, in
 * which case the caller must NOT tell the user it is saved.
 *
 * Coalescing (journal saves only) replaces the pending entry for the same day
 * rather than appending, so an autosaving editor does not queue a write per
 * keystroke burst.
 */
export async function enqueue(op: QueuedOp): Promise<boolean> {
  const key = coalesceKey(op);
  const existing = key
    ? state.entries.find(
        (entry) => coalesceKey(entry.op) === key && !entry.failedReason,
      )
    : undefined;

  const entry: QueuedEntry = {
    id: existing?.id ?? newId(),
    op,
    createdAt: existing?.createdAt ?? Date.now(),
    attempts: 0,
    lastError: null,
    failedReason: null,
  };

  const stored = await queuePut(entry);
  if (!stored) return false;

  const rest = state.entries.filter((item) => item.id !== entry.id);
  setState({ entries: [...rest, entry].sort(byCreatedAt) });
  return true;
}

/** Remove a queued write at the user's explicit request. This is the only path
 * that deletes an unsent write, and it is always a tap the user made. */
export async function discardEntry(id: string): Promise<void> {
  await queueDelete(id);
  setState({ entries: state.entries.filter((entry) => entry.id !== id) });
}

async function updateEntry(entry: QueuedEntry): Promise<void> {
  await queuePut(entry);
  setState({
    entries: state.entries
      .map((item) => (item.id === entry.id ? entry : item))
      .sort(byCreatedAt),
  });
}

/** Clear the parked state on failed entries so the next sync tries them again.
 * Explicit: a failed write never silently resumes. */
export async function retryFailed(): Promise<void> {
  const failed = state.entries.filter((entry) => entry.failedReason !== null);
  for (const entry of failed) {
    await updateEntry({ ...entry, attempts: 0, failedReason: null });
  }
  await syncQueue();
}

/**
 * Drain the queue, oldest first. Stops at the first entry that fails with a
 * retryable error (almost certainly the connection went away again), so the
 * ordering guarantee holds: nothing behind a pending write is replayed before
 * it.
 *
 * A refusal the server will repeat (the demo guard, a validation error) is not
 * retryable. That entry is parked as failed and the loop continues past it,
 * because leaving it at the head would block every later write forever.
 */
export async function syncQueue(): Promise<void> {
  if (state.syncing) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  if (!state.loaded) await reloadQueue();
  if (state.entries.length === 0) return;

  setState({ syncing: true });
  try {
    for (const entry of [...state.entries]) {
      if (entry.failedReason) continue;
      if (typeof navigator !== "undefined" && navigator.onLine === false) break;

      let result: Awaited<ReturnType<typeof replayOfflineOp>>;
      try {
        result = await replayOfflineOp(entry.op);
      } catch {
        // The action never reached the server. Retryable by definition, and
        // the connection is the likeliest cause, so stop the loop.
        await updateEntry({
          ...entry,
          attempts: entry.attempts + 1,
          lastError: "Could not reach the server.",
          failedReason:
            entry.attempts + 1 >= MAX_ATTEMPTS
              ? "Could not reach the server after several tries."
              : null,
        });
        break;
      }

      if ("ok" in result) {
        await queueDelete(entry.id);
        setState({
          entries: state.entries.filter((item) => item.id !== entry.id),
        });
        continue;
      }

      const attempts = entry.attempts + 1;
      const parked = !result.retryable || attempts >= MAX_ATTEMPTS;
      await updateEntry({
        ...entry,
        attempts,
        lastError: result.error,
        failedReason: parked ? result.error : null,
      });
      // A retryable failure means the network is the problem; stop rather than
      // burning through the rest of the queue against the same wall.
      if (!parked && result.retryable) break;
    }
  } finally {
    setState({ syncing: false });
  }
}

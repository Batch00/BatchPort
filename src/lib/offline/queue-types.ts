// The offline write queue's vocabulary. Pure types plus labelling, so both the
// client (which enqueues) and the replay path (which drains) agree on the
// shape, and the pending panel can describe an entry without knowing how to
// perform it.
//
// What is queueable and what is not is a deliberate short list. A mutation
// earns a place here only if it is something a traveller does standing
// somewhere with no signal AND its replay is safe to describe as last write
// wins. That is four things:
//
//   - checking a planned experience off (the field action)
//   - writing a journal entry (the field action that takes longest)
//   - logging a new experience, including from nearby mode
//   - marking a bucket list item fulfilled
//
// Everything else (deletes, reordering, creating or editing trips and stops,
// settings, photo uploads) is refused offline rather than queued. Not because
// it is hard, but because their conflict semantics are worth more than a guess:
// a queued delete replayed against a row someone already changed, or a queued
// reorder replayed onto a list that has since gained an item, produces a result
// nobody asked for and nobody can see happening. Refusing is honest; queueing
// them would be the app inventing intent.

/** A queued write, discriminated by `kind`. Every variant carries enough
 * display text to render the pending panel with no snapshot lookup, because
 * the item it refers to may have been replaced by a newer snapshot. */
export type QueuedOp =
  | {
      kind: "experience.checkoff";
      experienceId: string;
      experienceName: string;
      rating: number | null;
      visitedDate: string | null;
    }
  | {
      kind: "journal.save";
      tripId: string;
      tripName: string;
      entryDate: string;
      body: string;
    }
  | {
      kind: "experience.create";
      destinationId: string;
      destinationName: string;
      name: string;
      categoryId: string | null;
      rating: number | null;
      visitedDate: string | null;
      notes: string | null;
      status: "planned" | "done";
      lat: number | null;
      lng: number | null;
    }
  | {
      kind: "bucket.fulfill";
      itemId: string;
      itemLabel: string;
      tripId: string;
    };

export type QueuedOpKind = QueuedOp["kind"];

/** A queue row. `failedReason` set means replay stopped trying: the write is
 * still here and still visible, waiting for the user to retry or discard it.
 * Nothing is ever removed without either succeeding or being discarded by
 * hand. */
export interface QueuedEntry {
  id: string;
  op: QueuedOp;
  createdAt: number;
  attempts: number;
  /** Last error text from a replay attempt, retryable or not. */
  lastError: string | null;
  /** Set when replay gave up (a refusal the server will repeat, or too many
   * attempts). The entry stays in the queue and surfaces in the panel. */
  failedReason: string | null;
}

/** Attempts before an entry is parked as failed. Three is enough to ride out a
 * flaky reconnect and few enough that a genuinely broken write surfaces while
 * the user still remembers making it. */
export const MAX_ATTEMPTS = 3;

/** One line describing a pending write, for the queue panel. */
export function describeOp(op: QueuedOp): string {
  switch (op.kind) {
    case "experience.checkoff":
      return `Checked off "${op.experienceName}"`;
    case "journal.save":
      return op.body.trim().length === 0
        ? `Cleared the journal entry for ${op.entryDate}`
        : `Journal entry for ${op.entryDate}`;
    case "experience.create":
      return op.destinationName
        ? `Logged "${op.name}" in ${op.destinationName}`
        : `Logged "${op.name}"`;
    case "bucket.fulfill":
      return `Completed "${op.itemLabel}"`;
  }
}

/** Secondary line: where the write lands. */
export function describeOpContext(op: QueuedOp): string | null {
  switch (op.kind) {
    case "journal.save":
      return op.tripName;
    case "experience.create":
      return op.status === "planned" ? "Saved as an idea" : null;
    default:
      return null;
  }
}

/**
 * The key two queued writes collapse onto, or null when every one of them is
 * its own write.
 *
 * Only journal saves coalesce, and they must: the editor autosaves as you
 * type, so a paragraph written on a plane would otherwise queue twenty copies
 * of the same row and replay all twenty. Coalescing keeps the last one, which
 * is exactly the last-write-wins policy applied locally before it ever reaches
 * the network.
 *
 * Checkoffs deliberately do NOT coalesce by experience: the first tap and the
 * rating follow-up are two writes with different payloads, and replaying both
 * in order is what makes the rating land.
 */
export function coalesceKey(op: QueuedOp): string | null {
  if (op.kind === "journal.save") {
    return `journal:${op.tripId}:${op.entryDate}`;
  }
  return null;
}

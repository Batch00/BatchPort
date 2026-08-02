"use server";

import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { isDemoBlocked } from "@/lib/demo-guard";
import { requireUser } from "@/lib/current-user";
import { revalidateAppData } from "@/lib/revalidate";
import { createExperience, markExperienceDone } from "@/lib/experiences";
import type { QueuedOp } from "@/lib/offline/queue-types";

// Replay of one queued offline write.
//
// This is a single entry point rather than the client calling the four normal
// actions, for two reasons. First, idempotency: a replay can run against a
// server that already applied the write (the response was lost, not the
// request), so every branch here has to be safe to run twice, and keeping them
// together is what makes that reviewable. Second, the retryable flag: the
// queue has to tell "the network went away again" (keep it, try later) apart
// from "the server will refuse this every time" (park it and show the user),
// and the normal actions have no reason to carry that distinction.
//
// Conflict policy is last write wins, per row. Every branch either upserts on
// a natural key or creates behind a duplicate check, so a replayed write
// overwrites a newer edit rather than merging with it. Single-user app; the
// queue panel says so plainly.

export type ReplayResult =
  | { ok: true }
  /** retryable: worth trying again later (transport, transient database
   * error). Not retryable: the server will give the same answer next time, so
   * the entry is parked as failed and surfaced instead of looping. */
  | { error: string; retryable: boolean };

/** PostgREST reports a missing table (migration not run) as PGRST205/42P01.
 * That is not going to fix itself on a retry. */
function isMissingRelation(code: string | undefined): boolean {
  return code === "PGRST205" || code === "42P01";
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_JOURNAL_BODY = 20000;

export async function replayOfflineOp(op: QueuedOp): Promise<ReplayResult> {
  if (await isDemoBlocked()) {
    return { error: DEMO_READONLY_MESSAGE, retryable: false };
  }

  try {
    const result = await perform(op);
    if ("ok" in result) revalidateAppData();
    return result;
  } catch {
    // An unclassified throw is most often the fetch to Supabase failing, which
    // is exactly the case worth retrying.
    return { error: "Could not save that change.", retryable: true };
  }
}

async function perform(op: QueuedOp): Promise<ReplayResult> {
  switch (op.kind) {
    case "experience.checkoff":
      return replayCheckoff(op);
    case "journal.save":
      return replayJournal(op);
    case "experience.create":
      return replayCreateExperience(op);
    case "bucket.fulfill":
      return replayBucketFulfill(op);
  }
}

// Idempotent by construction: markExperienceDone sets status and only the
// fields the follow-up actually supplied, so running it twice lands the same
// row. A checkoff whose experience has since been deleted is not retryable.
async function replayCheckoff(
  op: Extract<QueuedOp, { kind: "experience.checkoff" }>,
): Promise<ReplayResult> {
  const { supabase } = await requireUser();
  const { data } = await supabase
    .from("experiences")
    .select("id")
    .eq("id", op.experienceId)
    .maybeSingle();
  if (!data) {
    return {
      error: `"${op.experienceName}" no longer exists.`,
      retryable: false,
    };
  }
  await markExperienceDone(op.experienceId, {
    rating: op.rating,
    visited_date: op.visitedDate,
  });
  return { ok: true };
}

// Upsert on (user, trip, day), delete when blank: the same two branches the
// live action takes, so a replayed entry is indistinguishable from one typed
// online.
async function replayJournal(
  op: Extract<QueuedOp, { kind: "journal.save" }>,
): Promise<ReplayResult> {
  if (!ISO_DATE.test(op.entryDate)) {
    return { error: "That is not a valid day.", retryable: false };
  }
  const text = op.body.trim();
  if (text.length > MAX_JOURNAL_BODY) {
    return { error: "That entry is too long to save.", retryable: false };
  }

  const { supabase, user } = await requireUser();

  if (text.length === 0) {
    const { error } = await supabase
      .from("journal_entries")
      .delete()
      .eq("trip_id", op.tripId)
      .eq("entry_date", op.entryDate);
    if (error) return journalFailure(error);
    return { ok: true };
  }

  const { error } = await supabase.from("journal_entries").upsert(
    {
      user_id: user.id,
      trip_id: op.tripId,
      entry_date: op.entryDate,
      body: text,
    },
    { onConflict: "user_id,trip_id,entry_date" },
  );
  if (error) return journalFailure(error);
  return { ok: true };
}

function journalFailure(error: { code?: string }): ReplayResult {
  if (isMissingRelation(error.code)) {
    return {
      error: "Journaling is not set up on this database yet.",
      retryable: false,
    };
  }
  return { error: "Could not save that entry.", retryable: true };
}

/**
 * The one queued write with no natural key, so it gets an explicit duplicate
 * check: same stop, same name (case-insensitively), same visited date. If a
 * matching row is already there, the replay is treated as already applied.
 *
 * This is what makes a lost response safe. The alternative, a client-generated
 * id column, would be a schema change to serve one code path, and the check
 * below costs one indexed lookup on a handful of rows.
 */
async function replayCreateExperience(
  op: Extract<QueuedOp, { kind: "experience.create" }>,
): Promise<ReplayResult> {
  const { supabase } = await requireUser();

  let query = supabase
    .from("experiences")
    .select("id")
    .eq("destination_id", op.destinationId)
    .ilike("name", op.name.trim());
  query = op.visitedDate
    ? query.eq("visited_date", op.visitedDate)
    : query.is("visited_date", null);
  const { data: existing } = await query.limit(1);
  if ((existing ?? []).length > 0) return { ok: true };

  await createExperience(op.destinationId, {
    name: op.name,
    category_id: op.categoryId,
    rating: op.rating,
    visited_date: op.visitedDate,
    notes: op.notes,
    status: op.status,
    lat: op.lat,
    lng: op.lng,
  });
  return { ok: true };
}

// Idempotent: fulfilling an already-fulfilled item just rewrites the same two
// columns. The timestamp moves, which is the documented last-write-wins
// behaviour rather than a bug.
async function replayBucketFulfill(
  op: Extract<QueuedOp, { kind: "bucket.fulfill" }>,
): Promise<ReplayResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("bucket_list")
    .update({
      fulfilled_trip_id: op.tripId,
      fulfilled_at: new Date().toISOString(),
    })
    .eq("id", op.itemId);
  if (error) return { error: "Could not mark the item as completed.", retryable: true };
  return { ok: true };
}

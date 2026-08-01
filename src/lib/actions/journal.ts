"use server";

import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { isDemoBlocked } from "@/lib/demo-guard";
import { requireUser } from "@/lib/current-user";
import { revalidateAppData } from "@/lib/revalidate";
import type { ActionResult } from "@/lib/action-result";

// Journal mutations. One entry per (user, trip, day), so every write is an
// upsert on that key and clearing the text is a delete: a blank body is never
// stored, which keeps "has an entry" a row check everywhere else.
//
// This deliberately does NOT call revalidateAppData on every keystroke-driven
// autosave. The editor is a controlled textarea and an app-wide revalidation
// mid-typing would re-render the trip page underneath the caret. The caller
// passes `final: true` on the save that ends an editing session (blur, or the
// explicit Save), and only that one revalidates.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Long enough for a genuinely full day, short enough that a paste accident
// cannot write a novel into a row the UI renders inline.
const MAX_BODY = 20000;

export async function saveJournalEntryAction(
  tripId: string,
  entryDate: string,
  body: string,
  options: { final?: boolean } = {},
): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  if (!ISO_DATE.test(entryDate)) return { error: "That is not a valid day." };

  const text = body.trim();
  if (text.length > MAX_BODY) {
    return { error: "That entry is too long to save." };
  }

  const { supabase, user } = await requireUser();

  if (text.length === 0) {
    const { error } = await supabase
      .from("journal_entries")
      .delete()
      .eq("trip_id", tripId)
      .eq("entry_date", entryDate);
    if (error) return { error: journalError(error) };
    if (options.final) revalidateAppData();
    return { ok: true };
  }

  const { error } = await supabase.from("journal_entries").upsert(
    {
      user_id: user.id,
      trip_id: tripId,
      entry_date: entryDate,
      body: text,
    },
    { onConflict: "user_id,trip_id,entry_date" },
  );
  if (error) return { error: journalError(error) };
  if (options.final) revalidateAppData();
  return { ok: true };
}

// A missing table means the migration has not run yet. Say so plainly rather
// than reporting a generic failure the user cannot act on. Either way the
// editor keeps the text it is holding, so nothing typed is lost.
function journalError(error: { code?: string }): string {
  if (error.code === "PGRST205" || error.code === "42P01") {
    return "Journaling is not set up on this database yet.";
  }
  return "Could not save that entry. Your text is still here, try again.";
}

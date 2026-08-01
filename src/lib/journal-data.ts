import { createClient } from "@/utils/supabase/server";
import { requireUser } from "@/lib/current-user";
import type { JournalEntry } from "@/lib/journal";

// Server reads for the travel journal.
//
// getJournalEntries takes no userId on purpose, for the same reason search and
// export do not: it reads through requireUser()'s session-scoped client, so
// RLS is the access boundary and no request can name another account. The
// shared read is the deliberate exception and mirrors getProfileTrips: an
// explicit userId through the anon client, gated by is_shared().
//
// Both degrade to an empty list rather than throwing. Until the migration in
// scripts/sql/2026-08-02-journal.sql has run, the table does not exist and
// every surface simply has no journal text, which is the same shape as a trip
// nobody has written about yet.

const COLUMNS = "entry_date, body";

/** Every entry on one trip, oldest first. */
export async function getJournalEntries(
  tripId: string,
): Promise<JournalEntry[]> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("journal_entries")
    .select(COLUMNS)
    .eq("trip_id", tripId)
    .order("entry_date", { ascending: true });
  if (error) return [];
  return (data ?? []) as JournalEntry[];
}

/** Whether the journal table is reachable, so the UI can say "not available
 * yet" once instead of failing on the first save. */
export async function journalAvailable(): Promise<boolean> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("journal_entries")
    .select("entry_date")
    .limit(1);
  return !error;
}

/** Entries across every trip of a shared profile, grouped by trip id. Anon
 * client plus an explicit user filter, gated by is_shared() RLS. */
export async function getSharedJournalByTrip(
  userId: string,
): Promise<Map<string, JournalEntry[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("journal_entries")
    .select("trip_id, entry_date, body")
    .eq("user_id", userId)
    .order("entry_date", { ascending: true });
  const byTrip = new Map<string, JournalEntry[]>();
  if (error || !data) return byTrip;
  const rows = data as unknown as (JournalEntry & { trip_id: string })[];
  for (const row of rows) {
    const list = byTrip.get(row.trip_id) ?? [];
    list.push({ entry_date: row.entry_date, body: row.body });
    byTrip.set(row.trip_id, list);
  }
  return byTrip;
}

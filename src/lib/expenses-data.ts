import { requireUser } from "@/lib/current-user";

// Server reads for expenses.
//
// Like the journal, transport, search, and export reads, nothing here takes a
// userId: it reads through requireUser()'s session-scoped client, so RLS is
// the access boundary and no request can name another account. That matters
// more here than anywhere else in the app, because this is the one table that
// is deliberately NOT readable through is_shared().
//
// Everything degrades to "nothing recorded" rather than throwing. Until
// scripts/sql/2026-08-19-expenses.sql has run the table does not exist, and a
// trip with no expenses is the same shape as a trip nobody has logged spending
// on.

/**
 * How many expenses hang off one trip.
 *
 * This exists before the ledger does, for one reason: deleting a trip cascades
 * to its expenses, and the delete confirmation has to be able to say how many
 * hand-entered transactions are about to go. Losing 160 of those is a
 * different category of mistake from losing a stop, and the dialog should not
 * find out about it after the fact.
 *
 * Returns null when the table is not reachable, which the caller renders as
 * "say nothing" rather than as "zero". Claiming a trip has no expenses on a
 * database that cannot answer would be the exact wrong reassurance to give
 * somebody at a delete confirmation.
 */
export async function getTripExpenseCount(
  tripId: string,
): Promise<number | null> {
  const { supabase } = await requireUser();
  const { count, error } = await supabase
    .from("expenses")
    .select("id", { count: "exact", head: true })
    .eq("trip_id", tripId);
  if (error) return null;
  return count ?? 0;
}

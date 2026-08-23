import { requireUser } from "@/lib/current-user";
import type {
  CategorySpend,
  DaySpend,
  DestinationSpend,
  ExpenseCategory,
  ExpenseRow,
  GroupSpend,
  TripExpenseSummary,
  VendorSuggestion,
} from "@/lib/expenses";

// Server reads for expenses.
//
// Like the journal, transport, search, and export reads, nothing here takes a
// userId: it reads through requireUser()'s session-scoped client, so RLS is
// the access boundary and no request can name another account. That matters
// more here than anywhere else in the app, because this is the one table that
// is deliberately NOT readable through is_shared(). There is no shared-read
// counterpart to getSharedJournalByTrip on purpose; the only anon-reachable
// path is the demo account, gated by is_demo_account() in RLS and by an
// explicit flag on the surface.
//
// Everything degrades to "nothing recorded" rather than throwing. Until
// scripts/sql/2026-08-19-expenses.sql and 2026-08-22-expense-metrics.sql have
// run the tables and views do not exist, and a trip with no expenses is the
// same shape as a trip nobody has logged spending on.
//
// EVERY METRIC COMES FROM A VIEW. Nothing in this file sums money. The one
// exception is the ledger's per-day subtotals, computed in lib/expenses.ts
// over rows already on screen, which is a reading of what is displayed rather
// than a second opinion about a total.

// PostgREST serializes numeric as a string to preserve precision, exactly as
// it does for the stats views. Same defensive coercion, same reason.
function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Whether the expenses tables are reachable, so the trip page can leave the
 * summary card out entirely rather than linking to a route that cannot read,
 * and so the route itself can explain rather than fail.
 */
export async function expensesAvailable(): Promise<boolean> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("expenses").select("id").limit(1);
  return !error;
}

/**
 * How many expenses hang off one trip.
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

const ROW_COLUMNS =
  "id, trip_id, effective_destination_id, destination_name, pinned_destination_id, " +
  "category_id, category_slug, category_label, category_icon, " +
  "group_slug, group_label, group_color, " +
  "vendor, amount_usd, spent_on, is_alcohol, note";

/** Every transaction on one trip, with its stop resolved by the view. */
export async function getTripExpenses(tripId: string): Promise<ExpenseRow[]> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("v_expense_rows")
    .select(ROW_COLUMNS)
    .eq("trip_id", tripId)
    .order("spent_on", { ascending: false, nullsFirst: false });
  if (error || !data) return [];
  // Double assertion: ROW_COLUMNS is a concatenated string rather than a
  // literal, so PostgREST's inference cannot narrow it and falls back to its
  // error shape. The runtime result is the view's columns.
  return (data as unknown as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    tripId: String(row.trip_id),
    destinationId: str(row.effective_destination_id),
    destinationName: str(row.destination_name),
    pinnedDestinationId: str(row.pinned_destination_id),
    categoryId: str(row.category_id),
    categorySlug: str(row.category_slug),
    categoryLabel: str(row.category_label),
    categoryIcon: str(row.category_icon),
    groupSlug: str(row.group_slug),
    groupLabel: str(row.group_label),
    groupColor: str(row.group_color),
    vendor: str(row.vendor),
    amountUsd: num(row.amount_usd),
    spentOn: str(row.spent_on),
    isAlcohol: Boolean(row.is_alcohol),
    note: str(row.note),
  }));
}

export async function getTripExpenseSummary(
  tripId: string,
): Promise<TripExpenseSummary | null> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("v_trip_expense_summary")
    .select(
      "trip_days, total_usd, txn_count, usd_per_day, alcohol_usd, undated_usd, unattributed_usd, uncategorized_count, refund_count",
    )
    .eq("trip_id", tripId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  return {
    tripDays: numOrNull(row.trip_days),
    totalUsd: num(row.total_usd),
    txnCount: num(row.txn_count),
    usdPerDay: numOrNull(row.usd_per_day),
    alcoholUsd: num(row.alcohol_usd),
    undatedUsd: num(row.undated_usd),
    unattributedUsd: num(row.unattributed_usd),
    uncategorizedCount: num(row.uncategorized_count),
    refundCount: num(row.refund_count),
  };
}

/**
 * Spend by group.
 *
 * Returns NULL when the read fails, never an empty array, for the same reason
 * getTripExpenseCount returns null rather than 0: an empty result and a failed
 * result look identical to a caller and mean opposite things. A card that
 * renders "Mostly Uncategorized 100%" off an absent read is asserting a fact
 * about the user's data that the database never said.
 */
export async function getTripExpenseByGroup(
  tripId: string,
): Promise<GroupSpend[] | null> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("v_trip_expense_by_group")
    .select("group_slug, group_label, group_color, total_usd, txn_count, pct_of_trip")
    .eq("trip_id", tripId)
    .order("total_usd", { ascending: false });
  if (error || !data) return null;
  return (data as Record<string, unknown>[]).map((row) => ({
    groupSlug: String(row.group_slug),
    groupLabel: String(row.group_label),
    groupColor: str(row.group_color),
    totalUsd: num(row.total_usd),
    txnCount: num(row.txn_count),
    pctOfTrip: numOrNull(row.pct_of_trip),
  }));
}

/** Null on failure, for the same reason as getTripExpenseByGroup. */
export async function getTripExpenseByCategory(
  tripId: string,
): Promise<CategorySpend[] | null> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("v_trip_expense_by_category")
    .select(
      "group_slug, group_label, group_color, category_slug, category_label, category_icon, total_usd, txn_count, pct_of_trip",
    )
    .eq("trip_id", tripId)
    .order("total_usd", { ascending: false });
  if (error || !data) return null;
  return (data as Record<string, unknown>[]).map((row) => ({
    groupSlug: String(row.group_slug),
    groupLabel: String(row.group_label),
    groupColor: str(row.group_color),
    categorySlug: String(row.category_slug),
    categoryLabel: String(row.category_label),
    categoryIcon: str(row.category_icon),
    totalUsd: num(row.total_usd),
    txnCount: num(row.txn_count),
    pctOfTrip: numOrNull(row.pct_of_trip),
  }));
}

export async function getTripExpenseByDay(tripId: string): Promise<DaySpend[]> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("v_trip_expense_by_day")
    .select("spend_date, total_usd, txn_count, alcohol_usd")
    .eq("trip_id", tripId)
    .order("spend_date", { ascending: true });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((row) => ({
    spendDate: String(row.spend_date).slice(0, 10),
    totalUsd: num(row.total_usd),
    txnCount: num(row.txn_count),
    alcoholUsd: num(row.alcohol_usd),
  }));
}

/**
 * Per-stop cost, including days_owned and the on-ground figure.
 *
 * Ordered by order_index rather than by spend, because a trip's stops are a
 * sequence and the two Londons of a round trip have to read as the beginning
 * and the end rather than as two entries in a leaderboard.
 */
export async function getDestinationExpense(
  tripId: string,
): Promise<DestinationSpend[]> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("v_destination_expense")
    .select(
      "destination_id, destination_name, country_code, order_index, arrival_date, departure_date, days_owned, total_usd, on_ground_usd, alcohol_usd, txn_count, usd_per_day, on_ground_usd_per_day",
    )
    .eq("trip_id", tripId)
    .order("order_index", { ascending: true });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((row) => ({
    destinationId: String(row.destination_id),
    destinationName: String(row.destination_name),
    countryCode: str(row.country_code),
    orderIndex: num(row.order_index),
    arrivalDate: str(row.arrival_date),
    departureDate: str(row.departure_date),
    daysOwned: num(row.days_owned),
    totalUsd: num(row.total_usd),
    onGroundUsd: num(row.on_ground_usd),
    alcoholUsd: num(row.alcohol_usd),
    txnCount: num(row.txn_count),
    usdPerDay: numOrNull(row.usd_per_day),
    onGroundUsdPerDay: numOrNull(row.on_ground_usd_per_day),
  }));
}

/**
 * Past vendors for the entry typeahead, across every trip.
 *
 * Across every trip deliberately: the same supermarket chain and the same
 * airline recur between trips, and a typeahead scoped to the trip in hand
 * would be empty on its first day, which is exactly when fast entry matters
 * most.
 */
export async function getVendorSuggestions(): Promise<VendorSuggestion[]> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("v_expense_vendors")
    .select("vendor_key, vendor_label, uses, last_category_id, distinct_categories")
    .order("uses", { ascending: false })
    .limit(500);
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((row) => ({
    vendorKey: String(row.vendor_key),
    vendorLabel: String(row.vendor_label),
    uses: num(row.uses),
    lastCategoryId: str(row.last_category_id),
    distinctCategories: num(row.distinct_categories),
  }));
}

/**
 * The seeded two-level taxonomy. Global reference data, like categories.
 *
 * Returns NULL when the taxonomy cannot be read, and an EMPTY ARRAY only if it
 * is genuinely empty. The distinction is load-bearing: RLS enabled with no
 * policy returns zero rows and no error, which is how this shipped once with
 * an empty category picker and no error anywhere. A caller seeing null says
 * the picker is unavailable; a caller seeing [] would be saying the taxonomy
 * has nothing in it, which is a different and much stranger claim.
 */
export async function getExpenseCategories(): Promise<ExpenseCategory[] | null> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("expense_categories")
    .select(
      "id, slug, label, icon, sort_order, expense_groups(slug, label, color, sort_order)",
    )
    .order("sort_order", { ascending: true });
  if (error || !data) return [];
  const rows = data as unknown as {
    id: string;
    slug: string;
    label: string;
    icon: string | null;
    sort_order: number;
    expense_groups: {
      slug: string;
      label: string;
      color: string | null;
      sort_order: number;
    } | null;
  }[];
  return rows
    .filter((row) => row.expense_groups !== null)
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      label: row.label,
      icon: row.icon,
      groupSlug: row.expense_groups!.slug,
      groupLabel: row.expense_groups!.label,
      groupColor: row.expense_groups!.color,
      sortOrder: row.sort_order,
    }))
    // Group order first, then position within the group, so the picker reads
    // in the order the taxonomy was designed rather than by category sort_order
    // alone (which restarts at 1 inside every group).
    .sort((a, b) => {
      const groupA = rows.find((r) => r.expense_groups?.slug === a.groupSlug)
        ?.expense_groups?.sort_order ?? 0;
      const groupB = rows.find((r) => r.expense_groups?.slug === b.groupSlug)
        ?.expense_groups?.sort_order ?? 0;
      if (groupA !== groupB) return groupA - groupB;
      return a.sortOrder - b.sortOrder;
    });
}

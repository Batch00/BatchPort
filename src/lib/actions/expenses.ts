"use server";

import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { isDemoBlocked } from "@/lib/demo-guard";
import { requireUser } from "@/lib/current-user";
import { revalidateAppData } from "@/lib/revalidate";
import { isValidDate, normalizeVendor, type ExpenseDraft } from "@/lib/expenses";
import type { ActionResult } from "@/lib/action-result";

// Expense mutations.
//
// THE CREATE DELIBERATELY DOES NOT REVALIDATE, but not for the reason first
// written here. The original comment claimed this kept the page from
// re-rendering under the field mid-pass. It does not: invoking any Server
// Action makes the Next router refetch the current route, so the page updates
// after every commit whatever this function does (verified in a browser, see
// the note in components/expenses/expense-workspace.tsx).
//
// What omitting revalidateAppData actually buys is that a burst of twenty rows
// does not fire twenty revalidatePath("/", "layout") calls, each invalidating
// every route in the app. The client debounces a single one to the end of the
// pass instead. The create still returns the row it wrote so the client can
// show it before the refetch lands.
//
// Update and delete DO revalidate. They are one-off corrections rather than a
// loop, and the trip page's summary card and the delete confirmation's count
// both need to catch up.

const MAX_VENDOR = 120;
const MAX_NOTE = 500;
// numeric(12,2) holds ten digits before the point. A cap well inside that
// turns a slipped keyboard into a refusal rather than a row nobody notices.
const MAX_AMOUNT = 1_000_000;

/** The row a create hands back, in the shape the client list holds. */
export interface CreatedExpense {
  id: string;
  tripId: string;
  destinationId: string | null;
  categoryId: string | null;
  vendor: string | null;
  amountUsd: number;
  spentOn: string | null;
  isAlcohol: boolean;
  note: string | null;
}

export type CreateExpenseResult =
  | { ok: true; expense: CreatedExpense }
  | { error: string };

function validate(draft: ExpenseDraft): string | null {
  if (!Number.isFinite(draft.amountUsd) || draft.amountUsd === 0) {
    return "Enter an amount. Zero is not a transaction.";
  }
  if (Math.abs(draft.amountUsd) > MAX_AMOUNT) {
    return "That amount looks like a typo.";
  }
  if (!isValidDate(draft.spentOn)) return "That is not a valid date.";
  if ((draft.vendor?.length ?? 0) > MAX_VENDOR) {
    return "That vendor name is too long.";
  }
  if ((draft.note?.length ?? 0) > MAX_NOTE) return "That note is too long.";
  return null;
}

/**
 * Create one expense.
 *
 * `id` may be supplied by the caller. That is what lets the offline queue
 * replay a create idempotently by primary key, which matters here more than
 * anywhere else: two 4.50 coffees at the same cafe on the same day are two
 * real transactions, so a server-side duplicate check would reject real data.
 */
export async function createExpenseAction(
  tripId: string,
  draft: ExpenseDraft,
  id?: string,
): Promise<CreateExpenseResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const invalid = validate(draft);
  if (invalid) return { error: invalid };

  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("expenses")
    .insert({
      ...(id ? { id } : {}),
      user_id: user.id,
      trip_id: tripId,
      // Null means "derive it": the boundary rule in v_expense_rows answers
      // which stop this belongs to. A value here is the traveller overruling
      // that, which the entry row only sends when they actually picked a stop.
      destination_id: draft.destinationId,
      category_id: draft.categoryId,
      vendor: draft.vendor ? normalizeVendor(draft.vendor) : null,
      amount_usd: draft.amountUsd,
      spent_on: draft.spentOn,
      is_alcohol: draft.isAlcohol,
      note: draft.note,
    })
    .select("id, trip_id, destination_id, category_id, vendor, amount_usd, spent_on, is_alcohol, note")
    .single();

  if (error || !data) return { error: expenseError(error) };
  const row = data as Record<string, unknown>;
  return {
    ok: true,
    expense: {
      id: String(row.id),
      tripId: String(row.trip_id),
      destinationId: (row.destination_id as string | null) ?? null,
      categoryId: (row.category_id as string | null) ?? null,
      vendor: (row.vendor as string | null) ?? null,
      amountUsd: Number(row.amount_usd),
      spentOn: (row.spent_on as string | null) ?? null,
      isAlcohol: Boolean(row.is_alcohol),
      note: (row.note as string | null) ?? null,
    },
  };
}

export async function updateExpenseAction(
  expenseId: string,
  draft: ExpenseDraft,
): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const invalid = validate(draft);
  if (invalid) return { error: invalid };

  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("expenses")
    .update({
      destination_id: draft.destinationId,
      category_id: draft.categoryId,
      vendor: draft.vendor ? normalizeVendor(draft.vendor) : null,
      amount_usd: draft.amountUsd,
      spent_on: draft.spentOn,
      is_alcohol: draft.isAlcohol,
      note: draft.note,
    })
    .eq("id", expenseId);
  if (error) return { error: expenseError(error) };
  revalidateAppData();
  return { ok: true };
}

export async function deleteExpenseAction(
  expenseId: string,
): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const { supabase } = await requireUser();
  const { error } = await supabase.from("expenses").delete().eq("id", expenseId);
  if (error) return { error: expenseError(error) };
  revalidateAppData();
  return { ok: true };
}

/** Called once when the entry surface is done, since the creates deliberately
 * do not revalidate one by one. */
export async function refreshExpensesAction(): Promise<void> {
  revalidateAppData();
}

// A missing table means the migration has not run. Say so plainly rather than
// reporting a generic failure, matching the journal and curation actions.
function expenseError(error: { code?: string } | null): string {
  if (!error) return "Could not save that expense.";
  if (error.code === "PGRST205" || error.code === "42P01") {
    return "Expenses are not set up on this database yet.";
  }
  if (error.code === "23514") {
    return "Zero is not a transaction.";
  }
  return "Could not save that expense. Nothing was changed, try again.";
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckIcon,
  Loader2Icon,
  MapPinIcon,
  PencilIcon,
  PinIcon,
  Trash2Icon,
  WineIcon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createExpenseAction,
  deleteExpenseAction,
  refreshExpensesAction,
  updateExpenseAction,
} from "@/lib/actions/expenses";
import {
  formatUsd,
  frequentCategoryIds,
  ledgerDays,
  normalizeVendor,
  parseAmount,
  type ExpenseCategory,
  type ExpenseDraft,
  type ExpenseRow,
  type VendorSuggestion,
} from "@/lib/expenses";
import { formatDate } from "@/lib/format";
import { useConnectionGuard } from "@/lib/offline/use-offline";
import { CategoryPicker, GroupDot } from "@/components/expenses/category-picker";
import {
  ExpenseEntry,
  type EntryDestination,
} from "@/components/expenses/expense-entry";
import { cn } from "@/lib/utils";

// Entry plus ledger, sharing one list.
//
// WHAT THE DEBOUNCE IS ACTUALLY FOR, corrected after measuring it in a browser.
//
// The original claim here was that the totals above the ledger would not move
// until the pass was over, because createExpenseAction does not call
// revalidateAppData. That was WRONG about Next.js: invoking a Server Action
// makes the router refetch the CURRENT route's RSC payload regardless of any
// revalidatePath call, so the summary updates about a second after every
// commit. Measured: the first row moved the total from $2,957 to $2,958.11
// inside 900ms, and the new ledger row already carried the server-derived stop
// ("Copenhagen"), which the optimistic row below never sets.
//
// That is good behaviour and is left alone. Two things still earn their keep:
//
//   1. The OPTIMISTIC MERGE covers the gap before that refetch lands, so a row
//      appears on keypress rather than a second later.
//   2. The DEBOUNCED refreshExpensesAction is what invalidates OTHER routes.
//      Next's automatic refetch only covers the route you are on; the trip
//      page's summary card and its delete-confirmation count live on a
//      different route whose RSC payload sits in the router cache. So a burst
//      of twenty rows pays for ONE revalidatePath("/", "layout") at the end
//      rather than twenty, which is the journal's `final` flag generalized
//      from "stopped typing" to "stopped logging".
//
// Focus is unaffected by the per-commit refetch: React reconciles rather than
// remounting, so the caret stays in the amount field. Measured across a
// six-row burst, the amount input recorded zero blur events.
//
// Locally created rows are held separately from the server's and merged by id,
// which makes the merge self-healing: when the refresh lands, a pending row is
// already in props and drops out of the pending list on its own. There is no
// reset step to get wrong, and a failed refresh degrades to a slightly stale
// total rather than a duplicated row.
//
// EDITING IS INLINE rather than a dialog. A correction is usually one field
// (the amount was 12 not 21, the category was wrong), and a modal to change
// one number is more ceremony than the change deserves. It also keeps the row
// in place, so the day's other rows stay visible as context while you fix one.

const REFRESH_QUIET_MS = 2500;

export function ExpenseWorkspace({
  tripId,
  rows,
  categories,
  vendors,
  destinations,
  defaultDate,
  disabled,
  disabledReason,
}: {
  tripId: string;
  rows: ExpenseRow[];
  /** Null when the taxonomy could not be read. */
  categories: ExpenseCategory[] | null;
  vendors: VendorSuggestion[];
  destinations: EntryDestination[];
  defaultDate: string;
  disabled?: boolean;
  disabledReason?: string | null;
}) {
  const router = useRouter();
  const blockedOffline = useConnectionGuard();
  const [pending, setPending] = useState<ExpenseRow[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [sessionTotal, setSessionTotal] = useState(0);
  const refreshTimer = useRef<number | null>(null);

  const categoryById = useMemo(
    () => new Map((categories ?? []).map((category) => [category.id, category])),
    [categories],
  );
  const destinationById = useMemo(
    () => new Map(destinations.map((destination) => [destination.id, destination])),
    [destinations],
  );

  // Server rows win; a pending row survives only until the same id arrives.
  const display = useMemo(() => {
    const serverIds = new Set(rows.map((row) => row.id));
    const merged = [
      ...rows,
      ...pending.filter((row) => !serverIds.has(row.id)),
    ];
    return merged.filter((row) => !removed.has(row.id));
  }, [rows, pending, removed]);

  // Pending rows are pruned on COMMIT rather than in an effect keyed on
  // `rows`. Growth only happens on commit, so that is where bounding it
  // belongs, and it keeps the merge a pure derivation: an effect that wrote
  // state back on every server render would be a second source of truth for a
  // list the memo above already resolves.

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) {
      window.clearTimeout(refreshTimer.current);
    }
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      refreshExpensesAction().then(() => router.refresh());
    }, REFRESH_QUIET_MS);
  }, [router]);

  // A pass that ends by navigating away should still land its refresh.
  useEffect(() => {
    return () => {
      if (refreshTimer.current !== null) {
        window.clearTimeout(refreshTimer.current);
        refreshExpensesAction();
      }
    };
  }, []);

  const days = useMemo(() => ledgerDays(display), [display]);
  const frequentIds = useMemo(() => frequentCategoryIds(display), [display]);

  async function commit(draft: ExpenseDraft): Promise<string | null> {
    if (blockedOffline("Adding an expense")) {
      return "You are offline. This one is not queued yet.";
    }
    const result = await createExpenseAction(tripId, draft);
    if ("error" in result) return result.error;

    const category = draft.categoryId
      ? categoryById.get(draft.categoryId) ?? null
      : null;
    const destination = draft.destinationId
      ? destinationById.get(draft.destinationId) ?? null
      : null;

    const serverIds = new Set(rows.map((row) => row.id));
    // Optimistic shape. destinationId is only known locally when the traveller
    // PINNED one; a derived attribution is the view's answer and arrives with
    // the refresh, so the row reads "no stop yet" for a couple of seconds
    // rather than claiming an attribution this component guessed at.
    setPending((current) => [
      // Drop anything the last refresh already brought back from the server.
      ...current.filter((row) => !serverIds.has(row.id)),
      {
        id: result.expense.id,
        tripId,
        destinationId: destination?.id ?? null,
        destinationName: destination?.name ?? null,
        pinnedDestinationId: destination?.id ?? null,
        categoryId: category?.id ?? null,
        categorySlug: category?.slug ?? null,
        categoryLabel: category?.label ?? null,
        categoryIcon: category?.icon ?? null,
        groupSlug: category?.groupSlug ?? null,
        groupLabel: category?.groupLabel ?? null,
        groupColor: category?.groupColor ?? null,
        vendor: draft.vendor ? normalizeVendor(draft.vendor) : null,
        amountUsd: draft.amountUsd,
        spentOn: draft.spentOn,
        isAlcohol: draft.isAlcohol,
        note: draft.note,
      },
    ]);
    setSessionCount((count) => count + 1);
    setSessionTotal((total) => total + draft.amountUsd);
    scheduleRefresh();
    return null;
  }

  async function save(row: ExpenseRow, draft: ExpenseDraft): Promise<string | null> {
    if (blockedOffline("Editing an expense")) {
      return "You are offline. Editing is not queued.";
    }
    const result = await updateExpenseAction(row.id, draft);
    if ("error" in result) return result.error;
    setEditingId(null);
    // An edit is a one-off correction rather than a loop, so it revalidates
    // immediately (the action already did) and the row comes back from the
    // server rather than being patched locally.
    router.refresh();
    return null;
  }

  async function remove(row: ExpenseRow) {
    if (blockedOffline("Deleting an expense")) return;
    setRemoved((current) => new Set(current).add(row.id));
    const result = await deleteExpenseAction(row.id);
    if ("error" in result) {
      setRemoved((current) => {
        const next = new Set(current);
        next.delete(row.id);
        return next;
      });
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <ExpenseEntry
        categories={categories}
        frequentIds={frequentIds}
        vendors={vendors}
        destinations={destinations}
        defaultDate={defaultDate}
        disabled={disabled}
        disabledReason={disabledReason}
        onCommit={commit}
      />

      {sessionCount > 0 ? (
        <p className="text-xs text-foreground/50">
          {sessionCount} added this session, {formatUsd(sessionTotal)}.
        </p>
      ) : null}

      {days.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 px-6 py-12 text-center text-sm text-foreground/60">
          Nothing logged on this trip yet.
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {days.map((day) => (
            <div key={day.date ?? "undated"}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3 border-b border-white/5 pb-1">
                <h3 className="text-sm font-medium text-foreground/80">
                  {day.date ? formatDate(day.date) : "No date"}
                </h3>
                <span className="text-sm tabular-nums text-foreground/60">
                  {formatUsd(day.totalUsd)}
                </span>
              </div>
              <ul className="flex flex-col">
                {day.rows.map((row) =>
                  editingId === row.id ? (
                    <EditRow
                      key={row.id}
                      row={row}
                      categories={categories}
                      frequentIds={frequentIds}
                      destinations={destinations}
                      onCancel={() => setEditingId(null)}
                      onSave={(draft) => save(row, draft)}
                    />
                  ) : (
                    <LedgerRow
                      key={row.id}
                      row={row}
                      onEdit={disabled ? null : () => setEditingId(row.id)}
                      onDelete={disabled ? null : () => remove(row)}
                    />
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LedgerRow({
  row,
  onEdit,
  onDelete,
}: {
  row: ExpenseRow;
  onEdit: (() => void) | null;
  onDelete: (() => void) | null;
}) {
  const refund = row.amountUsd < 0;
  return (
    <li className="group flex items-center gap-3 py-1.5">
      <GroupDot color={row.groupColor} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">
          {row.vendor ?? <span className="text-foreground/40">No vendor</span>}
          {row.isAlcohol ? (
            <WineIcon
              className="ml-1.5 inline size-3 text-brand"
              aria-label="Alcohol"
            />
          ) : null}
        </p>
        <p className="flex items-center gap-1.5 truncate text-xs text-foreground/45">
          <span>
            {row.categoryLabel ?? (
              <span className="text-amber-400/70">Uncategorized</span>
            )}
          </span>
          {row.destinationName ? (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-0.5">
                {row.pinnedDestinationId ? (
                  <PinIcon className="size-3" aria-label="Pinned to this stop" />
                ) : (
                  <MapPinIcon className="size-3" />
                )}
                {row.destinationName}
              </span>
            </>
          ) : null}
          {row.note ? (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{row.note}</span>
            </>
          ) : null}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 text-sm tabular-nums",
          refund ? "text-emerald-400" : "text-foreground/80",
        )}
      >
        {formatUsd(row.amountUsd)}
      </span>
      {/* Both controls are always in the DOM and revealed on hover or focus,
          never conditionally rendered: a control that appears only on hover is
          unreachable by keyboard and invisible on a touch screen, so they stay
          focusable and become fully opaque when focused. */}
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${row.vendor ?? "expense"}`}
          className="shrink-0 rounded-md p-1 text-foreground/30 opacity-60 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 sm:opacity-0"
        >
          <PencilIcon className="size-3.5" />
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${row.vendor ?? "expense"}`}
          className="shrink-0 rounded-md p-1 text-foreground/30 opacity-60 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 sm:opacity-0"
        >
          <Trash2Icon className="size-3.5" />
        </button>
      ) : null}
    </li>
  );
}

/** Inline editor for one row. Same fields the entry row offers, seeded from
 * the transaction, so there is one mental model for both. */
function EditRow({
  row,
  categories,
  frequentIds,
  destinations,
  onCancel,
  onSave,
}: {
  row: ExpenseRow;
  categories: ExpenseCategory[] | null;
  frequentIds: string[];
  destinations: EntryDestination[];
  onCancel: () => void;
  onSave: (draft: ExpenseDraft) => Promise<string | null>;
}) {
  const [amount, setAmount] = useState(String(row.amountUsd));
  const [vendor, setVendor] = useState(row.vendor ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(row.categoryId);
  const [date, setDate] = useState(row.spentOn ?? "");
  const [isAlcohol, setIsAlcohol] = useState(row.isAlcohol);
  // Only a PIN is seeded here. row.destinationId may be the derived answer,
  // and seeding that would turn every edit into an override of a rule that was
  // getting it right.
  const [destinationId, setDestinationId] = useState<string | null>(
    row.pinnedDestinationId,
  );
  const [note, setNote] = useState(row.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const parsed = parseAmount(amount);
    if (parsed === null) {
      setError("Enter an amount. Zero is not a transaction.");
      return;
    }
    setSaving(true);
    setError(null);
    const message = await onSave({
      amountUsd: parsed,
      vendor: vendor.trim() === "" ? null : vendor,
      categoryId,
      spentOn: date === "" ? null : date,
      destinationId,
      isAlcohol,
      note: note.trim() === "" ? null : note.trim(),
    });
    setSaving(false);
    if (message) setError(message);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <li className="my-1 rounded-lg border border-brand/30 bg-brand/[0.04] p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-24 shrink-0">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            $
          </span>
          <Input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            onKeyDown={onKeyDown}
            inputMode="decimal"
            aria-label="Amount in US dollars"
            autoFocus
            className="h-9 pl-6 text-sm tabular-nums"
          />
        </div>
        <Input
          value={vendor}
          onChange={(event) => setVendor(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Vendor"
          aria-label="Vendor"
          className="h-9 min-w-40 flex-1 text-sm"
        />
        <div className="min-w-40 flex-1">
          {categories === null ? (
            <div className="flex h-9 items-center rounded-lg border border-dashed border-white/15 px-2.5 text-sm text-foreground/40">
              Categories unavailable
            </div>
          ) : (
            <CategoryPicker
              categories={categories}
              frequentIds={frequentIds}
              value={categoryId}
              onChange={setCategoryId}
            />
          )}
        </div>
        <Input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Date"
          className="h-9 w-36 shrink-0 text-sm"
        />
        <button
          type="button"
          onClick={() => setIsAlcohol((current) => !current)}
          aria-pressed={isAlcohol}
          title="Counts toward the drinking total, whatever the category"
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg border transition-colors",
            isAlcohol
              ? "border-brand/40 bg-brand/15 text-brand"
              : "border-input text-foreground/50 hover:bg-white/5",
          )}
        >
          <WineIcon className="size-4" />
          <span className="sr-only">Alcohol</span>
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Note"
          aria-label="Note"
          className="h-9 min-w-40 flex-1 text-sm"
        />
        <select
          value={destinationId ?? ""}
          onChange={(event) => setDestinationId(event.target.value || null)}
          aria-label="Pin to a stop"
          className="h-9 shrink-0 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground"
        >
          <option value="">Stop from the date</option>
          {destinations.map((destination) => (
            <option key={destination.id} value={destination.id}>
              Pin to {destination.name}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          onClick={submit}
          disabled={saving}
          className="h-9 shrink-0 bg-brand text-brand-foreground hover:bg-brand/90"
        >
          {saving ? <Loader2Icon className="size-4 animate-spin" /> : <CheckIcon />}
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onCancel}
          disabled={saving}
          className="h-9 shrink-0"
        >
          <XIcon />
          Cancel
        </Button>
      </div>

      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </li>
  );
}

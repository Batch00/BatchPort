"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronDownIcon, Loader2Icon, PlusIcon, WineIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CategoryPicker } from "@/components/expenses/category-picker";
import {
  matchVendors,
  parseAmount,
  prefillCategoryId,
  type ExpenseCategory,
  type ExpenseDraft,
  type VendorSuggestion,
} from "@/lib/expenses";
import { cn } from "@/lib/utils";

// The fast entry row.
//
// The design target is a day's spending logged from a phone in a hostel, so
// the shape of this is set by one number: how many interactions a transaction
// costs. Amount, vendor, Enter is a complete write, because category_id and
// spent_on are both nullable and the date defaults.
//
//   - AMOUNT IS AUTOFOCUSED and Enter commits from any field.
//   - After a commit the form keeps the DATE and clears everything else, then
//     returns focus to amount. A day is logged in one pass, and the date is
//     the one field that is the same for every row in that pass.
//   - The stop, the note, and the alcohol flag live behind "More", except the
//     alcohol toggle which is on the main row because it is one tap and it is
//     the cross-cut this ledger is actually analyzed on.
//
// The stop selector is deliberately NOT prefilled with the derived answer. A
// value in destination_id means the traveller overruled the boundary rule, and
// showing the derived stop in the field would make every row an override. The
// field says what the rule will do and offers to override it, which is a
// different sentence.

export interface EntryDestination {
  id: string;
  name: string;
  arrivalDate: string | null;
  departureDate: string | null;
}

export function ExpenseEntry({
  categories,
  frequentIds,
  vendors,
  destinations,
  defaultDate,
  disabled,
  disabledReason,
  onCommit,
}: {
  /** Null when the taxonomy could not be read. Entry still works, because
   * category_id is nullable by design; the picker says so rather than
   * presenting an empty list as though nothing existed. */
  categories: ExpenseCategory[] | null;
  frequentIds: string[];
  vendors: VendorSuggestion[];
  destinations: EntryDestination[];
  /** Today when the trip is ongoing, else the trip's last day. */
  defaultDate: string;
  disabled?: boolean;
  disabledReason?: string | null;
  /** Returns an error message, or null on success. */
  onCommit: (draft: ExpenseDraft) => Promise<string | null>;
}) {
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [date, setDate] = useState(defaultDate);
  const [isAlcohol, setIsAlcohol] = useState(false);
  const [destinationId, setDestinationId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vendorOpen, setVendorOpen] = useState(false);

  const amountRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(
    () => matchVendors(vendors, vendor),
    [vendors, vendor],
  );

  // No effect syncs `date` back to `defaultDate`. useState seeds it once, and
  // after that the field belongs to the user: the date is the one thing that
  // deliberately survives a commit so a whole day can be logged in one pass,
  // and clearing it is how an undated row (a prepaid booking) gets entered.
  // Re-applying the default would undo both.

  async function commit() {
    if (disabled || saving) return;
    const parsed = parseAmount(amount);
    if (parsed === null) {
      setError("Enter an amount. Zero is not a transaction.");
      amountRef.current?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    const message = await onCommit({
      amountUsd: parsed,
      vendor: vendor.trim() === "" ? null : vendor,
      categoryId,
      spentOn: date === "" ? null : date,
      destinationId,
      isAlcohol,
      note: note.trim() === "" ? null : note.trim(),
    });
    setSaving(false);
    if (message) {
      setError(message);
      return;
    }
    // Keep the date, drop everything else, go again.
    setAmount("");
    setVendor("");
    setCategoryId(null);
    setIsAlcohol(false);
    setDestinationId(null);
    setNote("");
    setVendorOpen(false);
    amountRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      commit();
    }
  }

  function chooseVendor(suggestion: VendorSuggestion) {
    setVendor(suggestion.vendorLabel);
    setVendorOpen(false);
    // The prefill contract: on SELECTION only, never over a category the user
    // already chose, and nothing at all from a vendor that has been filed more
    // than one way (the Fram Museum is an admission and a cafe lunch).
    if (categoryId === null) {
      const prefill = prefillCategoryId(suggestion);
      if (prefill) setCategoryId(prefill);
    }
  }

  if (disabled) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-foreground/60">
        {disabledReason ?? "Adding expenses is not available here."}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-24 shrink-0">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            $
          </span>
          <Input
            ref={amountRef}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            onKeyDown={onKeyDown}
            inputMode="decimal"
            placeholder="0"
            aria-label="Amount in US dollars"
            autoFocus
            className="h-9 pl-6 text-sm tabular-nums"
          />
        </div>

        <div className="relative min-w-40 flex-1">
          <Input
            value={vendor}
            onChange={(event) => {
              setVendor(event.target.value);
              setVendorOpen(true);
            }}
            onKeyDown={onKeyDown}
            onBlur={() => window.setTimeout(() => setVendorOpen(false), 120)}
            placeholder="Vendor"
            aria-label="Vendor"
            className="h-9 text-sm"
          />
          {vendorOpen && suggestions.length > 0 ? (
            <ul className="absolute left-0 top-full z-30 mt-1 w-full overflow-hidden rounded-lg bg-popover p-1 shadow-md ring-1 ring-foreground/10">
              {suggestions.map((suggestion) => (
                <li key={suggestion.vendorKey}>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => chooseVendor(suggestion)}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                  >
                    <span className="truncate">{suggestion.vendorLabel}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {suggestion.uses}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="min-w-40 flex-1">
          {categories === null ? (
            <div
              className="flex h-9 items-center rounded-lg border border-dashed border-white/15 px-2.5 text-sm text-foreground/40"
              title="The category list could not be loaded. Amounts still save."
            >
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

        <Button
          type="button"
          size="sm"
          onClick={commit}
          disabled={saving}
          className="h-9 shrink-0 bg-brand text-brand-foreground hover:bg-brand/90"
        >
          {saving ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <>
              <PlusIcon />
              Add
            </>
          )}
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => setShowMore((current) => !current)}
          className="inline-flex items-center gap-1 text-xs text-foreground/50 transition-colors hover:text-foreground"
        >
          <ChevronDownIcon
            className={cn("size-3.5 transition-transform", showMore && "rotate-180")}
          />
          {showMore ? "Less" : "Note, stop"}
        </button>
        {error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : (
          <p className="text-xs text-foreground/40">
            Enter saves and starts the next one. The date stays.
          </p>
        )}
      </div>

      {showMore ? (
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
            {/* The default is not "no stop", it is "let the date decide", which
                is what the boundary rule already does for every other row. */}
            <option value="">Stop from the date</option>
            {destinations.map((destination) => (
              <option key={destination.id} value={destination.id}>
                Pin to {destination.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}

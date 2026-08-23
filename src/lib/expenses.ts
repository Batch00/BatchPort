// Expense shapes and the pure logic over them. Client-safe: no Supabase, no
// server imports, so the entry row and the ledger can both use it.
//
// Every metric comes from a SQL view (see scripts/sql/2026-08-19-expenses.sql
// and 2026-08-22-expense-metrics.sql). Nothing here aggregates money except
// the ledger's own per-day subtotals, which are a reading of rows already on
// screen rather than a second opinion about a total.

/** One transaction, as v_expense_rows returns it. */
export interface ExpenseRow {
  id: string;
  tripId: string;
  /** The stop this landed on: the pin if there is one, else the boundary rule
   * (see lib/stays.ts). Null means no stay owns it, which is a real answer and
   * not a gap: a flight the day before the trip belongs to the trip. */
  destinationId: string | null;
  destinationName: string | null;
  /** Set when the traveller overruled the derived answer, so the row can say
   * it was pinned rather than resolved. */
  pinnedDestinationId: string | null;
  categoryId: string | null;
  categorySlug: string | null;
  categoryLabel: string | null;
  categoryIcon: string | null;
  groupSlug: string | null;
  groupLabel: string | null;
  groupColor: string | null;
  vendor: string | null;
  amountUsd: number;
  spentOn: string | null;
  isAlcohol: boolean;
  note: string | null;
}

export interface TripExpenseSummary {
  tripDays: number | null;
  totalUsd: number;
  txnCount: number;
  usdPerDay: number | null;
  alcoholUsd: number;
  undatedUsd: number;
  unattributedUsd: number;
  uncategorizedCount: number;
  refundCount: number;
}

export interface GroupSpend {
  groupSlug: string;
  groupLabel: string;
  groupColor: string | null;
  totalUsd: number;
  txnCount: number;
  pctOfTrip: number | null;
}

export interface CategorySpend extends GroupSpend {
  categorySlug: string;
  categoryLabel: string;
  categoryIcon: string | null;
}

export interface DaySpend {
  spendDate: string;
  /** The net. Reconciles against the trip total; NOT what the chart draws. */
  totalUsd: number;
  /** Positive rows only. */
  spendUsd: number;
  /** Negative rows only, so this is <= 0. */
  refundUsd: number;
  txnCount: number;
  alcoholUsd: number;
}

export interface DestinationSpend {
  destinationId: string;
  destinationName: string;
  countryCode: string | null;
  orderIndex: number;
  arrivalDate: string | null;
  departureDate: string | null;
  daysOwned: number;
  totalUsd: number;
  onGroundUsd: number;
  alcoholUsd: number;
  txnCount: number;
  usdPerDay: number | null;
  onGroundUsdPerDay: number | null;
}

/** A past vendor, for the entry row's typeahead. */
export interface VendorSuggestion {
  vendorKey: string;
  vendorLabel: string;
  uses: number;
  lastCategoryId: string | null;
  /** How many different categories this vendor has been filed under. Above 1,
   * the prefill must not present itself as settled: the Fram Museum is a
   * museum admission and a museum cafe lunch, and Fauno is a bar and a
   * restaurant. See the header of v_expense_vendors. */
  distinctCategories: number;
}

/** The two-level taxonomy, for the picker. */
export interface ExpenseCategory {
  id: string;
  slug: string;
  label: string;
  icon: string | null;
  groupSlug: string;
  groupLabel: string;
  groupColor: string | null;
  sortOrder: number;
}

// --- Money ------------------------------------------------------------------

/**
 * Amounts are whole dollars far more often than not (the entire imported
 * ledger is), so trailing ".00" on every row is noise that makes the column
 * harder to scan. Cents appear when there are cents.
 */
export function formatUsd(amount: number): string {
  const abs = Math.abs(amount);
  const whole = Math.round(abs * 100) % 100 === 0;
  const body = abs.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${amount < 0 ? "-" : ""}$${body}`;
}

/** Per-day figures, which are the ones being compared between cities, always
 * carry the unit so a bare number can never be read as a total. */
export function formatPerDay(amount: number | null): string {
  return amount === null ? "-" : `${formatUsd(amount)}/day`;
}

// --- The ledger -------------------------------------------------------------

export interface LedgerDay {
  /** YYYY-MM-DD, or null for the undated group. */
  date: string | null;
  rows: ExpenseRow[];
  totalUsd: number;
}

/**
 * Rows grouped into the days the ledger renders.
 *
 * NEWEST FIRST, and undated last. The entry row sits at the top of this page
 * and the loop it serves is "log today's spending", so the day just written to
 * should appear directly under the field rather than after a scroll. That is
 * the opposite of the story and the journal, which read a trip forwards,
 * and deliberately so: those are for reading, this is for writing.
 *
 * Undated rows go to the end rather than the start because they are almost
 * always prepaid bookings, which is background rather than the thing being
 * worked on.
 */
export function ledgerDays(rows: ExpenseRow[]): LedgerDay[] {
  const byDate = new Map<string | null, ExpenseRow[]>();
  for (const row of rows) {
    const key = row.spentOn ?? null;
    byDate.set(key, [...(byDate.get(key) ?? []), row]);
  }

  const days: LedgerDay[] = [];
  for (const [date, dayRows] of byDate) {
    days.push({
      date,
      rows: [...dayRows].sort(sortWithinDay),
      totalUsd: dayRows.reduce((sum, row) => sum + row.amountUsd, 0),
    });
  }

  days.sort((a, b) => {
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  });
  return days;
}

/** Largest first inside a day, so the thing that actually cost money leads.
 * Ties fall back to vendor so the order is stable across renders. */
function sortWithinDay(a: ExpenseRow, b: ExpenseRow): number {
  if (a.amountUsd !== b.amountUsd) return b.amountUsd - a.amountUsd;
  return (a.vendor ?? "").localeCompare(b.vendor ?? "");
}

// --- The unattributed set ---------------------------------------------------

/**
 * Rows that landed on no stop.
 *
 * These need saying out loud, because the per-stop table cannot show them and
 * its total will therefore be less than the trip's. On the Post Grad Trip that
 * gap is 16.00, which reads like a rounding scrap and is nothing of the sort:
 * it is a 689 flight against a -700 refund and a 382 rail pass against a -355,
 * four rows moving real money that happen to very nearly cancel.
 *
 * SO A BARE NET IS NEVER PRINTED. Where the set is small it is listed, because
 * 689 sitting next to -700 explains itself and no summary statistic does.
 * Where it is too long to list, the count and the REFUND COUNT carry the same
 * signal: "9 rows, 4 of them refunds, netting 16.00" cannot be misread as a
 * trivial amount the way "16.00" can.
 */
export const UNATTRIBUTED_INLINE_CAP = 6;

export interface UnattributedSummary {
  rows: ExpenseRow[];
  count: number;
  refundCount: number;
  netUsd: number;
  /** True when the whole set is short enough to print row by row. */
  listable: boolean;
}

export function summarizeUnattributed(rows: ExpenseRow[]): UnattributedSummary | null {
  const orphans = rows.filter((row) => row.destinationId === null);
  if (orphans.length === 0) return null;
  return {
    rows: orphans.sort(sortWithinDay),
    count: orphans.length,
    refundCount: orphans.filter((row) => row.amountUsd < 0).length,
    netUsd: orphans.reduce((sum, row) => sum + row.amountUsd, 0),
    listable: orphans.length <= UNATTRIBUTED_INLINE_CAP,
  };
}

/**
 * The one-line summary of the set.
 *
 * Always carries the count, and carries the refund count whenever there is
 * one, because that is what explains a net far smaller than the rows behind
 * it.
 *
 * "NETTING X" IS DROPPED WHEN IT WOULD SAY NOTHING. It was written for the
 * four-row case with two refunds, where the net is the surprising part; on a
 * single listed row with no refund it is worse than redundant, because
 * "1 row, netting $312" invites the reader to look for the arithmetic that
 * produced $312 when there is none. It is kept whenever a refund is involved
 * (the net genuinely differs from the sum of the magnitudes) or the rows are
 * not listed (there is nothing on screen to add up).
 *
 * Returns null when the count alone says everything, so the caller can leave
 * the clause off rather than print a sentence with a stub on the end.
 */
export function unattributedLine(summary: UnattributedSummary): string | null {
  // A single listed row needs no summary at all. It is on screen directly
  // below, with its own amount and its own sign, so every clause here would
  // restate it, and the refund phrasing ("1 of them a refund") is not even
  // grammatical about one row.
  if (summary.count === 1 && summary.listable) return null;

  const informative = summary.refundCount > 0 || !summary.listable;
  const rows = `${summary.count} ${summary.count === 1 ? "row" : "rows"}`;
  const refunds =
    summary.refundCount > 0
      ? `, ${summary.refundCount} of them ${summary.refundCount === 1 ? "a refund" : "refunds"}`
      : "";
  const net = informative ? `, netting ${formatUsd(summary.netUsd)}` : "";
  return `${rows}${refunds}${net}`;
}

/** "it is" or "these are", so a single unattributed row does not get a
 * sentence written for a group. */
export function unattributedSubject(summary: UnattributedSummary): string {
  return summary.count === 1 ? "it is" : "these are";
}

// --- Biggest movements ------------------------------------------------------

/**
 * The largest movements on a trip, RANKED BY SIZE REGARDLESS OF DIRECTION.
 *
 * Not "biggest expenses", and the difference is the whole point. On the Post
 * Grad Trip the four largest rows are a 689 flight against a -700 refund and a
 * 382 rail pass against a -355; a list of the biggest *charges* shows 689 and
 * 382 and silently drops the two rows that cancel them, which is telling half
 * a fact about the most expensive things on the trip.
 *
 * Ranking on the absolute value puts each pair adjacent (700 then 689, 382
 * then 355) without the list having to guess which refund offsets which
 * charge, which is an inference the data does not support: nothing links a
 * refund row to the charge it reverses beyond the vendor name and the reader's
 * judgement. Showing them next to each other lets the reader make that call.
 */
export function biggestMovements(rows: ExpenseRow[], limit = 8): ExpenseRow[] {
  return [...rows]
    .sort((a, b) => {
      const size = Math.abs(b.amountUsd) - Math.abs(a.amountUsd);
      if (size !== 0) return size;
      return (a.vendor ?? "").localeCompare(b.vendor ?? "");
    })
    .slice(0, limit);
}

/** Every refund on the trip, largest first. Carried separately so a trip with
 * refunds can state how many there are even when none is large enough to
 * reach the movements list. */
export function refunds(rows: ExpenseRow[]): ExpenseRow[] {
  return rows
    .filter((row) => row.amountUsd < 0)
    .sort((a, b) => a.amountUsd - b.amountUsd);
}

// --- Alcohol ----------------------------------------------------------------

export interface AlcoholCrossCut {
  totalUsd: number;
  txnCount: number;
  perDayUsd: number | null;
  /** Share of the whole trip, 0 to 100, or null when the trip nets to zero. */
  pctOfTrip: number | null;
  /** The categories it is spread across, largest first. This is what makes it
   * a cross-cut rather than a category: it is never all in Bars and
   * Nightlife. */
  byCategory: { categoryLabel: string; totalUsd: number }[];
}

/**
 * The drinking total, as a cross-cut rather than a slice.
 *
 * It deliberately reports WHICH CATEGORIES it spans, because that is the
 * evidence for the modelling decision: shop-bought beer sits in Groceries and
 * Markets and still counts, which is why is_alcohol is a boolean and not a
 * category. A single number would look like a category total and invite
 * someone to add it to the group bar, where it would double-count.
 */
export function alcoholCrossCut(
  rows: ExpenseRow[],
  tripDays: number | null,
  tripTotalUsd: number,
): AlcoholCrossCut | null {
  const drinking = rows.filter((row) => row.isAlcohol);
  if (drinking.length === 0) return null;

  const totalUsd = drinking.reduce((sum, row) => sum + row.amountUsd, 0);
  const byLabel = new Map<string, number>();
  for (const row of drinking) {
    const label = row.categoryLabel ?? "Uncategorized";
    byLabel.set(label, (byLabel.get(label) ?? 0) + row.amountUsd);
  }

  return {
    totalUsd: round2(totalUsd),
    txnCount: drinking.length,
    perDayUsd: tripDays && tripDays > 0 ? round2(totalUsd / tripDays) : null,
    pctOfTrip:
      tripTotalUsd !== 0
        ? Math.round((totalUsd / tripTotalUsd) * 1000) / 10
        : null,
    byCategory: [...byLabel.entries()]
      .map(([categoryLabel, total]) => ({
        categoryLabel,
        totalUsd: round2(total),
      }))
      .sort((a, b) => b.totalUsd - a.totalUsd),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// --- Entry ------------------------------------------------------------------

/** What the entry row sends. Amount is the only field that cannot be empty. */
export interface ExpenseDraft {
  amountUsd: number;
  vendor: string | null;
  categoryId: string | null;
  spentOn: string | null;
  destinationId: string | null;
  isAlcohol: boolean;
  note: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a typed amount. Accepts a leading minus (a refund), a currency symbol,
 * and thousands separators, because somebody logging from a phone types what
 * they see on a receipt.
 *
 * Returns null for anything that is not a usable number, INCLUDING zero: the
 * database rejects a zero amount and the entry row should say so before a
 * round trip rather than after one.
 */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value === 0) return null;
  // Two decimal places, matching numeric(12,2). Anything finer is a typo.
  return Math.round(value * 100) / 100;
}

export function isValidDate(value: string | null): boolean {
  return value === null || ISO_DATE.test(value);
}

/** Vendor names are stored as typed, trimmed, with runs of whitespace
 * collapsed. Not case-folded: v_expense_vendors groups on lower(vendor) and
 * shows the most recent spelling, so the suggestion looks like something the
 * user actually wrote. */
export function normalizeVendor(input: string): string | null {
  const trimmed = input.trim().replace(/\s+/g, " ");
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Vendor suggestions for a typed prefix, best first.
 *
 * Matches on prefix before substring, so typing "co" offers COOP before
 * Tesco. Case-insensitive throughout, which is what makes "Barcelona Bus" and
 * "Barcelona bus" one suggestion rather than two.
 */
export function matchVendors(
  vendors: VendorSuggestion[],
  input: string,
  limit = 6,
): VendorSuggestion[] {
  const query = input.trim().toLowerCase();
  if (query.length === 0) return [];
  const prefix: VendorSuggestion[] = [];
  const contains: VendorSuggestion[] = [];
  for (const vendor of vendors) {
    const key = vendor.vendorKey;
    if (key.startsWith(query)) prefix.push(vendor);
    else if (key.includes(query)) contains.push(vendor);
  }
  const byUses = (a: VendorSuggestion, b: VendorSuggestion) => b.uses - a.uses;
  return [...prefix.sort(byUses), ...contains.sort(byUses)].slice(0, limit);
}

/**
 * Whether a vendor's remembered category may be offered as a prefill.
 *
 * A vendor does not determine a category, and the imported ledger proves it:
 * the Fram Museum is a 14 admission and a 4 museum cafe lunch. So a vendor
 * that has been filed more than one way offers nothing, rather than offering
 * its most recent answer as though it were settled. The rest of the contract
 * (selection only, never over an existing value, never silently on edit) lives
 * at the call site, because it is about when the function is called rather
 * than what it returns.
 */
export function prefillCategoryId(vendor: VendorSuggestion): string | null {
  if (vendor.distinctCategories > 1) return null;
  return vendor.lastCategoryId;
}

// --- Category picker --------------------------------------------------------

export interface CategoryGroup {
  groupSlug: string;
  groupLabel: string;
  groupColor: string | null;
  categories: ExpenseCategory[];
}

/** The taxonomy folded into its two levels, in seeded order. */
export function categoryGroups(categories: ExpenseCategory[]): CategoryGroup[] {
  const groups = new Map<string, CategoryGroup>();
  for (const category of categories) {
    const existing = groups.get(category.groupSlug);
    if (existing) {
      existing.categories.push(category);
      continue;
    }
    groups.set(category.groupSlug, {
      groupSlug: category.groupSlug,
      groupLabel: category.groupLabel,
      groupColor: category.groupColor,
      categories: [category],
    });
  }
  return [...groups.values()];
}

/**
 * The categories to offer first: the ones this trip has actually used, most
 * used first.
 *
 * 26 categories is a lot to scan on a phone, and the argument for keeping all
 * 26 was that the picker would be ranked rather than alphabetical. This is
 * that ranking. It is per trip rather than all-time because a city break and a
 * hiking trip spend differently, and the trip in hand is the better predictor.
 */
export function frequentCategoryIds(
  rows: ExpenseRow[],
  limit = 6,
): string[] {
  const uses = new Map<string, number>();
  for (const row of rows) {
    if (!row.categoryId) continue;
    uses.set(row.categoryId, (uses.get(row.categoryId) ?? 0) + 1);
  }
  return [...uses.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}

import { GroupDot } from "@/components/expenses/category-picker";
import {
  alcoholCrossCut,
  biggestMovements,
  formatUsd,
  refunds,
  type ExpenseRow,
} from "@/lib/expenses";
import { formatDate } from "@/lib/format";

// The biggest movements on a trip, and the drinking cross-cut.
//
// "BIGGEST MOVEMENTS", NOT "BIGGEST EXPENSES", and the difference is load
// bearing. Ranked by absolute value, so a 689 charge and the -700 that
// reverses it sit next to each other. A list of the biggest charges would show
// the 689 and drop the -700, which is telling half a fact about the most
// expensive thing on the trip.
//
// It deliberately does NOT try to pair them up. Nothing in the data links a
// refund to the charge it reverses beyond the vendor name, and inferring the
// pairing would be the app inventing a relationship. Putting them adjacent
// lets the reader make that call, which they can do at a glance and the
// database cannot.

export function ExpenseHighlights({
  rows,
  tripDays,
  tripTotalUsd,
}: {
  rows: ExpenseRow[];
  tripDays: number | null;
  tripTotalUsd: number;
}) {
  const movements = biggestMovements(rows);
  const allRefunds = refunds(rows);
  const alcohol = alcoholCrossCut(rows, tripDays, tripTotalUsd);
  if (movements.length === 0) return null;

  // Refunds that did not make the movements list, so a trip whose refunds are
  // all small still says they exist rather than hiding them below the cut.
  const shownIds = new Set(movements.map((row) => row.id));
  const unshownRefunds = allRefunds.filter((row) => !shownIds.has(row.id));

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <section>
        <h2 className="mb-1 text-sm font-medium text-foreground/80">
          Biggest movements
        </h2>
        <p className="mb-3 text-xs text-foreground/45">
          By size, in either direction, so a charge and the refund that
          reverses it appear together.
        </p>
        <ul className="flex flex-col gap-1.5">
          {movements.map((row) => (
            <MovementRow key={row.id} row={row} />
          ))}
        </ul>
        {unshownRefunds.length > 0 ? (
          <p className="mt-2 text-xs text-foreground/45">
            {unshownRefunds.length} smaller{" "}
            {unshownRefunds.length === 1 ? "refund" : "refunds"} below this,
            totalling{" "}
            <span className="text-emerald-400">
              {formatUsd(
                unshownRefunds.reduce((sum, row) => sum + row.amountUsd, 0),
              )}
            </span>
            .
          </p>
        ) : null}
      </section>

      {alcohol ? (
        <section>
          <h2 className="mb-1 text-sm font-medium text-foreground/80">
            Of which alcohol
          </h2>
          <p className="mb-3 text-xs text-foreground/45">
            A cross-cut, not a category. This money is already counted in the
            groups above.
          </p>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <p className="text-xl font-semibold tabular-nums text-foreground">
                {formatUsd(alcohol.totalUsd)}
              </p>
              <p className="text-xs text-foreground/45">
                {alcohol.txnCount}{" "}
                {alcohol.txnCount === 1 ? "transaction" : "transactions"}
                {alcohol.pctOfTrip !== null
                  ? ` · ${alcohol.pctOfTrip}% of the trip`
                  : ""}
              </p>
            </div>
            {alcohol.perDayUsd !== null ? (
              <div>
                <p className="text-lg tabular-nums text-foreground/90">
                  {formatUsd(alcohol.perDayUsd)}/day
                </p>
              </div>
            ) : null}
          </div>
          {/* The evidence for the modelling decision: it is never all in Bars
              and Nightlife. Shop-bought beer sits in Groceries and counts. */}
          <ul className="mt-3 flex flex-col gap-1">
            {alcohol.byCategory.map((entry) => (
              <li
                key={entry.categoryLabel}
                className="flex items-baseline justify-between gap-3 text-xs"
              >
                <span className="min-w-0 truncate text-foreground/65">
                  {entry.categoryLabel}
                </span>
                <span className="shrink-0 tabular-nums text-foreground/80">
                  {formatUsd(entry.totalUsd)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function MovementRow({ row }: { row: ExpenseRow }) {
  const refund = row.amountUsd < 0;
  return (
    <li className="flex items-baseline gap-2.5">
      <GroupDot color={row.groupColor} />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground/85">
        {row.vendor ?? <span className="text-foreground/40">No vendor</span>}
        <span className="text-foreground/35">
          {" "}
          · {row.spentOn ? formatDate(row.spentOn) : "no date"}
          {row.destinationName ? ` · ${row.destinationName}` : ""}
        </span>
      </span>
      <span
        className={
          refund
            ? "shrink-0 text-sm tabular-nums text-emerald-400"
            : "shrink-0 text-sm tabular-nums text-foreground/90"
        }
      >
        {formatUsd(row.amountUsd)}
      </span>
    </li>
  );
}

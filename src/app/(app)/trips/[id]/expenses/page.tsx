import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { getTrip } from "@/lib/trips";
import { requireUser } from "@/lib/current-user";
import { isDemoUser } from "@/lib/demo";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import {
  expensesAvailable,
  getDestinationExpense,
  getExpenseCategories,
  getTripExpenseByCategory,
  getTripExpenseByDay,
  getTripExpenseByGroup,
  getTripExpenseSummary,
  getTripExpenses,
  getVendorSuggestions,
} from "@/lib/expenses-data";
import { summarizeUnattributed } from "@/lib/expenses";
import { chronologicalDestinations, resolveTripDates } from "@/lib/trip-dates";
import { ExpenseSummary } from "@/components/expenses/expense-summary";
import { ExpenseDayChart } from "@/components/expenses/expense-day-chart";
import { ExpenseHighlights } from "@/components/expenses/expense-highlights";
import { ExpenseWorkspace } from "@/components/expenses/expense-workspace";
import { DestinationCosts } from "@/components/expenses/destination-costs";

export const metadata = { title: "Expenses" };

// The expenses route.
//
// It lives on its own rather than on the trip page because that page is
// already dense (banner, notes, country facts, highlights, the destination
// list with its planner and transport rows, the journal, the photo section),
// and a transaction ledger is a working surface rather than something to
// scroll past. The trip page carries a summary card that links here.

export default async function TripExpensesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [{ user }, trip, available] = await Promise.all([
    requireUser(),
    getTrip(id),
    expensesAvailable(),
  ]);
  if (!trip) notFound();

  const isDemo = isDemoUser(user.id);

  if (!available) {
    return (
      <Shell tripId={trip.id} tripName={trip.name}>
        <div className="rounded-xl border border-dashed border-white/10 px-6 py-12 text-center text-sm text-foreground/60">
          Expenses are not set up on this database yet.
        </div>
      </Shell>
    );
  }

  const [
    rows,
    summary,
    groups,
    categorySpend,
    days,
    stops,
    categories,
    vendors,
  ] = await Promise.all([
    getTripExpenses(id),
    getTripExpenseSummary(id),
    getTripExpenseByGroup(id),
    getTripExpenseByCategory(id),
    getTripExpenseByDay(id),
    getDestinationExpense(id),
    getExpenseCategories(),
    getVendorSuggestions(),
  ]);

  const ordered = chronologicalDestinations(trip.destinations);
  const dates = resolveTripDates(trip, trip.destinations);

  // The entry row's default date. An ongoing trip defaults to today, because
  // that is what is being logged; a finished one defaults to its last day,
  // because a retrospective pass starts at the end. A trip with no dates at
  // all defaults to today, which is the only date the app can be sure of.
  const today = new Date().toISOString().slice(0, 10);
  const defaultDate =
    trip.status === "ongoing" || !dates.end_date
      ? today
      : dates.end_date < today
        ? dates.end_date
        : today;

  const unattributed = summarizeUnattributed(rows);

  return (
    <Shell tripId={trip.id} tripName={trip.name}>
      <div className="flex flex-col gap-8">
        {summary && summary.txnCount > 0 ? (
          <ExpenseSummary
            summary={summary}
            groups={groups}
            categories={categorySpend}
            unattributed={unattributed}
          />
        ) : null}

        <ExpenseWorkspace
          tripId={trip.id}
          rows={rows}
          categories={categories}
          vendors={vendors}
          destinations={ordered.map((destination) => ({
            id: destination.id,
            name: destination.name,
            arrivalDate: destination.arrival_date,
            departureDate: destination.departure_date,
          }))}
          defaultDate={defaultDate}
          disabled={isDemo}
          disabledReason={isDemo ? DEMO_READONLY_MESSAGE : null}
        />

        {summary && summary.txnCount > 0 ? (
          <ExpenseDayChart days={days} />
        ) : null}

        {stops.length > 0 && summary && summary.txnCount > 0 ? (
          <DestinationCosts stops={stops} />
        ) : null}

        {summary && summary.txnCount > 0 ? (
          <ExpenseHighlights
            rows={rows}
            tripDays={summary.tripDays}
            tripTotalUsd={summary.totalUsd}
          />
        ) : null}
      </div>
    </Shell>
  );
}

function Shell({
  tripId,
  tripName,
  children,
}: {
  tripId: string;
  tripName: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl p-6 sm:p-8">
      <Link
        href={`/trips/${tripId}`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-foreground/60 transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        {tripName}
      </Link>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Expenses</h1>
      {children}
    </div>
  );
}

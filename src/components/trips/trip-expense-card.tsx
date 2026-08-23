import Link from "next/link";
import { ChevronRightIcon, WalletIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { GroupDot } from "@/components/expenses/category-picker";
import { formatUsd, type GroupSpend, type TripExpenseSummary } from "@/lib/expenses";

// The expenses summary on the trip page: three numbers and a link.
//
// A link-out rather than an inline editor, deliberately. The trip page is
// already dense and its spine is the destination list; a transaction ledger
// belongs on a working surface of its own. This adds one card of height and no
// interaction weight.
//
// It is a <section className="mt-8">, matching the journal below it, because
// without that top margin it sits hard against the last destination card and
// reads as belonging to that stop rather than to the trip. It is a summary of
// the whole trip and has to be separated from the route to say so.

export function TripExpenseCard({
  tripId,
  summary,
  groups,
}: {
  tripId: string;
  /** Null when the read failed or the migration has not run. */
  summary: TripExpenseSummary | null;
  /** Null when the read FAILED, empty when there is genuinely nothing. The
   * distinction is the point: see the "Mostly" block below. */
  groups: GroupSpend[] | null;
}) {
  const href = `/trips/${tripId}/expenses`;

  // Nothing logged yet: one quiet line rather than an empty state with
  // figures, since zeros would say less than the invitation does.
  if (!summary || summary.txnCount === 0) {
    return (
      <section className="mt-8">
        <Link href={href} className="group block">
          <Card className="transition-all group-hover:ring-brand/40">
            <CardContent className="flex items-center gap-3 py-4">
              <WalletIcon className="size-4 shrink-0 text-foreground/40" />
              <span className="flex-1 text-sm text-foreground/60">
                Track what this trip cost
              </span>
              <ChevronRightIcon className="size-4 shrink-0 text-foreground/30" />
            </CardContent>
          </Card>
        </Link>
      </section>
    );
  }

  // THE "MOSTLY" SLOT NAMES A SPENDING CATEGORY, AND "UNCATEGORIZED" IS NOT
  // ONE. Two ways it could otherwise assert something it has no business
  // asserting, and both have happened:
  //
  //   - `groups` is null because the read failed. An empty array and a failed
  //     read look identical to a caller and mean opposite things, which is why
  //     getTripExpenseByGroup returns null rather than [], the same way
  //     getTripExpenseCount returns null rather than 0.
  //   - The lead group is "uncategorized". That reads as a finding about where
  //     the money went and is not one; it is the absence of a finding. It once
  //     rendered "Mostly Uncategorized 100%" over a ledger in which all 226
  //     rows carried a category, because RLS was hiding the taxonomy from the
  //     join. Saying nothing would have been correct even then.
  //
  // The uncategorized count is still surfaced, on the expenses page where it
  // is actionable, rather than dressed up as an insight here.
  const lead = groups?.[0] ?? null;
  const showLead = lead !== null && lead.groupSlug !== "uncategorized";

  return (
    <section className="mt-8">
      <Link href={href} className="group block">
        <Card className="transition-all group-hover:ring-brand/40">
          <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 py-4">
            <Figure label="Spent" value={formatUsd(summary.totalUsd)} />
            <Figure
              label={summary.tripDays ? `Over ${summary.tripDays} days` : "Per day"}
              value={
                summary.usdPerDay === null
                  ? "-"
                  : `${formatUsd(summary.usdPerDay)}/day`
              }
            />
            {showLead ? (
              <div>
                <p className="text-xs text-foreground/50">Mostly</p>
                <p className="flex items-center gap-1.5 text-lg text-foreground/90">
                  <GroupDot color={lead.groupColor} />
                  <span>{lead.groupLabel}</span>
                  {lead.pctOfTrip !== null ? (
                    <span className="text-sm text-foreground/40">
                      {lead.pctOfTrip}%
                    </span>
                  ) : null}
                </p>
              </div>
            ) : null}
            <ChevronRightIcon className="ml-auto size-4 shrink-0 text-foreground/30" />
          </CardContent>
        </Card>
      </Link>
    </section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-foreground/50">{label}</p>
      <p className="text-lg font-medium tabular-nums text-foreground">{value}</p>
    </div>
  );
}

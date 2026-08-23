import { GroupDot } from "@/components/expenses/category-picker";
import { formatUsd } from "@/lib/expenses";
import type { SharedTripExpenses } from "@/lib/share-data";

// What a trip cost, on a read-only profile.
//
// A SUMMARY AND NEVER THE TRANSACTIONS. /demo is a portfolio piece, not a
// ledger, and there is no reason to publish 75 individual rows to show what a
// trip cost. The authenticated route is where the line items live.
//
// `spend` is null whenever the route did not ask for spending, which is every
// /share/[slug] request INCLUDING /share/demo. That is the whole gate: RLS
// permits the demo account's expenses to be read by anon, so nothing but the
// caller's silence keeps them off a public profile. Rendering nothing on null
// is therefore load-bearing, not a tidy empty state.

export function SharedTripSpend({
  spend,
}: {
  spend: SharedTripExpenses | null;
}) {
  if (!spend || spend.txnCount === 0) return null;

  // The "mostly" group, on the same rule the trip page card uses:
  // "Uncategorized" is the absence of a finding rather than one, so it never
  // gets named.
  const lead = spend.groups.find(
    (group) => group.groupSlug !== "uncategorized" && group.totalUsd > 0,
  );

  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1 text-xs text-foreground/55">
      <span className="tabular-nums text-foreground/80">
        {formatUsd(spend.totalUsd)}
      </span>
      {spend.usdPerDay !== null ? (
        <span className="tabular-nums">
          {formatUsd(spend.usdPerDay)}/day
        </span>
      ) : null}
      {lead ? (
        <span className="inline-flex items-center gap-1.5">
          <GroupDot color={lead.groupColor} />
          {lead.groupLabel}
          {lead.pctOfTrip !== null ? (
            <span className="text-foreground/35">{lead.pctOfTrip}%</span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

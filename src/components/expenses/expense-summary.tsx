import { formatDate } from "@/lib/format";
import {
  formatUsd,
  unattributedLine,
  unattributedSubject,
  type GroupSpend,
  type TripExpenseSummary,
  type UnattributedSummary,
} from "@/lib/expenses";
import { GroupDot } from "@/components/expenses/category-picker";

// The numbers at the top of the expenses page, and the group split under them.
//
// Server component: everything here comes from a SQL view and none of it is
// interactive.

export function ExpenseSummary({
  summary,
  groups,
  unattributed,
}: {
  summary: TripExpenseSummary;
  /** Null when the read FAILED, empty when there is genuinely nothing. The
   * split matters: a bar rendered off an absent read would be describing
   * spending the database never reported. */
  groups: GroupSpend[] | null;
  unattributed: UnattributedSummary | null;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <Figure label="Total" value={formatUsd(summary.totalUsd)} large />
        <Figure
          label={summary.tripDays ? `Over ${summary.tripDays} days` : "Per day"}
          value={
            summary.usdPerDay === null ? "-" : `${formatUsd(summary.usdPerDay)}/day`
          }
          large
        />
        <Figure label="Transactions" value={String(summary.txnCount)} />
        {summary.alcoholUsd !== 0 ? (
          // Presented as a cross-cut, never as a slice beside the groups: the
          // same money is already counted inside Food and Drink, Groceries,
          // and occasionally Other.
          <Figure
            label="Of which alcohol"
            value={formatUsd(summary.alcoholUsd)}
          />
        ) : null}
      </div>

      {groups && groups.length > 0 ? <GroupBar groups={groups} /> : null}

      {summary.uncategorizedCount > 0 ? (
        <p className="text-xs text-amber-400/80">
          {summary.uncategorizedCount}{" "}
          {summary.uncategorizedCount === 1 ? "transaction has" : "transactions have"}{" "}
          no category yet.
        </p>
      ) : null}

      {unattributed ? <Unattributed summary={unattributed} /> : null}
    </section>
  );
}

function Figure({
  label,
  value,
  large,
}: {
  label: string;
  value: string;
  large?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-foreground/50">{label}</p>
      <p
        className={
          large
            ? "text-2xl font-semibold tabular-nums tracking-tight text-foreground"
            : "text-lg tabular-nums text-foreground/90"
        }
      >
        {value}
      </p>
    </div>
  );
}

/** The group split as one bar plus a legend. Negative-netting groups are
 * possible (a group of pure refunds) and are given no width rather than a
 * nonsensical one, but they keep their legend row so the money is not hidden. */
function GroupBar({ groups }: { groups: GroupSpend[] }) {
  const positive = groups.filter((group) => group.totalUsd > 0);
  const total = positive.reduce((sum, group) => sum + group.totalUsd, 0);

  return (
    <div className="flex flex-col gap-2">
      {total > 0 ? (
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/5">
          {positive.map((group) => (
            <div
              key={group.groupSlug}
              style={{
                width: `${(group.totalUsd / total) * 100}%`,
                backgroundColor: group.groupColor ?? "rgba(255,255,255,0.25)",
              }}
              title={`${group.groupLabel} ${formatUsd(group.totalUsd)}`}
            />
          ))}
        </div>
      ) : null}
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {groups.map((group) => (
          <li
            key={group.groupSlug}
            className="flex items-center gap-1.5 text-xs text-foreground/70"
          >
            <GroupDot color={group.groupColor} />
            <span>{group.groupLabel}</span>
            <span className="tabular-nums text-foreground/90">
              {formatUsd(group.totalUsd)}
            </span>
            {group.pctOfTrip !== null ? (
              <span className="text-foreground/40">{group.pctOfTrip}%</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The rows that landed on no stop.
 *
 * A BARE NET IS NEVER PRINTED HERE. On the Post Grad Trip the figure is 16.00,
 * which reads like a rounding scrap and is nothing of the sort: it is a 689
 * flight against a -700 refund and a 382 rail pass against a -355, four rows
 * moving real money that happen to very nearly cancel. So a short set is
 * listed, because 689 beside -700 explains itself and no summary statistic
 * does, and a long one falls back to a sentence that still carries the count
 * and the refund count.
 */
function Unattributed({ summary }: { summary: UnattributedSummary }) {
  // The summary clause is omitted where the count alone says everything, so a
  // lone prepaid flight reads "Not on any stop, so it is absent from the
  // per-stop table below." with the row underneath, rather than the four-row
  // sentence with a stub where the interesting part should be.
  const line = unattributedLine(summary);
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <p className="text-xs text-foreground/60">
        Not on any stop, so {unattributedSubject(summary)} absent from the
        per-stop table below
        {line ? (
          <>
            {": "}
            <span className="text-foreground/80">{line}</span>
          </>
        ) : null}
        .
      </p>
      {summary.listable ? (
        <ul className="mt-2 flex flex-col gap-1">
          {summary.rows.map((row) => (
            <li
              key={row.id}
              className="flex items-baseline gap-2 text-xs text-foreground/70"
            >
              <span className="min-w-0 flex-1 truncate">
                {row.vendor ?? "No vendor"}
                <span className="text-foreground/40">
                  {" "}
                  · {row.spentOn ? formatDate(row.spentOn) : "no date"}
                </span>
              </span>
              <span
                className={
                  row.amountUsd < 0
                    ? "shrink-0 tabular-nums text-emerald-400"
                    : "shrink-0 tabular-nums text-foreground/80"
                }
              >
                {formatUsd(row.amountUsd)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

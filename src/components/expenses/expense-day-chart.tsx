"use client";

import { useMemo, useState } from "react";

import { formatUsd, type DaySpend } from "@/lib/expenses";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

// Spend per day.
//
// REFUNDS ARE DRAWN, NOT NETTED AWAY. The view carries spend_usd and
// refund_usd alongside the net for exactly this: a day holding a 689 charge
// and a -700 refund nets to -11, and a chart of the net renders that as a
// quiet dip on an otherwise ordinary day. Both facts happened; both are drawn,
// spend above the baseline and refunds below it.
//
// The scale is shared between the two halves so a -700 is visibly larger than
// a 689 rather than each being normalised to its own side. That is the point
// of putting them on one axis.
//
// Days with no spending are real zeros rather than missing bars, because the
// view emits a dense series: a gap in a trip is a gap, not a shorter chart.

const BAR_MIN_PX = 2;

export function ExpenseDayChart({ days }: { days: DaySpend[] }) {
  const [hovered, setHovered] = useState<string | null>(null);

  const scale = useMemo(() => {
    const peakSpend = Math.max(0, ...days.map((day) => day.spendUsd));
    const peakRefund = Math.max(0, ...days.map((day) => -day.refundUsd));
    return { peakSpend, peakRefund, hasRefunds: peakRefund > 0 };
  }, [days]);

  if (days.length === 0 || scale.peakSpend === 0) return null;

  // The refund half only takes vertical space when there are refunds, so an
  // ordinary trip is not given a permanent empty band below its bars.
  const spendH = 96;
  const refundH = scale.hasRefunds ? 40 : 0;
  const active = days.find((day) => day.spendDate === hovered) ?? null;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-foreground/80">By day</h2>
          <p className="text-xs text-foreground/45">
            {scale.hasRefunds
              ? "Spending above the line, refunds below it, on one scale."
              : "Every day of the trip, including the ones you spent nothing."}
          </p>
        </div>
        {active ? (
          <p className="text-xs tabular-nums text-foreground/70">
            {formatDate(active.spendDate)}
            {": "}
            <span className="text-foreground">{formatUsd(active.spendUsd)}</span>
            {active.refundUsd !== 0 ? (
              <span className="text-emerald-400">
                {" "}
                and {formatUsd(active.refundUsd)}
              </span>
            ) : null}
            <span className="text-foreground/40">
              {" "}
              · {active.txnCount}{" "}
              {active.txnCount === 1 ? "transaction" : "transactions"}
            </span>
          </p>
        ) : null}
      </div>

      <div
        className="flex items-end gap-px"
        onMouseLeave={() => setHovered(null)}
      >
        {days.map((day) => {
          const up =
            day.spendUsd > 0
              ? Math.max((day.spendUsd / scale.peakSpend) * spendH, BAR_MIN_PX)
              : 0;
          const down =
            day.refundUsd < 0
              ? Math.max(
                  (-day.refundUsd / Math.max(scale.peakSpend, 1)) * spendH,
                  BAR_MIN_PX,
                )
              : 0;
          const isActive = hovered === day.spendDate;
          return (
            <div
              key={day.spendDate}
              className="group flex min-w-0 flex-1 flex-col items-stretch"
              onMouseEnter={() => setHovered(day.spendDate)}
              title={`${formatDate(day.spendDate)}: ${formatUsd(day.spendUsd)}${
                day.refundUsd !== 0 ? ` and ${formatUsd(day.refundUsd)}` : ""
              }`}
            >
              <div
                className="flex flex-col justify-end"
                style={{ height: spendH }}
              >
                <div
                  className={cn(
                    "rounded-t-sm transition-colors",
                    isActive ? "bg-brand" : "bg-brand/45",
                  )}
                  style={{ height: up }}
                />
              </div>
              <div className="h-px bg-white/15" />
              {scale.hasRefunds ? (
                <div className="flex flex-col justify-start" style={{ height: refundH }}>
                  <div
                    className={cn(
                      "rounded-b-sm transition-colors",
                      isActive ? "bg-emerald-400" : "bg-emerald-400/50",
                    )}
                    style={{ height: Math.min(down, refundH) }}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-1.5 flex justify-between text-[0.7rem] text-foreground/35">
        <span>{formatDate(days[0].spendDate)}</span>
        <span>{formatDate(days[days.length - 1].spendDate)}</span>
      </div>
    </section>
  );
}

"use client";

import { useMemo, useState } from "react";

import {
  formatUsd,
  splitDaysByWindow,
  type DaySpend,
  type OutsideSpend,
} from "@/lib/expenses";
import { formatDate, formatDateRangeShort } from "@/lib/format";
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
//
// THE AXIS IS THE TRIP, and what fell outside it is a total beside it. A
// flight booked two months out used to stretch the axis across the whole gap,
// leaving the trip squeezed into one edge of a chart of empty days. The split
// is derived on read (splitDaysByWindow) against the trip's own window, and
// the before and after figures are always shown when they exist, so no money
// leaves the page; it just stops being drawn as a day it was not.

const BAR_MIN_PX = 2;

export function ExpenseDayChart({
  days: allDays,
  windowStart,
  windowEnd,
}: {
  days: DaySpend[];
  windowStart: string | null;
  windowEnd: string | null;
}) {
  // TWO WAYS IN, because hover is not one of them on a phone.
  //
  // The first version set `hovered` on mouseenter and put the rest in a
  // `title`, neither of which exists on touch, so the per-day detail was
  // simply unreachable on the device this whole surface is shaped around. A
  // tooltip was the wrong answer for the truncated date range for the same
  // reason, and it is the wrong answer here.
  //
  // So each day is a real <button>: tapping pins it (and tapping again lets
  // it go), hovering previews it, and focusing it does the same, which gets
  // keyboard users the detail for free. A pin outranks a hover so the readout
  // does not change under a moving cursor once somebody has chosen a day.
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);

  const {
    before,
    during: days,
    after,
  } = useMemo(
    () => splitDaysByWindow(allDays, windowStart, windowEnd),
    [allDays, windowStart, windowEnd],
  );

  const scale = useMemo(() => {
    const peakSpend = Math.max(0, ...days.map((day) => day.spendUsd));
    const peakRefund = Math.max(0, ...days.map((day) => -day.refundUsd));
    return { peakSpend, peakRefund, hasRefunds: peakRefund > 0 };
  }, [days]);

  const hasChart = days.length > 0 && scale.peakSpend > 0;
  if (!hasChart && !before && !after) return null;

  // The refund half only takes vertical space when there are refunds, so an
  // ordinary trip is not given a permanent empty band below its bars.
  const spendH = 96;
  const refundH = scale.hasRefunds ? 40 : 0;
  const shown = pinned ?? hovered;
  const active = days.find((day) => day.spendDate === shown) ?? null;

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
        {!hasChart ? null : active ? (
          <p className="text-xs tabular-nums text-foreground/70">
            {formatDate(active.spendDate)}
            {": "}
            <span className="text-foreground">
              {formatUsd(active.spendUsd)}
            </span>
            {/* A day with both is the only one where the net would mislead, so
                both halves are named. Interrail Summer's 2019-08-08 is the
                real case: 47 spent, 19 refunded, netting 28. */}
            {/* The magnitude, not the signed value: "and -$19 back" reads as a
                double negative. The colour and the word "back" carry the
                direction. */}
            {active.refundUsd !== 0 ? (
              <span className="text-emerald-400">
                {" "}
                and {formatUsd(-active.refundUsd)} back
              </span>
            ) : null}
            <span className="text-foreground/40">
              {" "}
              · {active.txnCount}{" "}
              {active.txnCount === 1 ? "transaction" : "transactions"}
              {active.refundUsd !== 0
                ? `, netting ${formatUsd(active.totalUsd)}`
                : ""}
            </span>
          </p>
        ) : (
          // Device-neutral wording: "tap" is wrong on a desktop and "hover" is
          // wrong on a phone, and this component is used on both.
          <p className="text-xs text-foreground/35">
            Pick a day for its detail.
          </p>
        )}
      </div>

      {hasChart ? (
        <>
          <div
            className="flex items-end gap-px"
            onMouseLeave={() => setHovered(null)}
          >
            {days.map((day) => {
              const up =
                day.spendUsd > 0
                  ? Math.max(
                      (day.spendUsd / scale.peakSpend) * spendH,
                      BAR_MIN_PX,
                    )
                  : 0;
              const down =
                day.refundUsd < 0
                  ? Math.max(
                      (-day.refundUsd / Math.max(scale.peakSpend, 1)) * spendH,
                      BAR_MIN_PX,
                    )
                  : 0;
              const isActive = shown === day.spendDate;
              return (
                <button
                  key={day.spendDate}
                  type="button"
                  // Tap to pin, tap again to release. Hover and focus preview.
                  onClick={() =>
                    setPinned((current) =>
                      current === day.spendDate ? null : day.spendDate,
                    )
                  }
                  onMouseEnter={() => setHovered(day.spendDate)}
                  onFocus={() => setHovered(day.spendDate)}
                  onBlur={() => setHovered(null)}
                  aria-pressed={pinned === day.spendDate}
                  // The whole readout, spoken. A title attribute would have said
                  // this only to a mouse.
                  aria-label={`${formatDate(day.spendDate)}: ${formatUsd(day.spendUsd)} spent${
                    day.refundUsd !== 0
                      ? `, ${formatUsd(-day.refundUsd)} refunded`
                      : ""
                  }, ${day.txnCount} ${day.txnCount === 1 ? "transaction" : "transactions"}`}
                  // A one-day-wide bar is a tiny tap target, so the whole column
                  // height is tappable rather than just the painted part.
                  className="group flex min-w-0 flex-1 cursor-pointer flex-col items-stretch rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
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
                    <div
                      className="flex flex-col justify-start"
                      style={{ height: refundH }}
                    >
                      <div
                        className={cn(
                          "rounded-b-sm transition-colors",
                          isActive ? "bg-emerald-400" : "bg-emerald-400/50",
                        )}
                        style={{ height: Math.min(down, refundH) }}
                      />
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="mt-1.5 flex justify-between text-[0.7rem] text-foreground/35">
            <span>{formatDate(days[0].spendDate)}</span>
            <span>{formatDate(days[days.length - 1].spendDate)}</span>
          </div>
        </>
      ) : (
        <p className="text-xs text-foreground/45">
          Nothing is dated during the trip itself yet.
        </p>
      )}

      {/* Timeline order: before sits under the start of the axis and after
          under its end, so the pair reads as the chart's two sides. */}
      {before || after ? (
        <div className="mt-3 flex flex-wrap justify-between gap-3">
          {before ? (
            <OutsideTotal label="Before the trip" spend={before} />
          ) : (
            <span />
          )}
          {after ? (
            <OutsideTotal label="After the trip" spend={after} alignEnd />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function OutsideTotal({
  label,
  spend,
  alignEnd = false,
}: {
  label: string;
  spend: OutsideSpend;
  alignEnd?: boolean;
}) {
  const range =
    spend.firstDate === spend.lastDate
      ? formatDate(spend.firstDate)
      : formatDateRangeShort(spend.firstDate, spend.lastDate);
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2",
        alignEnd && "sm:text-right",
      )}
    >
      <p className="text-[0.7rem] uppercase tracking-wide text-foreground/45">
        {label}
      </p>
      <p className="text-sm tabular-nums text-foreground">
        {formatUsd(spend.spendUsd)}
        {/* Same convention as the day readout: the magnitude, coloured, with
            "back" carrying the direction. */}
        {spend.refundUsd !== 0 ? (
          <span className="text-emerald-400">
            {" "}
            and {formatUsd(-spend.refundUsd)} back
          </span>
        ) : null}
      </p>
      <p className="text-[0.7rem] tabular-nums text-foreground/40">
        {spend.txnCount} {spend.txnCount === 1 ? "transaction" : "transactions"}
        {" · "}
        {range}
      </p>
    </div>
  );
}

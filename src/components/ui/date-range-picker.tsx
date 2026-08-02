"use client";

import { useMemo, useState } from "react";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

// One calendar for a start and an end, instead of two date inputs the user has
// to reconcile in their head. Click a day to set the start, click another to
// close the range; clicking before the start restarts from there rather than
// refusing, which is what people actually do when they misclick.
//
// Hand-rolled rather than pulled from a date library: the whole grid is a month
// of buttons over YYYY-MM-DD strings, and the app has no other use for a date
// dependency. Every value in and out is a plain YYYY-MM-DD string (or "" for
// unset), the same shape the forms and the server actions already speak, so
// nothing here has to touch a Date except to render a label.
//
// All arithmetic is UTC-anchored. A local Date on a YYYY-MM-DD string lands on
// the previous day west of Greenwich, which would quietly shift every range the
// user picked.

const DAY_MS = 86_400_000;
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

const MONTH_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function toUtcMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(toUtcMs(value));
}

/** The first of the month a date falls in, as YYYY-MM-01. */
function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function addMonths(month: string, delta: number): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + delta;
  const nextYear = year + Math.floor(index / 12);
  const nextMonth = ((index % 12) + 12) % 12;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth + 1).padStart(2, "0")}-01`;
}

/** The 42 cells of a month grid: leading days from the previous month, the
 * month itself, then trailing days, so every month is the same height and the
 * grid never reflows as the user pages through it. */
function monthCells(month: string): { date: string; inMonth: boolean }[] {
  const first = toUtcMs(month);
  const weekday = new Date(first).getUTCDay();
  const start = first - weekday * DAY_MS;
  const cells: { date: string; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i += 1) {
    const date = toIso(start + i * DAY_MS);
    cells.push({ date, inMonth: date.slice(0, 7) === month.slice(0, 7) });
  }
  return cells;
}

export interface DateRangePickerProps {
  /** YYYY-MM-DD, or "" when unset. */
  start: string;
  end: string;
  /** Fired with both ends on every change. An open range (start with no end)
   * is a valid intermediate state and is reported as it happens, so a form can
   * save a one-sided range without the user closing the popover. */
  onChange: (start: string, end: string) => void;
  disabled?: boolean;
  /** Placeholder on the trigger when nothing is picked. */
  placeholder?: string;
  /** Id for the trigger, so a Label's htmlFor reaches it. */
  id?: string;
  className?: string;
  /** Accessible name, when the visible label is not adjacent. */
  ariaLabel?: string;
}

export function DateRangePicker({
  start,
  end,
  onChange,
  disabled = false,
  placeholder = "Pick dates",
  id,
  className,
  ariaLabel,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);

  const validStart = isIsoDate(start) ? start : "";
  const validEnd = isIsoDate(end) ? end : "";

  const label = validStart
    ? validEnd
      ? `${formatDate(validStart)} to ${formatDate(validEnd)}`
      : `${formatDate(validStart)} to ...`
    : validEnd
      ? `Until ${formatDate(validEnd)}`
      : placeholder;

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn(
            "flex h-10 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-left text-sm shadow-xs transition-colors",
            "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            "disabled:cursor-not-allowed disabled:opacity-50",
            !validStart && !validEnd && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="size-4 shrink-0 text-foreground/50" />
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        // Narrow enough that the whole calendar fits inside a 380px viewport
        // with the popover's own collision padding either side.
        className="w-[19rem] max-w-[calc(100vw-2rem)]"
        collisionPadding={12}
      >
        {/* The calendar is its own component so that closing the popover
            unmounts it: the month being paged through and the hover preview
            are both per-visit state, and letting the unmount reset them is
            simpler and more reliable than an effect that tries to notice a
            reopen. */}
        <RangeCalendar
          start={validStart}
          end={validEnd}
          onChange={onChange}
          onDone={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

function RangeCalendar({
  start,
  end,
  onChange,
  onDone,
}: {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  onDone: () => void;
}) {
  // Opening lands on the month the range is in, or on this month when there is
  // no range yet. Read once, at mount: "today" must not shift under a re-render
  // and the month must not jump back when an end date is picked in a later one.
  const [today] = useState(() => toIso(Date.now()));
  const [month, setMonth] = useState(() => monthStart(start || end || today));
  // The day the pointer is over while a range is half-open, so the user can see
  // what they are about to select.
  const [hovered, setHovered] = useState<string | null>(null);

  const cells = useMemo(() => monthCells(month), [month]);

  // Half-open ranges preview against the hovered day, so the highlighted band
  // is always the range that would be saved by the next click.
  const previewEnd = start && !end && hovered ? hovered : end;
  const [bandStart, bandEnd] =
    start && previewEnd && previewEnd < start
      ? [previewEnd, start]
      : [start, previewEnd];

  function handleSelect(date: string) {
    // Nothing picked, or a closed range: start again from this day.
    if (!start || end) {
      onChange(date, "");
      setHovered(null);
      return;
    }
    // Half-open: this click closes it, in whichever direction it was clicked.
    if (date < start) onChange(date, start);
    else onChange(start, date);
    setHovered(null);
  }

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setMonth(addMonths(month, -1))}
          aria-label="Previous month"
          className="flex size-8 items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          <ChevronLeftIcon className="size-4" />
        </button>
        <div aria-live="polite" className="text-sm font-medium">
          {MONTH_FORMAT.format(toUtcMs(month))}
        </div>
        <button
          type="button"
          onClick={() => setMonth(addMonths(month, 1))}
          aria-label="Next month"
          className="flex size-8 items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          <ChevronRightIcon className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-y-0.5">
        {WEEKDAYS.map((day, index) => (
          <div
            key={`${day}${index}`}
            aria-hidden
            className="pb-1 text-center text-[11px] font-medium uppercase text-foreground/40"
          >
            {day}
          </div>
        ))}
        {cells.map((cell) => {
          const isStart = cell.date === bandStart;
          const isEnd = cell.date === bandEnd;
          const inBand =
            Boolean(bandStart && bandEnd) &&
            cell.date >= bandStart &&
            cell.date <= bandEnd;
          const isEdge = isStart || isEnd;
          return (
            <button
              key={cell.date}
              type="button"
              onClick={() => handleSelect(cell.date)}
              onPointerEnter={() => setHovered(cell.date)}
              onFocus={() => setHovered(cell.date)}
              aria-pressed={isEdge}
              aria-current={cell.date === today ? "date" : undefined}
              className={cn(
                // A 40px touch target at the default text size, which is the
                // smallest a calendar day should ever be on a phone.
                "relative flex h-10 items-center justify-center text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/60",
                inBand && !isEdge && "bg-brand/15",
                inBand && isStart && "rounded-l-md",
                inBand && isEnd && "rounded-r-md",
                isEdge
                  ? "rounded-md bg-brand font-medium text-brand-foreground"
                  : cell.inMonth
                    ? "text-foreground/85 hover:bg-white/10"
                    : "text-foreground/25 hover:bg-white/5",
                !isEdge &&
                  cell.date === today &&
                  "font-semibold text-brand underline decoration-brand/60 underline-offset-4",
              )}
            >
              {Number(cell.date.slice(8, 10))}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/10 pt-2">
        <button
          type="button"
          onClick={() => {
            onChange("", "");
            setHovered(null);
          }}
          className="rounded-md px-2 py-1.5 text-xs text-foreground/60 transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md px-2 py-1.5 text-xs font-medium text-brand transition-colors hover:bg-brand/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          Done
        </button>
      </div>
    </>
  );
}

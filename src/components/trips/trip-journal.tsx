"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BookOpenIcon,
  CheckIcon,
  ChevronDownIcon,
  Loader2Icon,
  PencilLineIcon,
} from "lucide-react";

import { saveJournalEntryAction } from "@/lib/actions/journal";
import { journalDayLabel, journalPreview, type JournalDay } from "@/lib/journal";
import { enqueue } from "@/lib/offline/queue";
import { useOnlineStatus } from "@/lib/offline/use-offline";
import { cn } from "@/lib/utils";

// The travel journal on the trip page: one row per day of the trip, tap to
// write. Distinct from an experience's notes, which describe a place; this
// describes a day.
//
// Losing typed text is the only failure mode that actually matters here, so
// three things guard against it:
//
//   1. The textarea is local state. A failed save leaves the text exactly
//      where it is and says so; nothing is cleared on error, ever.
//   2. Typing schedules a debounced autosave, and closing the editor (or
//      leaving the field) flushes immediately rather than waiting it out.
//   3. While a change is unsaved, a beforeunload handler asks before the tab
//      goes away.
//
// Only the flush marks the save "final", which is what triggers the app-wide
// revalidation; the debounced writes deliberately do not, so the page cannot
// re-render out from under the caret mid-sentence.
//
// Two levels of collapse keep a long trip readable. A month in Patagonia is 30
// day rows, most of them empty, and unfolded they bury the destination list and
// the photo section under a wall of "Write about this day":
//
//   1. The whole section is one disclosure, closed by default. Its header
//      carries the entry count, so "there is writing in here" is legible
//      without opening anything.
//   2. Opened, it lists only the days that already have an entry, with a
//      "Show all N days" switch to reach an empty one. A journal with nothing
//      in it opens straight to every day, because filtering to nothing would
//      leave no way to start writing.
//
// One disclosure per trip rather than one per stop: a day is the unit of the
// journal, and the stops it groups under are already the destination list
// directly above it. Nesting the days a second time under stop headers would
// add a click to reach any given day and say nothing new.

const AUTOSAVE_MS = 1200;

function DayRow({
  day,
  tripId,
  tripName,
  disabled,
  disabledReason,
}: {
  day: JournalDay;
  tripId: string;
  tripName: string;
  disabled: boolean;
  disabledReason: string | null;
}) {
  const online = useOnlineStatus();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(day.body ?? "");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [queued, setQueued] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The text last known to be on the server. Held twice on purpose: as state,
  // because the "Unsaved" indicator is rendered from it, and as a ref, because
  // a debounced save fires from a timeout that must compare against the
  // current value rather than the one its closure captured.
  const [committed, setCommitted] = useState(day.body ?? "");
  const committedRef = useRef(committed);
  const dirty = text.trim() !== committed.trim();

  const save = useCallback(
    async (value: string, final: boolean) => {
      if (value.trim() === committedRef.current.trim()) return;
      setSaving(true);

      // Offline, the autosave queues instead of posting. Queued journal saves
      // coalesce on (trip, day), so typing a long entry with no signal leaves
      // one pending write holding the latest text rather than one per pause.
      if (!online) {
        const stored = await enqueue({
          kind: "journal.save",
          tripId,
          tripName,
          entryDate: day.date,
          body: value,
        });
        setSaving(false);
        if (!stored) {
          toast.error("Could not save that offline.", {
            description: "Your text is still here. Keep this open until you reconnect.",
          });
          return;
        }
        committedRef.current = value;
        setCommitted(value);
        setQueued(true);
        setSavedAt(Date.now());
        return;
      }

      const result = await saveJournalEntryAction(tripId, day.date, value, {
        final,
      });
      setSaving(false);
      if ("error" in result) {
        // The text stays exactly where it is. Nothing typed is ever cleared
        // by a failed save.
        toast.error(result.error);
        return;
      }
      committedRef.current = value;
      setCommitted(value);
      setQueued(false);
      setSavedAt(Date.now());
    },
    [tripId, tripName, day.date, online],
  );

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    void save(text, true);
  }, [save, text]);

  function onChange(value: string) {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void save(value, false);
    }, AUTOSAVE_MS);
  }

  useEffect(() => {
    if (!dirty) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Any pending debounce still owes a write when the row unmounts.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const hasText = text.trim().length > 0;

  return (
    <li className="rounded-lg bg-white/[0.02] ring-1 ring-foreground/[0.07]">
      <button
        type="button"
        onClick={() => {
          if (open) flush();
          setOpen((current) => !current);
        }}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
      >
        <span className="mt-0.5 shrink-0 text-xs tabular-nums text-foreground/40">
          {day.index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm text-foreground/85">
              {journalDayLabel(day.date)}
            </span>
            {day.destinationName ? (
              <span className="min-w-0 break-words text-xs text-foreground/45">
                {day.destinationName}
              </span>
            ) : null}
          </span>
          {!open ? (
            <span className="mt-0.5 block break-words text-xs text-foreground/50">
              {hasText ? (
                journalPreview(text)
              ) : (
                <span className="text-foreground/30">
                  {disabled ? "Nothing written" : "Write about this day"}
                </span>
              )}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 shrink-0 text-foreground/30">
          {saving ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : hasText ? (
            <PencilLineIcon className="size-3.5" />
          ) : null}
        </span>
      </button>

      {open ? (
        <div className="border-t border-white/[0.06] px-3 py-2.5">
          {disabled ? (
            hasText ? (
              <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/80">
                {text}
              </p>
            ) : (
              <p className="text-xs text-foreground/40">
                {disabledReason ?? "Nothing written for this day."}
              </p>
            )
          ) : (
            <>
              <textarea
                value={text}
                onChange={(event) => onChange(event.target.value)}
                onBlur={flush}
                autoFocus
                rows={5}
                placeholder="What happened today?"
                className="w-full resize-y rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm leading-relaxed text-foreground outline-none placeholder:text-foreground/25 focus:border-brand/60"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-[11px] text-foreground/35">
                  {saving ? (
                    "Saving..."
                  ) : dirty ? (
                    "Unsaved"
                  ) : queued ? (
                    <span className="text-amber-300/70">
                      Queued, sends when you reconnect
                    </span>
                  ) : savedAt !== null ? (
                    <span className="inline-flex items-center gap-1 text-foreground/45">
                      <CheckIcon className="size-3" />
                      Saved
                    </span>
                  ) : (
                    "Saves as you write"
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    flush();
                    setOpen(false);
                  }}
                  className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground transition-colors hover:bg-brand/90"
                >
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

export function TripJournal({
  tripId,
  tripName,
  days,
  disabled,
  disabledReason,
}: {
  tripId: string;
  /** Only used to label a queued offline save in the pending list, where the
   * date alone would not say which trip it belongs to. */
  tripName: string;
  days: JournalDay[];
  /** Read-only: the demo account, or a database without the journal table. */
  disabled: boolean;
  disabledReason: string | null;
}) {
  const [open, setOpen] = useState(false);
  const written = days.filter((day) => Boolean(day.body));
  // Nothing written yet means there is nothing to filter to, so the list opens
  // on every day and the switch has no work to do.
  const [showAll, setShowAll] = useState(written.length === 0);

  // No dates on the trip means no day structure to hang writing on, and
  // inventing one would be worse than the section simply not being there.
  if (days.length === 0) return null;
  // Nothing written and nothing writable is an empty state with no way out of
  // it, so the section stays absent instead.
  if (disabled && written.length === 0) return null;

  // Read-only surfaces have no reason to offer empty days: there is nothing to
  // write on them.
  const canShowAll = !disabled && written.length > 0;
  const visible = showAll && !disabled ? days : written;

  const entryLabel =
    written.length === 0
      ? "No entries yet"
      : `${written.length} ${written.length === 1 ? "entry" : "entries"}`;

  return (
    <section className="mt-8">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg py-1 text-left"
      >
        <BookOpenIcon className="size-4 shrink-0 text-foreground/40" />
        <span className="text-sm font-medium text-foreground/80">Journal</span>
        <span className="text-xs text-foreground/40">{entryLabel}</span>
        <span className="ml-auto shrink-0 text-foreground/40">
          <ChevronDownIcon
            className={cn("size-4 transition-transform", open && "rotate-180")}
          />
        </span>
      </button>

      {open ? (
        <div className="mt-2">
          <p className="mb-3 text-xs text-foreground/40">
            {disabled
              ? "A day by day account of this trip."
              : "Tap a day to write about it. Your words feed the trip story."}
          </p>
          {disabled && disabledReason ? (
            <p className="mb-3 text-xs text-foreground/35">{disabledReason}</p>
          ) : null}
          <ul className="flex flex-col gap-1.5">
            {visible.map((day) => (
              <DayRow
                key={day.date}
                day={day}
                tripId={tripId}
                tripName={tripName}
                disabled={disabled}
                disabledReason={disabledReason}
              />
            ))}
          </ul>
          {canShowAll ? (
            <button
              type="button"
              onClick={() => setShowAll((current) => !current)}
              className="mt-2 rounded-md px-1 py-1 text-xs text-foreground/45 transition-colors hover:text-foreground/80"
            >
              {showAll
                ? "Show only days with entries"
                : `Show all ${days.length} days`}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

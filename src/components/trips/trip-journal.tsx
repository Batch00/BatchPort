"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BookOpenIcon,
  CheckIcon,
  Loader2Icon,
  PencilLineIcon,
} from "lucide-react";

import { saveJournalEntryAction } from "@/lib/actions/journal";
import { journalDayLabel, journalPreview, type JournalDay } from "@/lib/journal";

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

const AUTOSAVE_MS = 1200;

function DayRow({
  day,
  tripId,
  disabled,
  disabledReason,
}: {
  day: JournalDay;
  tripId: string;
  disabled: boolean;
  disabledReason: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(day.body ?? "");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
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
      setSavedAt(Date.now());
    },
    [tripId, day.date],
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
  days,
  disabled,
  disabledReason,
}: {
  tripId: string;
  days: JournalDay[];
  /** Read-only: the demo account, or a database without the journal table. */
  disabled: boolean;
  disabledReason: string | null;
}) {
  // No dates on the trip means no day structure to hang writing on, and
  // inventing one would be worse than the section simply not being there.
  if (days.length === 0) return null;
  // Nothing written and nothing writable is an empty state with no way out of
  // it, so the section stays absent instead.
  if (disabled && days.every((day) => !day.body)) return null;

  return (
    <section className="mt-8">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground/80">
        <BookOpenIcon className="size-4 text-foreground/40" />
        Journal
      </h2>
      <p className="mb-3 text-xs text-foreground/40">
        {disabled
          ? "A day by day account of this trip."
          : "Tap a day to write about it. Your words feed the trip story."}
      </p>
      {disabled && disabledReason ? (
        <p className="mb-3 text-xs text-foreground/35">{disabledReason}</p>
      ) : null}
      <ul className="flex flex-col gap-1.5">
        {days.map((day) => (
          <DayRow
            key={day.date}
            day={day}
            tripId={tripId}
            disabled={disabled}
            disabledReason={disabledReason}
          />
        ))}
      </ul>
    </section>
  );
}

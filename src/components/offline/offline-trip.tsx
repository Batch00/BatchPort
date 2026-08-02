"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  BookOpenIcon,
  CheckIcon,
  ImageIcon,
} from "lucide-react";

import { CountryFlag } from "@/components/country-flag";
import { CategoryIcon } from "@/components/category-icon";
import { RatingDisplay } from "@/components/rating-display";
import { StatusBadge } from "@/components/trips/status-badge";
import { formatDateRange } from "@/lib/format";
import { journalDayLabel, journalDays, journalingApplies } from "@/lib/journal";
import { transportModeLabel } from "@/lib/transport";
import { enqueue } from "@/lib/offline/queue";
import { useOfflineQueue } from "@/lib/offline/use-offline";
import type { Category } from "@/lib/types";
import type { OfflineTrip } from "@/lib/offline/types";
import { cn } from "@/lib/utils";

// One trip, read from the snapshot, with the two writes that belong in the
// field: checking a planned experience off, and writing the day up.
//
// This is a second rendering of a trip rather than the trip page itself, and
// that is the honest cost of the snapshot approach: the trip page is a server
// component with eight queries behind it and cannot run without a server. What
// this owes in exchange is that everything it shows is real (nothing is
// approximated or omitted silently) and everything it offers to change is
// actually queued. It deliberately offers less: no photo management, no
// editing, no deletes, no reordering. Those need a connection and the shell
// does not pretend otherwise by rendering controls that would refuse.

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Queued writes referring to this experience, so a checked-off row can say so
 * even after a reload. The queue is the source of truth for "did that land",
 * not local component state. */
function useQueuedCheckoffs(): Set<string> {
  const { entries } = useOfflineQueue();
  return useMemo(() => {
    const ids = new Set<string>();
    for (const entry of entries) {
      if (entry.op.kind === "experience.checkoff") {
        ids.add(entry.op.experienceId);
      }
    }
    return ids;
  }, [entries]);
}

function useQueuedJournal(tripId: string): Map<string, string> {
  const { entries } = useOfflineQueue();
  return useMemo(() => {
    const byDate = new Map<string, string>();
    for (const entry of entries) {
      if (entry.op.kind === "journal.save" && entry.op.tripId === tripId) {
        byDate.set(entry.op.entryDate, entry.op.body);
      }
    }
    return byDate;
  }, [entries, tripId]);
}

function PendingChip({ label = "Queued" }: { label?: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300/80">
      {label}
    </span>
  );
}

function PlannedRow({
  experience,
  categories,
  defaultDate,
  readOnly,
}: {
  experience: OfflineTrip["destinations"][number]["experiences"][number];
  categories: Map<string, Category>;
  defaultDate: string;
  readOnly: boolean;
}) {
  const queued = useQueuedCheckoffs().has(experience.id);
  const [busy, setBusy] = useState(false);
  const category = experience.categoryId
    ? categories.get(experience.categoryId)
    : undefined;

  async function check() {
    if (readOnly || queued || busy) return;
    setBusy(true);
    const stored = await enqueue({
      kind: "experience.checkoff",
      experienceId: experience.id,
      experienceName: experience.name,
      rating: null,
      visitedDate: defaultDate,
    });
    setBusy(false);
    if (!stored) {
      // The write did not reach storage, so it is not queued and saying it was
      // would be the one thing this feature must never do.
      toast.error("Could not save that offline.", {
        description:
          "This browser is not storing offline changes. Try again once you have a connection.",
      });
      return;
    }
    toast.success(`"${experience.name}" checked off`, {
      description: "It will be sent when you are back online.",
    });
  }

  return (
    <li className="flex items-center gap-3 rounded-lg bg-white/[0.02] px-3 py-2 ring-1 ring-foreground/10">
      <button
        type="button"
        role="checkbox"
        aria-checked={queued}
        aria-label={`Mark ${experience.name} as done`}
        disabled={readOnly || busy}
        onClick={check}
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
          queued
            ? "border-brand bg-brand text-brand-foreground"
            : "border-foreground/30 hover:border-brand",
          readOnly && "cursor-default opacity-50 hover:border-foreground/30",
        )}
      >
        {queued ? <CheckIcon className="size-3" /> : null}
      </button>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm text-foreground/75">
          {experience.name}
        </span>
        {category ? (
          <span
            className="inline-flex items-center gap-1 text-xs text-foreground/40"
            style={category.color ? { color: category.color } : undefined}
          >
            <CategoryIcon icon={category.icon} className="size-3" />
            {category.label}
          </span>
        ) : null}
      </span>
      {experience.plannedDay ? (
        <span className="shrink-0 text-[11px] text-foreground/35">
          Day {experience.plannedDay}
        </span>
      ) : null}
      {queued ? <PendingChip /> : null}
    </li>
  );
}

function JournalDayRow({
  tripId,
  tripName,
  date,
  index,
  destinationName,
  body,
  queuedBody,
  readOnly,
}: {
  tripId: string;
  tripName: string;
  date: string;
  index: number;
  destinationName: string | null;
  body: string | null;
  queuedBody: string | undefined;
  readOnly: boolean;
}) {
  const current = queuedBody ?? body ?? "";
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(current);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (readOnly) return;
    if (text.trim() === current.trim()) {
      setOpen(false);
      return;
    }
    setSaving(true);
    const stored = await enqueue({
      kind: "journal.save",
      tripId,
      tripName,
      entryDate: date,
      body: text,
    });
    setSaving(false);
    if (!stored) {
      // Never close the editor on a failed save: the text on screen is the
      // only copy that exists.
      toast.error("Could not save that offline.", {
        description: "Your text is still here. Keep it open until you reconnect.",
      });
      return;
    }
    setOpen(false);
  }

  const hasText = current.trim().length > 0;

  return (
    <li className="rounded-lg bg-white/[0.02] ring-1 ring-foreground/[0.07]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
      >
        <span className="mt-0.5 shrink-0 text-xs tabular-nums text-foreground/40">
          {index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm text-foreground/85">
              {journalDayLabel(date)}
            </span>
            {destinationName ? (
              <span className="min-w-0 break-words text-xs text-foreground/45">
                {destinationName}
              </span>
            ) : null}
            {queuedBody !== undefined ? <PendingChip /> : null}
          </span>
          {!open ? (
            <span className="mt-0.5 block break-words text-xs text-foreground/50">
              {hasText ? (
                current.trim().split("\n")[0]
              ) : (
                <span className="text-foreground/30">
                  {readOnly ? "Nothing written" : "Write about this day"}
                </span>
              )}
            </span>
          ) : null}
        </span>
      </button>

      {open ? (
        <div className="border-t border-white/[0.06] px-3 py-2.5">
          {readOnly ? (
            <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/80">
              {hasText ? current : "Nothing written for this day."}
            </p>
          ) : (
            <>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={5}
                autoFocus
                placeholder="What happened today?"
                className="w-full resize-y rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm leading-relaxed text-foreground outline-none placeholder:text-foreground/25 focus:border-brand/60"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-[11px] text-foreground/35">
                  Queued on this device until you reconnect.
                </span>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground transition-colors hover:bg-brand/90 disabled:opacity-60"
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

export function OfflineTripView({
  trip,
  categories,
  readOnly,
  onBack,
}: {
  trip: OfflineTrip;
  categories: Category[];
  readOnly: boolean;
  onBack: () => void;
}) {
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );
  const legByDestination = useMemo(
    () => new Map(trip.legs.map((leg) => [leg.destinationId, leg.mode])),
    [trip.legs],
  );
  const queuedJournal = useQueuedJournal(trip.id);

  const days = useMemo(
    () =>
      journalingApplies(trip.status)
        ? journalDays(
            { start_date: trip.startDate, end_date: trip.endDate },
            trip.destinations.map((destination) => ({
              id: destination.id,
              name: destination.name,
              arrival_date: destination.arrivalDate,
              departure_date: destination.departureDate,
            })),
            trip.journal.map((entry) => ({
              entry_date: entry.date,
              body: entry.body,
            })),
          )
        : [],
    [trip],
  );

  const [showAllDays, setShowAllDays] = useState(false);
  const writtenDays = days.filter(
    (day) => day.body !== null || queuedJournal.has(day.date),
  );
  const visibleDays = showAllDays || writtenDays.length === 0 ? days : writtenDays;

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-foreground/60 transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        All trips
      </button>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight">
          {trip.name}
        </h1>
        <StatusBadge status={trip.status} />
      </div>
      <p className="mt-1 text-sm text-foreground/55">
        {formatDateRange(trip.startDate, trip.endDate)}
      </p>
      {trip.notes ? (
        <p className="mt-4 max-w-prose whitespace-pre-line text-sm text-foreground/70">
          {trip.notes}
        </p>
      ) : null}

      <h2 className="mb-3 mt-8 text-sm font-medium text-foreground/80">
        Destinations
      </h2>

      {trip.destinations.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 px-6 py-10 text-center text-sm text-foreground/50">
          No stops on this trip.
        </p>
      ) : (
        <ol className="flex flex-col gap-6">
          {trip.destinations.map((destination, index) => {
            const mode = legByDestination.get(destination.id) ?? null;
            const done = destination.experiences.filter(
              (experience) => experience.status !== "planned",
            );
            const planned = destination.experiences.filter(
              (experience) => experience.status === "planned",
            );
            const defaultDate = destination.arrivalDate ?? todayIso();
            return (
              <li key={destination.id}>
                {mode ? (
                  <p className="mb-1.5 pl-1 text-xs text-foreground/40">
                    {index === 0 ? "From home by " : "By "}
                    {transportModeLabel(mode).toLowerCase()}
                  </p>
                ) : null}
                <div className="flex items-center gap-4 rounded-xl bg-white/[0.02] p-3 ring-1 ring-foreground/10">
                  <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-white/5">
                    {destination.coverThumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={destination.coverThumbUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center text-foreground/25">
                        <ImageIcon className="size-5" />
                      </div>
                    )}
                    <span className="absolute left-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-black/60 text-[0.65rem] text-white">
                      {index + 1}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="flex flex-wrap items-center gap-2 font-medium">
                      <span className="break-words">{destination.name}</span>
                      {destination.countryCode ? (
                        <span className="text-sm text-foreground/50">
                          <CountryFlag code={destination.countryCode} />{" "}
                          {destination.countryCode}
                        </span>
                      ) : null}
                    </h3>
                    <p className="text-xs text-foreground/45">
                      {formatDateRange(
                        destination.arrivalDate,
                        destination.departureDate,
                      )}
                    </p>
                  </div>
                </div>

                {planned.length > 0 ? (
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {planned.map((experience) => (
                      <PlannedRow
                        key={experience.id}
                        experience={experience}
                        categories={categoryById}
                        defaultDate={defaultDate}
                        readOnly={readOnly}
                      />
                    ))}
                  </ul>
                ) : null}

                {done.length > 0 ? (
                  <ul className="mt-2 flex flex-col gap-1">
                    {done.map((experience) => {
                      const category = experience.categoryId
                        ? categoryById.get(experience.categoryId)
                        : undefined;
                      return (
                        <li
                          key={experience.id}
                          className="flex items-center gap-2 px-3 py-1 text-sm"
                        >
                          <span
                            className="shrink-0 text-foreground/35"
                            style={
                              category?.color
                                ? { color: category.color }
                                : undefined
                            }
                          >
                            <CategoryIcon
                              icon={category?.icon ?? null}
                              className="size-3.5"
                            />
                          </span>
                          <span className="min-w-0 flex-1 break-words text-foreground/70">
                            {experience.name}
                          </span>
                          {experience.rating ? (
                            <RatingDisplay
                              rating={experience.rating}
                              size={12}
                            />
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {days.length > 0 ? (
        <section className="mt-10">
          <div className="mb-3 flex items-center gap-2">
            <BookOpenIcon className="size-4 shrink-0 text-foreground/40" />
            <span className="text-sm font-medium text-foreground/80">
              Journal
            </span>
            <span className="text-xs text-foreground/40">
              {writtenDays.length === 0
                ? "No entries yet"
                : `${writtenDays.length} ${
                    writtenDays.length === 1 ? "entry" : "entries"
                  }`}
            </span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {visibleDays.map((day) => (
              <JournalDayRow
                key={day.date}
                tripId={trip.id}
                tripName={trip.name}
                date={day.date}
                index={day.index}
                destinationName={day.destinationName}
                body={day.body}
                queuedBody={queuedJournal.get(day.date)}
                readOnly={readOnly}
              />
            ))}
          </ul>
          {!readOnly && writtenDays.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowAllDays((value) => !value)}
              className="mt-2 rounded-md px-1 py-1 text-xs text-foreground/45 transition-colors hover:text-foreground/80"
            >
              {showAllDays
                ? "Show only days with entries"
                : `Show all ${days.length} days`}
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

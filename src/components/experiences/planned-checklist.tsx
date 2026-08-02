"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { CheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RatingInput } from "@/components/rating-input";
import { CategoryIcon } from "@/components/category-icon";
import { InfoTip } from "@/components/ui/info-tip";
import { markExperienceDoneAction } from "@/lib/actions/experiences";
import { enqueue } from "@/lib/offline/queue";
import { useOnlineStatus } from "@/lib/offline/use-offline";
import { cn } from "@/lib/utils";

// The checklist row for a planned experience, shared by the destination page
// and the trip planning workspace. Tapping the circle checks the idea off
// immediately (optimistic, done either way), then a lightweight inline
// follow-up offers an optional rating and date. Saving or skipping both end
// with onChanged() so the parent refreshes server data.

export interface PlannedRowData {
  id: string;
  name: string;
  notes?: string | null;
  categoryLabel?: string | null;
  categoryIcon?: string | null;
  categoryColor?: string | null;
}

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function PlannedExperienceRow({
  experience,
  disabled = false,
  defaultDate,
  onChanged,
  menu,
  dragging = false,
  className,
}: {
  experience: PlannedRowData;
  /** Read-only surfaces (demo account): the checkbox does nothing. */
  disabled?: boolean;
  /** Date the checkoff follow-up pre-fills (a day-assigned experience uses its
   * day's date instead of today). Falls back to today. */
  defaultDate?: string;
  onChanged: () => void;
  /** Optional right-aligned actions (edit and delete menus). */
  menu?: ReactNode;
  /** Dimmed while this row is the one being dragged in the day board. */
  dragging?: boolean;
  className?: string;
}) {
  const [checked, setChecked] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [visitedDate, setVisitedDate] = useState(() => defaultDate ?? todayIso());
  const [saving, setSaving] = useState(false);
  const [queued, setQueued] = useState(false);
  const online = useOnlineStatus();

  // Offline, the whole flow is the same shape with the queue standing in for
  // the server: the row flips, the follow-up opens, and the rating lands on a
  // second queued write that replays after the first. What must not happen is
  // the row flipping when the queue did not accept the write, so a storage
  // failure puts it back and says so.
  async function queueCheckoff(
    extras: { rating: number | null; visitedDate: string | null },
  ): Promise<boolean> {
    const stored = await enqueue({
      kind: "experience.checkoff",
      experienceId: experience.id,
      experienceName: experience.name,
      rating: extras.rating,
      visitedDate: extras.visitedDate,
    });
    if (!stored) {
      toast.error("Could not save that offline.", {
        description:
          "This browser is not storing offline changes, so nothing was recorded.",
      });
      return false;
    }
    setQueued(true);
    return true;
  }

  async function handleCheck() {
    if (disabled || checked) return;
    // Optimistic: the row flips and the follow-up opens before the server
    // confirms. The experience is done from this moment; the follow-up only
    // decorates it. This first write skips revalidation on purpose: revalidating
    // now would re-render the parent, move this experience out of the planned
    // list, and unmount the row before the user can pick a rating or date. The
    // follow-up's Save (or Skip) commits with revalidation instead.
    setChecked(true);
    setFollowUpOpen(true);

    if (!online) {
      const ok = await queueCheckoff({ rating: null, visitedDate: null });
      if (!ok) {
        setChecked(false);
        setFollowUpOpen(false);
      }
      return;
    }

    const result = await markExperienceDoneAction(
      experience.id,
      { rating: null, visitedDate: null },
      { revalidate: false },
    );
    if ("error" in result) {
      toast.error(result.error);
      setChecked(false);
      setFollowUpOpen(false);
    }
  }

  async function handleSaveFollowUp() {
    setSaving(true);

    if (!online) {
      const ok = await queueCheckoff({
        rating: rating > 0 ? rating : null,
        visitedDate: visitedDate || null,
      });
      setSaving(false);
      if (!ok) return;
      setFollowUpOpen(false);
      // No onChanged(): there is no server data to refresh, and re-rendering
      // the parent would drop the queued row out of the planned list as if it
      // had already been sent.
      return;
    }

    const result = await markExperienceDoneAction(experience.id, {
      rating: rating > 0 ? rating : null,
      visitedDate: visitedDate || null,
    });
    setSaving(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    setFollowUpOpen(false);
    onChanged();
  }

  // The check already persisted the done status (without revalidating); Skip
  // just leaves it done with no rating and refreshes the parent's server data.
  function handleSkip() {
    setFollowUpOpen(false);
    if (!queued) onChanged();
  }

  return (
    <li
      className={cn(
        "rounded-lg bg-white/[0.02] ring-1 ring-foreground/10 transition-opacity",
        dragging && "opacity-50",
        className,
      )}
    >
      <div className="flex items-center gap-3 px-3 py-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          aria-label={`Mark ${experience.name} as done`}
          disabled={disabled}
          onClick={handleCheck}
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
            checked
              ? "border-brand bg-brand text-brand-foreground"
              : "border-foreground/30 hover:border-brand",
            disabled && "cursor-default opacity-50 hover:border-foreground/30",
          )}
        >
          {checked ? <CheckIcon className="size-3" /> : null}
        </button>
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "break-words text-sm text-foreground/75",
              checked && "text-foreground",
            )}
          >
            {experience.name}
            {queued ? (
              <span className="ml-2 inline-flex shrink-0 items-center rounded-full bg-amber-400/10 px-1.5 py-0.5 align-middle text-[10px] font-medium text-amber-300/80">
                Queued
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-foreground/40">
            {experience.categoryLabel ? (
              <span
                className="inline-flex items-center gap-1"
                style={
                  experience.categoryColor
                    ? { color: experience.categoryColor }
                    : undefined
                }
              >
                <CategoryIcon
                  icon={experience.categoryIcon}
                  className="size-3"
                />
                {experience.categoryLabel}
              </span>
            ) : null}
          </div>
          {experience.notes ? (
            <p className="mt-0.5 whitespace-pre-line break-words text-xs text-foreground/50">
              {experience.notes}
            </p>
          ) : null}
        </div>
        {menu}
      </div>

      {followUpOpen ? (
        <div className="border-t border-white/10 px-3 py-2.5">
          <p className="text-xs text-foreground/60">
            {queued
              ? "Done! Saved on this device, sending when you reconnect. Add a rating or date (optional):"
              : "Done! Add a rating or date (optional):"}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            <RatingInput value={rating} onChange={setRating} size={20} />
            <Input
              type="date"
              value={visitedDate}
              onChange={(event) => setVisitedDate(event.target.value)}
              aria-label="Visited date"
              className="h-8 w-36 text-xs"
            />
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                disabled={saving}
                onClick={handleSkip}
              >
                Skip
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7 bg-brand text-xs text-brand-foreground hover:bg-brand/90"
                disabled={saving}
                onClick={handleSaveFollowUp}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/** The read-only checklist look for share and demo surfaces: same silhouette,
 * no interactivity. */
export function PlannedExperienceRowReadOnly({
  name,
  categoryLabel,
  categoryIcon,
  categoryColor,
}: {
  name: string;
  categoryLabel?: string | null;
  categoryIcon?: string | null;
  categoryColor?: string | null;
}) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span
        aria-hidden
        className="size-4 shrink-0 rounded-full border border-foreground/25"
      />
      <span className="min-w-0 flex-1 break-words text-foreground/60">
        {name}
      </span>
      {categoryLabel ? (
        <InfoTip
          tip={categoryLabel}
          label={`Category: ${categoryLabel}`}
          side="left"
          className="flex size-5 shrink-0 items-center justify-center rounded bg-white/5"
        >
          <span style={categoryColor ? { color: categoryColor } : undefined}>
            <CategoryIcon icon={categoryIcon} className="size-3" />
          </span>
        </InfoTip>
      ) : null}
    </li>
  );
}

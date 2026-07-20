"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { CheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RatingInput } from "@/components/rating-input";
import { CategoryIcon } from "@/components/category-icon";
import { markExperienceDoneAction } from "@/lib/actions/experiences";
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

  async function handleCheck() {
    if (disabled || checked) return;
    // Optimistic: the row flips and the follow-up opens before the server
    // confirms. The experience is done from this moment; the follow-up only
    // decorates it.
    setChecked(true);
    setFollowUpOpen(true);
    const result = await markExperienceDoneAction(experience.id, {
      rating: null,
      visitedDate: null,
    });
    if ("error" in result) {
      toast.error(result.error);
      setChecked(false);
      setFollowUpOpen(false);
    }
  }

  async function handleSaveFollowUp() {
    setSaving(true);
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

  function handleSkip() {
    setFollowUpOpen(false);
    onChanged();
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
            Done! Add a rating or date (optional):
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
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded bg-white/5"
          style={categoryColor ? { color: categoryColor } : undefined}
          title={categoryLabel}
        >
          <CategoryIcon icon={categoryIcon} className="size-3" />
        </span>
      ) : null}
    </li>
  );
}

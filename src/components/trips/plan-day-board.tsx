"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CalendarDaysIcon, GripVerticalIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PlannedExperienceRow } from "@/components/experiences/planned-checklist";
import { setExperiencePlannedDayAction } from "@/lib/actions/experiences";
import {
  experiencePoint,
  groupByPlanDay,
  planDayIso,
  planDayLabel,
  proximitySummary,
} from "@/lib/day-plan";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { cn } from "@/lib/utils";
import type { Category, Experience } from "@/lib/types";

// The day-planning board for a dated destination on a planned or ongoing trip.
// Planned experiences sit in an "Unassigned" group plus one group per day of
// the stay; they move between groups by dragging a grip handle or via a day
// picker in each row's menu (the mobile- and keyboard-reliable path).
// Assignment is optimistic, reverting on a failed server write.

interface PlanDayBoardProps {
  /** Arrival date (day 1); guaranteed present by the caller. */
  arrival: string;
  dayCount: number;
  /** The day today falls on for an ongoing trip, else null (subtle highlight). */
  todayDay: number | null;
  planned: Experience[];
  categories: Category[];
  isDemo: boolean;
  onChanged: () => void;
}

function categoryOf(
  experience: Experience,
  categories: Category[],
): Category | undefined {
  return experience.category_id
    ? categories.find((category) => category.id === experience.category_id)
    : undefined;
}

export function PlanDayBoard({
  arrival,
  dayCount,
  todayDay,
  planned,
  categories,
  isDemo,
  onChanged,
}: PlanDayBoardProps) {
  // Optimistic day overrides keyed by experience id (value null = unassigned),
  // applied over the server-provided planned_day until the refresh lands.
  const [overrides, setOverrides] = useState<Map<string, number | null>>(
    new Map(),
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<number | null>(null);

  // Reset optimistic state whenever the underlying experience set changes (a
  // refresh confirmed the writes). Keyed by id+day so a committed assignment
  // clears its override.
  const serverKey = planned
    .map((experience) => `${experience.id}:${experience.planned_day ?? 0}`)
    .join("|");
  const [prevKey, setPrevKey] = useState(serverKey);
  if (prevKey !== serverKey) {
    setPrevKey(serverKey);
    if (overrides.size > 0) setOverrides(new Map());
  }

  const effectiveDay = (experience: Experience): number | null => {
    const override = overrides.get(experience.id);
    if (override !== undefined) return override;
    return experience.planned_day;
  };

  const groups = groupByPlanDay(planned, effectiveDay, dayCount);

  const groupRefs = useRef(new Map<number, HTMLDivElement>());
  const dragState = useRef<{
    id: string;
    fromDay: number | null;
    startX: number;
    startY: number;
    activated: boolean;
    longPress: number | null;
    // The current drop target, written synchronously on every move so the
    // pointerup commit reads a fresh value rather than a stale closure of the
    // dragOverGroup state.
    overGroup: number | null;
  } | null>(null);
  const listenersRef = useRef<{
    move: (event: PointerEvent) => void;
    up: () => void;
    preventTouch: (event: TouchEvent) => void;
  } | null>(null);

  async function assign(
    experienceId: string,
    fromDay: number | null,
    toDay: number | null,
  ) {
    if (fromDay === toDay) return;
    if (isDemo) {
      toast.error(DEMO_READONLY_MESSAGE);
      return;
    }
    setOverrides((current) => new Map(current).set(experienceId, toDay));
    const result = await setExperiencePlannedDayAction(experienceId, toDay);
    if ("error" in result) {
      toast.error(result.error);
      setOverrides((current) => {
        const next = new Map(current);
        next.delete(experienceId);
        return next;
      });
      return;
    }
    onChanged();
  }

  function groupAtPoint(x: number, y: number): number | null {
    for (const [day, element] of groupRefs.current) {
      const rect = element.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return day;
      }
    }
    return null;
  }

  function endDrag(commit: boolean) {
    const state = dragState.current;
    const listeners = listenersRef.current;
    if (listeners) {
      window.removeEventListener("pointermove", listeners.move);
      window.removeEventListener("pointerup", listeners.up);
      window.removeEventListener("pointercancel", listeners.up);
      document.removeEventListener("touchmove", listeners.preventTouch);
    }
    listenersRef.current = null;
    if (state?.longPress !== null && state?.longPress !== undefined) {
      window.clearTimeout(state.longPress);
    }
    const target = state?.overGroup ?? null;
    dragState.current = null;
    setDraggingId(null);
    setDragOverGroup(null);
    if (commit && state?.activated && target !== null) {
      void assign(state.id, state.fromDay, target);
    }
  }

  function beginDrag(
    event: React.PointerEvent,
    experienceId: string,
    fromDay: number | null,
  ) {
    if (isDemo || dragState.current) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    const isMouse = event.pointerType === "mouse";
    const state = {
      id: experienceId,
      fromDay,
      startX: event.clientX,
      startY: event.clientY,
      activated: false,
      longPress: null as number | null,
      overGroup: null as number | null,
    };
    dragState.current = state;

    const activate = () => {
      if (!dragState.current || dragState.current.activated) return;
      dragState.current.activated = true;
      setDraggingId(experienceId);
    };

    const move = (moveEvent: PointerEvent) => {
      const current = dragState.current;
      if (!current) return;
      if (!current.activated) {
        const distance = Math.hypot(
          moveEvent.clientX - current.startX,
          moveEvent.clientY - current.startY,
        );
        if (isMouse) {
          if (distance > 6) activate();
        } else if (distance > 12) {
          // A touch that moves before the long press is a scroll, not a drag.
          endDrag(false);
          return;
        }
        if (!dragState.current?.activated) return;
      }
      const over = groupAtPoint(moveEvent.clientX, moveEvent.clientY);
      if (dragState.current) dragState.current.overGroup = over;
      setDragOverGroup(over);
    };
    const up = () => endDrag(true);
    const preventTouch = (touchEvent: TouchEvent) => {
      if (dragState.current?.activated) touchEvent.preventDefault();
    };

    listenersRef.current = { move, up, preventTouch };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    if (!isMouse) {
      document.addEventListener("touchmove", preventTouch, { passive: false });
      state.longPress = window.setTimeout(activate, 250);
    }
  }

  // Tear down any stray global listeners if the board unmounts mid-drag.
  useEffect(() => {
    return () => {
      const listeners = listenersRef.current;
      if (listeners) {
        window.removeEventListener("pointermove", listeners.move);
        window.removeEventListener("pointerup", listeners.up);
        window.removeEventListener("pointercancel", listeners.up);
        document.removeEventListener("touchmove", listeners.preventTouch);
      }
    };
  }, []);

  function dayPickerMenu(experience: Experience, currentDay: number | null) {
    if (isDemo) return undefined;
    return (
      <div className="flex shrink-0 items-center">
        <button
          type="button"
          aria-label={`Drag ${experience.name} to another day`}
          onPointerDown={(event) =>
            beginDrag(event, experience.id, currentDay)
          }
          className="hidden cursor-grab touch-none rounded-md p-1.5 text-foreground/30 transition-colors hover:bg-white/5 hover:text-foreground/70 active:cursor-grabbing sm:block"
        >
          <GripVerticalIcon className="size-3.5" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Assign ${experience.name} to a day`}
              className="rounded-md p-1.5 text-foreground/30 transition-colors hover:bg-white/5 hover:text-foreground/70"
            >
              <CalendarDaysIcon className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
            <DropdownMenuItem
              onSelect={() => assign(experience.id, currentDay, null)}
              className={cn(currentDay === null && "text-brand")}
            >
              Unassigned
            </DropdownMenuItem>
            {Array.from({ length: dayCount }, (_, index) => index + 1).map(
              (day) => (
                <DropdownMenuItem
                  key={day}
                  onSelect={() => assign(experience.id, currentDay, day)}
                  className={cn(currentDay === day && "text-brand")}
                >
                  Day {day} · {planDayLabel(arrival, day)}
                </DropdownMenuItem>
              ),
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  function renderGroup(day: number, items: Experience[]) {
    const isUnassigned = day === 0;
    // The unassigned group is only worth showing when it holds items or is the
    // active drop target; empty day groups always show as a slot to plan into.
    if (isUnassigned && items.length === 0 && dragOverGroup !== 0) return null;

    const points = items
      .map((experience) => experiencePoint(experience.geom))
      .filter((point): point is { lat: number; lng: number } => point !== null);
    const proximity = proximitySummary(points);
    const isToday = !isUnassigned && day === todayDay;
    const isDropTarget = dragOverGroup === day && draggingId !== null;

    return (
      <div
        key={day}
        ref={(element) => {
          if (element) groupRefs.current.set(day, element);
          else groupRefs.current.delete(day);
        }}
        className={cn(
          "rounded-lg px-2 py-1.5 transition-colors",
          isDropTarget && "bg-brand/10 ring-1 ring-brand/40",
          isToday && !isDropTarget && "bg-brand/[0.06] ring-1 ring-brand/25",
        )}
      >
        <div className="mb-1 flex items-center justify-between gap-2 px-1">
          <span
            className={cn(
              "text-[11px] font-medium uppercase tracking-wide",
              isToday ? "text-brand" : "text-foreground/40",
            )}
          >
            {isUnassigned
              ? "Unassigned"
              : `Day ${day} · ${planDayLabel(arrival, day)}`}
            {isToday ? " · Today" : ""}
          </span>
          {proximity ? (
            <span className="shrink-0 text-[10px] text-foreground/35">
              {proximity}
            </span>
          ) : null}
        </div>
        {items.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {items.map((experience) => {
              const category = categoryOf(experience, categories);
              return (
                <PlannedExperienceRow
                  key={experience.id}
                  experience={{
                    id: experience.id,
                    name: experience.name,
                    notes: experience.notes,
                    categoryLabel: category?.label,
                    categoryIcon: category?.icon,
                    categoryColor: category?.color,
                  }}
                  defaultDate={
                    isUnassigned ? undefined : planDayIso(arrival, day)
                  }
                  dragging={draggingId === experience.id}
                  onChanged={onChanged}
                  menu={dayPickerMenu(experience, isUnassigned ? null : day)}
                />
              );
            })}
          </ul>
        ) : (
          <p className="px-1 py-1 text-xs text-foreground/30">
            {isDropTarget ? "Drop here" : "Nothing planned yet"}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {groups.map((items, day) => renderGroup(day, items))}
    </div>
  );
}

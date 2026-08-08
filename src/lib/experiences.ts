import { cache } from "react";

import { createClient } from "@/utils/supabase/server";
import { requireUser } from "@/lib/current-user";
import { featuredRankOf } from "@/lib/curation";
import { pointEwkt } from "@/lib/geo";
import type { Category, Experience, ExperienceStatus } from "@/lib/types";

// Server-side data access for experiences and the static category list.

export interface ExperienceInput {
  name: string;
  category_id: string | null;
  rating: number | null;
  visited_date: string | null;
  notes: string | null;
  status: ExperienceStatus;
  // Specific coordinates from a POI search, or null to leave the geom untouched.
  lat: number | null;
  lng: number | null;
}

// Experience reads select * so a missing status column (migration not yet run)
// degrades to undefined instead of erroring; normalizeExperience fills it in.
// The geom column rides along as a short WKB hex string the UI ignores.

// Rows written before the status column existed carry no status; they are all
// logged activities, so missing reads as "done". Likewise planned_day predates
// nothing being assigned, so missing reads as null (unassigned).
export function normalizeExperience(
  row: Omit<Experience, "status" | "planned_day" | "featured_rank"> & {
    status?: string | null;
    planned_day?: number | null;
    featured_rank?: number | null;
  },
): Experience {
  return {
    ...row,
    status: row.status === "planned" ? "planned" : "done",
    planned_day:
      typeof row.planned_day === "number" ? row.planned_day : null,
    featured_rank: featuredRankOf(row.featured_rank),
  } as Experience;
}

// PostgREST reports a payload column that does not exist as PGRST204. Until
// the status column migration has run, writes retry without it so the rest of
// the experience still saves.
function isMissingColumn(error: { code?: string } | null): boolean {
  return error?.code === "PGRST204";
}

function withoutStatus<T extends { status: unknown }>(
  row: T,
): Omit<T, "status"> {
  const clone: Record<string, unknown> = { ...row };
  delete clone.status;
  return clone as Omit<T, "status">;
}

// Display order for a destination's experiences: visited date ascending with
// undated ones last, then creation time. Shared by the trip and destination
// data layers so both surfaces list experiences identically. Planned items
// have no visited date, so they naturally group after dated done ones; the
// UI splits the two statuses before rendering anyway.
export function sortExperiences(a: Experience, b: Experience): number {
  const aDate = a.visited_date ?? "";
  const bDate = b.visited_date ?? "";
  if (aDate !== bDate) {
    if (!aDate) return 1;
    if (!bDate) return -1;
    return aDate < bDate ? -1 : 1;
  }
  return a.created_at < b.created_at ? -1 : 1;
}

export async function createExperience(
  destinationId: string,
  input: ExperienceInput,
): Promise<Experience> {
  const { supabase, user } = await requireUser();
  const hasCoords = input.lat !== null && input.lng !== null;
  const row = {
    destination_id: destinationId,
    user_id: user.id,
    name: input.name,
    category_id: input.category_id,
    rating: input.rating,
    visited_date: input.visited_date,
    notes: input.notes,
    status: input.status,
    geom: hasCoords
      ? pointEwkt(input.lng as number, input.lat as number)
      : null,
  };
  let { data, error } = await supabase
    .from("experiences")
    .insert(row)
    .select("*")
    .single();
  if (isMissingColumn(error)) {
    ({ data, error } = await supabase
      .from("experiences")
      .insert(withoutStatus(row))
      .select("*")
      .single());
  }
  if (error) throw error;
  return normalizeExperience(data as Experience);
}

export async function updateExperience(
  id: string,
  input: ExperienceInput,
): Promise<Experience> {
  const { supabase } = await requireUser();
  const update: Record<string, unknown> = {
    name: input.name,
    category_id: input.category_id,
    rating: input.rating,
    visited_date: input.visited_date,
    notes: input.notes,
    status: input.status,
  };
  // Only write the geom when new coordinates were chosen, so a plain edit does
  // not erase a previously stored location.
  if (input.lat !== null && input.lng !== null) {
    update.geom = pointEwkt(input.lng, input.lat);
  }
  let { data, error } = await supabase
    .from("experiences")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (isMissingColumn(error)) {
    ({ data, error } = await supabase
      .from("experiences")
      .update(withoutStatus(update as { status: unknown }))
      .eq("id", id)
      .select("*")
      .single());
  }
  if (error) throw error;
  return normalizeExperience(data as Experience);
}

/** Check a planned experience off as done, optionally recording the rating
 * and visited date the follow-up collects. Idempotent: calling it on an
 * already-done experience just applies the provided fields. */
export async function markExperienceDone(
  id: string,
  extras: { rating: number | null; visited_date: string | null },
): Promise<void> {
  const { supabase } = await requireUser();
  const update: Record<string, unknown> = { status: "done" };
  if (extras.rating !== null) update.rating = extras.rating;
  if (extras.visited_date !== null) update.visited_date = extras.visited_date;
  let { error } = await supabase
    .from("experiences")
    .update(update)
    .eq("id", id);
  if (isMissingColumn(error)) {
    // Pre-migration every experience already reads as done; still apply the
    // rating and date when the follow-up provided them.
    const rest = withoutStatus(update as { status: unknown });
    if (Object.keys(rest).length === 0) return;
    ({ error } = await supabase.from("experiences").update(rest).eq("id", id));
  }
  if (error) throw error;
}

/** Undo a checkoff: back to planned, clearing the rating and visited date
 * (they only make sense on done experiences). Requires the status column;
 * pre-migration this fails rather than silently wiping the rating. */
export async function markExperiencePlanned(id: string): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("experiences")
    .update({ status: "planned", rating: null, visited_date: null })
    .eq("id", id);
  if (error) throw error;
}

/** Assign a planned experience to a plan day (1 = arrival date) or back to
 * unassigned (null). Requires the planned_day column; pre-migration this
 * throws and the action surfaces a friendly error instead of pretending. */
export async function setExperiencePlannedDay(
  id: string,
  day: number | null,
): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("experiences")
    .update({ planned_day: day })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteExperience(id: string): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("experiences").delete().eq("id", id);
  if (error) throw error;
}

// Categories are static reference data readable by everyone, so this does not
// require a session. Server components fetch it once and pass the list to the
// experience form as props. cache() dedupes repeat calls within one request.
export const getCategories = cache(async (): Promise<Category[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id,slug,label,icon,color,sort_order")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Category[];
});

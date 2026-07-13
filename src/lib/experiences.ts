import { cache } from "react";

import { createClient } from "@/utils/supabase/server";
import { requireUser } from "@/lib/current-user";
import { pointEwkt } from "@/lib/geo";
import type { Category, Experience } from "@/lib/types";

// Server-side data access for experiences and the static category list.

export interface ExperienceInput {
  name: string;
  category_id: string | null;
  rating: number | null;
  visited_date: string | null;
  notes: string | null;
  // Specific coordinates from a POI search, or null to leave the geom untouched.
  lat: number | null;
  lng: number | null;
}

// Explicit column list so reads never pull the experiences geom column (WKB
// bytes the UI does not render).
export const EXPERIENCE_COLUMNS =
  "id,destination_id,user_id,name,category_id,rating,visited_date,notes,created_at,updated_at";

// Display order for a destination's experiences: visited date ascending with
// undated ones last, then creation time. Shared by the trip and destination
// data layers so both surfaces list experiences identically.
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
  const { data, error } = await supabase
    .from("experiences")
    .insert({
      destination_id: destinationId,
      user_id: user.id,
      name: input.name,
      category_id: input.category_id,
      rating: input.rating,
      visited_date: input.visited_date,
      notes: input.notes,
      geom: hasCoords
        ? pointEwkt(input.lng as number, input.lat as number)
        : null,
    })
    .select(EXPERIENCE_COLUMNS)
    .single();
  if (error) throw error;
  return data as Experience;
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
  };
  // Only write the geom when new coordinates were chosen, so a plain edit does
  // not erase a previously stored location.
  if (input.lat !== null && input.lng !== null) {
    update.geom = pointEwkt(input.lng, input.lat);
  }
  const { data, error } = await supabase
    .from("experiences")
    .update(update)
    .eq("id", id)
    .select(EXPERIENCE_COLUMNS)
    .single();
  if (error) throw error;
  return data as Experience;
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

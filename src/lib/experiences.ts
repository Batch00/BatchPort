import { createClient } from "@/utils/supabase/server";
import { requireUser } from "@/lib/current-user";
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

// PostgREST accepts EWKT for the geom geography(Point) column.
function pointEwkt(lng: number, lat: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
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
    .select("*")
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
    .select("*")
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
// experience form as props.
export async function getCategories(): Promise<Category[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Category[];
}

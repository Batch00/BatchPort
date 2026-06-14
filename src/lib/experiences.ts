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
}

export async function createExperience(
  destinationId: string,
  input: ExperienceInput,
): Promise<Experience> {
  const { supabase, user } = await requireUser();
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
  const { data, error } = await supabase
    .from("experiences")
    .update({
      name: input.name,
      category_id: input.category_id,
      rating: input.rating,
      visited_date: input.visited_date,
      notes: input.notes,
    })
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

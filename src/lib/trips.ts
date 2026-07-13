import { requireUser } from "@/lib/current-user";
import { DESTINATION_COLUMNS } from "@/lib/destinations";
import { EXPERIENCE_COLUMNS, sortExperiences } from "@/lib/experiences";
import type {
  Trip,
  TripStatus,
  TripWithDestinations,
  DestinationWithExperiences,
} from "@/lib/types";

// Server-side data access for trips. These functions run with the user's
// session, so row-level security scopes every query to the current user. They
// do not check the demo guard: the server actions that wrap mutations do.

export interface TripInput {
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: TripStatus;
  notes: string | null;
}

// A lightweight trip picker shape for dropdowns (the bucket list's fulfill
// dialog). Selects only the columns the picker shows.
export interface TripOption {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
}

export async function getTripOptions(): Promise<TripOption[]> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("trips")
    .select("id, name, start_date, end_date")
    .order("start_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as TripOption[];
}

// A single trip with its destinations (ordered by order_index) and each
// destination's experiences. Returns null when not found or not owned.
export async function getTrip(id: string): Promise<TripWithDestinations | null> {
  const { supabase } = await requireUser();

  // Both queries filter by the id from the URL, so they run in parallel
  // instead of waiting on the trip row before fetching its destinations.
  const [tripResult, destResult] = await Promise.all([
    supabase.from("trips").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("destinations")
      .select(`${DESTINATION_COLUMNS}, experiences(${EXPERIENCE_COLUMNS})`)
      .eq("trip_id", id)
      .order("order_index", { ascending: true }),
  ]);
  const { data: trip, error } = tripResult;
  if (error) throw error;
  if (!trip) return null;

  const { data: destinations, error: destError } = destResult;
  if (destError) throw destError;

  const withExperiences = ((destinations ?? []) as DestinationWithExperiences[]).map(
    (destination) => ({
      ...destination,
      experiences: [...(destination.experiences ?? [])].sort(sortExperiences),
    }),
  );

  return { ...(trip as Trip), destinations: withExperiences };
}

export async function createTrip(input: TripInput): Promise<Trip> {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("trips")
    .insert({ ...input, user_id: user.id })
    .select("*")
    .single();
  if (error) throw error;
  return data as Trip;
}

export async function updateTrip(id: string, input: TripInput): Promise<Trip> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("trips")
    .update(input)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Trip;
}

// Deleting a trip cascades to its destinations and their experiences via the
// foreign keys.
export async function deleteTrip(id: string): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("trips").delete().eq("id", id);
  if (error) throw error;
}

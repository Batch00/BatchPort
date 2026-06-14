import { requireUser } from "@/lib/current-user";
import type {
  Trip,
  TripStatus,
  TripSummary,
  TripWithDestinations,
  DestinationWithExperiences,
  Experience,
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

const DESTINATION_COLUMNS =
  "id,trip_id,user_id,name,country_code,admin_region,latitude,longitude,arrival_date,departure_date,order_index,cover_photo_id,notes,created_at,updated_at";

function sortExperiences(a: Experience, b: Experience): number {
  const aDate = a.visited_date ?? "";
  const bDate = b.visited_date ?? "";
  if (aDate !== bDate) {
    // Nulls (empty string) sort last; otherwise ascending by visited date.
    if (!aDate) return 1;
    if (!bDate) return -1;
    return aDate < bDate ? -1 : 1;
  }
  return a.created_at < b.created_at ? -1 : 1;
}

// All trips for the current user, newest first, with destination and country
// counts for the dashboard cards.
export async function getTrips(): Promise<TripSummary[]> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("trips")
    .select("*, destinations(country_code)")
    .order("start_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as (Trip & {
    destinations: { country_code: string | null }[];
  })[];

  return rows.map((row) => {
    const { destinations, ...trip } = row;
    const list = destinations ?? [];
    const countries = new Set(
      list.map((d) => d.country_code).filter((c): c is string => Boolean(c)),
    );
    return {
      ...trip,
      destination_count: list.length,
      country_count: countries.size,
    };
  });
}

// A single trip with its destinations (ordered by order_index) and each
// destination's experiences. Returns null when not found or not owned.
export async function getTrip(id: string): Promise<TripWithDestinations | null> {
  const { supabase } = await requireUser();

  const { data: trip, error } = await supabase
    .from("trips")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!trip) return null;

  const { data: destinations, error: destError } = await supabase
    .from("destinations")
    .select(`${DESTINATION_COLUMNS}, experiences(*)`)
    .eq("trip_id", id)
    .order("order_index", { ascending: true });
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

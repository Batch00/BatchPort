import { requireUser } from "@/lib/current-user";
import { EXPERIENCE_COLUMNS, sortExperiences } from "@/lib/experiences";
import { pointEwkt } from "@/lib/geo";
import type { Destination, DestinationWithExperiences } from "@/lib/types";

// Server-side data access for destinations. The destinations.geom column is a
// PostGIS geography(Point,4326); writes send EWKT via pointEwkt, and the
// latitude/longitude generated columns are never written directly.

export interface DestinationInput {
  name: string;
  country_code: string | null;
  admin_region: string | null;
  lat: number;
  lng: number;
  arrival_date: string | null;
  departure_date: string | null;
  notes: string | null;
}

export const DESTINATION_COLUMNS =
  "id,trip_id,user_id,name,country_code,admin_region,latitude,longitude,arrival_date,departure_date,order_index,cover_photo_id,cover_position,notes,created_at,updated_at";

export async function getDestination(
  id: string,
): Promise<DestinationWithExperiences | null> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("destinations")
    .select(`${DESTINATION_COLUMNS}, experiences(${EXPERIENCE_COLUMNS})`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const destination = data as DestinationWithExperiences;
  return {
    ...destination,
    experiences: [...(destination.experiences ?? [])].sort(sortExperiences),
  };
}

export async function createDestination(
  tripId: string,
  input: DestinationInput,
): Promise<Destination> {
  const { supabase, user } = await requireUser();

  // Append to the end of the trip: order_index = max(order_index) + 1.
  const { data: last, error: maxError } = await supabase
    .from("destinations")
    .select("order_index")
    .eq("trip_id", tripId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxError) throw maxError;
  const nextOrder = (last?.order_index ?? -1) + 1;

  const { data, error } = await supabase
    .from("destinations")
    .insert({
      trip_id: tripId,
      user_id: user.id,
      name: input.name,
      country_code: input.country_code,
      admin_region: input.admin_region,
      arrival_date: input.arrival_date,
      departure_date: input.departure_date,
      notes: input.notes,
      order_index: nextOrder,
      geom: pointEwkt(input.lng, input.lat),
    })
    .select(DESTINATION_COLUMNS)
    .single();
  if (error) throw error;
  return data as Destination;
}

export async function updateDestination(
  id: string,
  input: DestinationInput,
): Promise<Destination> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("destinations")
    .update({
      name: input.name,
      country_code: input.country_code,
      admin_region: input.admin_region,
      arrival_date: input.arrival_date,
      departure_date: input.departure_date,
      notes: input.notes,
      geom: pointEwkt(input.lng, input.lat),
    })
    .eq("id", id)
    .select(DESTINATION_COLUMNS)
    .single();
  if (error) throw error;
  return data as Destination;
}

export async function deleteDestination(id: string): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("destinations").delete().eq("id", id);
  if (error) throw error;
}

// Persist a new order for a trip's destinations. PostgREST cannot set different
// values per row in a single request without violating the not-null insert
// path, so we issue one scoped update per id.
export async function reorderDestinations(
  tripId: string,
  orderedIds: string[],
): Promise<void> {
  const { supabase } = await requireUser();
  await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from("destinations")
        .update({ order_index: index })
        .eq("id", id)
        .eq("trip_id", tripId),
    ),
  );
}

import { requireUser } from "@/lib/current-user";
import { DESTINATION_COLUMNS } from "@/lib/destinations";
import { normalizeExperience, sortExperiences } from "@/lib/experiences";
import {
  chronologicalDestinations,
  withResolvedTripDates,
} from "@/lib/trip-dates";
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

// Trip and destination shapes for the discovery panel's "Add to a trip"
// picker: enough to pick a destination and to sort ones in the POI's country
// first. Trips without destinations are omitted (nothing to attach to).
export interface DestinationOption {
  id: string;
  name: string;
  country_code: string | null;
  // Lets the discovery city view derive the visit month for the climate line.
  arrival_date: string | null;
}

export interface TripDestinationOption {
  id: string;
  name: string;
  // Lets the POI "Add to a trip" flow save ideas (planned experiences) onto
  // planned and ongoing trips instead of done ones.
  status: TripStatus;
  // Fallback month source when a matching destination has no arrival date.
  start_date: string | null;
  destinations: DestinationOption[];
}

export async function getTripDestinationOptions(): Promise<
  TripDestinationOption[]
> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("trips")
    .select(
      "id, name, status, start_date, destinations(id, name, country_code, arrival_date, order_index)",
    )
    .order("start_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as {
    id: string;
    name: string;
    status: TripStatus;
    start_date: string | null;
    destinations: (DestinationOption & { order_index: number })[];
  }[];
  return rows
    .filter((trip) => trip.destinations.length > 0)
    .map((trip) => ({
      id: trip.id,
      name: trip.name,
      status: trip.status,
      start_date: trip.start_date,
      destinations: chronologicalDestinations(
        trip.destinations.map((destination) => ({
          ...destination,
          // The picker only carries arrival, but the ordering wants both ends.
          departure_date: null,
        })),
      ).map(({ id, name, country_code, arrival_date }) => ({
        id,
        name,
        country_code,
        arrival_date,
      })),
    }));
}

// The one column the destination page needs from the owning trip: its status
// decides whether new experiences default to planned ideas or done logs.
export async function getTripStatus(id: string): Promise<TripStatus | null> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("trips")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data?.status as TripStatus | undefined) ?? null;
}

// A single trip with its destinations and each destination's experiences.
// Returns null when not found or not owned.
//
// Stops come back in visit order (arrival date, falling back to order_index)
// and the trip's dates are resolved from them, so a stop dated out of sequence
// or a stored range that predates the last edit both read correctly here
// without waiting for the next write to re-sync (see lib/trip-dates.ts).
export async function getTrip(id: string): Promise<TripWithDestinations | null> {
  const { supabase } = await requireUser();

  // Both queries filter by the id from the URL, so they run in parallel
  // instead of waiting on the trip row before fetching its destinations.
  const [tripResult, destResult] = await Promise.all([
    supabase.from("trips").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("destinations")
      .select(`${DESTINATION_COLUMNS}, experiences(*)`)
      .eq("trip_id", id)
      .order("order_index", { ascending: true }),
  ]);
  const { data: trip, error } = tripResult;
  if (error) throw error;
  if (!trip) return null;

  const { data: destinations, error: destError } = destResult;
  if (destError) throw destError;

  const withExperiences = chronologicalDestinations(
    (destinations ?? []) as DestinationWithExperiences[],
  ).map((destination) => ({
    ...destination,
    experiences: (destination.experiences ?? [])
      .map(normalizeExperience)
      .sort(sortExperiences),
  }));

  return {
    ...withResolvedTripDates(trip as Trip, withExperiences),
    destinations: withExperiences,
  };
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

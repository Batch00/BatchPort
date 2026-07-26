"use server";

import { redirect } from "next/navigation";

import { revalidateAppData } from "@/lib/revalidate";

import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { isDemoBlocked } from "@/lib/demo-guard";
import { createTrip, updateTrip, deleteTrip, type TripInput } from "@/lib/trips";
import { createDestination } from "@/lib/destinations";
import { autoPopulateDestinationCover } from "@/lib/photos-data";
import { cleanupPhotosForOwners, ownersForTrip } from "@/lib/photo-cleanup";

// Server actions for trip mutations. Each checks the demo guard first, performs
// the operation, revalidates affected paths, then redirects. They return an
// error object only when blocked or invalid; on success they redirect and
// never return.

// The forms validate too, but the action is the boundary that actually holds.
function validateTripInput(input: TripInput): string | null {
  if (!input.name || !input.name.trim()) return "Trip name is required.";
  if (input.name.trim().length > 120) {
    return "Trip name must be 120 characters or fewer.";
  }
  if (input.start_date && input.end_date && input.end_date < input.start_date) {
    return "End date cannot be before the start date.";
  }
  return null;
}

export async function createTripAction(
  input: TripInput,
): Promise<{ error: string } | void> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const invalid = validateTripInput(input);
  if (invalid) return { error: invalid };
  const trip = await createTrip(input);
  revalidateAppData();
  redirect(`/trips/${trip.id}`);
}

export async function updateTripAction(
  id: string,
  input: TripInput,
): Promise<{ error: string } | void> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const invalid = validateTripInput(input);
  if (invalid) return { error: invalid };
  await updateTrip(id, input);
  revalidateAppData();
  redirect(`/trips/${id}`);
}

// The city the Discovery panel starts a trip from.
export interface StartTripCityInput {
  name: string;
  lat: number;
  lng: number;
  country_code: string | null;
}

// "Start a trip here" from the Discovery panel: a planned, dateless trip named
// after the city, with the city as its first destination. The user renames and
// dates it later from the trip page this redirects to.
//
// Deliberately does NOT auto-fulfill bucket items: a planned trip is an
// intention, not a visit.
export async function startTripFromCityAction(
  input: StartTripCityInput,
): Promise<{ error: string } | void> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  if (!input.name || !input.name.trim()) {
    return { error: "A city is required." };
  }
  if (!Number.isFinite(input.lat) || input.lat < -90 || input.lat > 90) {
    return { error: "The city's latitude is out of range." };
  }
  if (!Number.isFinite(input.lng) || input.lng < -180 || input.lng > 180) {
    return { error: "The city's longitude is out of range." };
  }

  const cityName = input.name.trim();
  const trip = await createTrip({
    name: `${cityName} Trip`.slice(0, 120),
    start_date: null,
    end_date: null,
    status: "planned",
    notes: null,
  });
  const destination = await createDestination(trip.id, {
    name: cityName,
    country_code: input.country_code,
    admin_region: null,
    lat: input.lat,
    lng: input.lng,
    arrival_date: null,
    departure_date: null,
    notes: null,
  });
  // Best-effort Wikimedia cover for the first stop, same as the regular
  // destination create flow. Never blocks the redirect.
  await autoPopulateDestinationCover({
    id: destination.id,
    name: destination.name,
  });

  revalidateAppData();
  redirect(`/trips/${trip.id}`);
}

// Deleting a trip cascades to its destinations and experiences in Postgres,
// but photos are polymorphic (owner_type + owner_id, no foreign key) so they
// would survive as invisible orphans. The owner list is collected BEFORE the
// delete, while the child rows still exist to be listed, and the photo cleanup
// runs after: it is best-effort and never fails the delete, since orphaned
// photos are recoverable (scripts/cleanup-orphan-photos.ts) and a resurrected
// trip is not.
export async function deleteTripAction(
  id: string,
): Promise<{ error: string } | void> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const photoOwners = await ownersForTrip(id);
  await deleteTrip(id);
  await cleanupPhotosForOwners(photoOwners);
  revalidateAppData();
  redirect("/dashboard");
}

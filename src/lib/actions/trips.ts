"use server";

import { redirect } from "next/navigation";

import { revalidateAppData } from "@/lib/revalidate";

import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { isDemoBlocked } from "@/lib/demo-guard";
import { createTrip, updateTrip, deleteTrip, type TripInput } from "@/lib/trips";

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

export async function deleteTripAction(
  id: string,
): Promise<{ error: string } | void> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  await deleteTrip(id);
  revalidateAppData();
  redirect("/dashboard");
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { isDemoBlocked } from "@/lib/demo-guard";
import { createTrip, updateTrip, deleteTrip, type TripInput } from "@/lib/trips";

// Server actions for trip mutations. Each checks the demo guard first, performs
// the operation, revalidates affected paths, then redirects. They return an
// error object only when blocked; on success they redirect and never return.

export async function createTripAction(
  input: TripInput,
): Promise<{ error: string } | void> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const trip = await createTrip(input);
  revalidatePath("/dashboard");
  redirect(`/trips/${trip.id}`);
}

export async function updateTripAction(
  id: string,
  input: TripInput,
): Promise<{ error: string } | void> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  await updateTrip(id, input);
  revalidatePath("/dashboard");
  revalidatePath(`/trips/${id}`);
  redirect(`/trips/${id}`);
}

export async function deleteTripAction(
  id: string,
): Promise<{ error: string } | void> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  await deleteTrip(id);
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

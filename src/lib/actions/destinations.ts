"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { isDemoBlocked } from "@/lib/demo-guard";
import { autoPopulateDestinationCover } from "@/lib/photos-data";
import { autoFulfillBucketItems } from "@/lib/bucket-list";
import {
  createDestination,
  updateDestination,
  deleteDestination,
  type DestinationInput,
} from "@/lib/destinations";

// Server actions for destination mutations.

export async function createDestinationAction(
  tripId: string,
  input: DestinationInput,
): Promise<{ error: string } | void> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const destination = await createDestination(tripId, input);
  // Auto-fetch a Wikimedia cover for the new stop. Best-effort and silent: it
  // never blocks creation, and the photo simply appears as the cover.
  await autoPopulateDestinationCover({
    id: destination.id,
    name: destination.name,
  });
  // Auto-fulfill any country bucket item this stop completes. Silent and
  // best-effort: a failure here never blocks destination creation.
  try {
    await autoFulfillBucketItems(destination.user_id);
  } catch (error) {
    console.warn("Bucket auto-fulfill skipped:", error);
  }
  revalidatePath(`/trips/${tripId}`);
  redirect(`/trips/${tripId}`);
}

export async function updateDestinationAction(
  tripId: string,
  id: string,
  input: DestinationInput,
): Promise<{ error: string } | void> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  await updateDestination(id, input);
  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/destinations/${id}`);
  redirect(`/trips/${tripId}/destinations/${id}`);
}

export async function deleteDestinationAction(
  tripId: string,
  id: string,
): Promise<{ error: string } | void> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  await deleteDestination(id);
  revalidatePath(`/trips/${tripId}`);
  redirect(`/trips/${tripId}`);
}

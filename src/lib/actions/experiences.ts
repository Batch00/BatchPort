"use server";

import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { revalidateAppData } from "@/lib/revalidate";
import { isDemoBlocked } from "@/lib/demo-guard";
import type { ActionResult } from "@/lib/action-result";
import {
  createExperience,
  updateExperience,
  deleteExperience,
  type ExperienceInput,
} from "@/lib/experiences";

// Server actions for experience mutations. Experiences are edited via a modal
// on the destination page, so these revalidate that page and return a result
// instead of redirecting.

export async function createExperienceAction(
  tripId: string,
  destinationId: string,
  input: ExperienceInput,
): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  await createExperience(destinationId, input);
  revalidateAppData();
  return { ok: true };
}

export async function updateExperienceAction(
  tripId: string,
  destinationId: string,
  id: string,
  input: ExperienceInput,
): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  await updateExperience(id, input);
  revalidateAppData();
  return { ok: true };
}

export async function deleteExperienceAction(
  tripId: string,
  destinationId: string,
  id: string,
): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  await deleteExperience(id);
  revalidateAppData();
  return { ok: true };
}

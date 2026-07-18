"use server";

import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { revalidateAppData } from "@/lib/revalidate";
import { isDemoBlocked } from "@/lib/demo-guard";
import type { ActionResult } from "@/lib/action-result";
import {
  createExperience,
  updateExperience,
  deleteExperience,
  getCategories,
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

// Discovery panel category slugs map onto app category slugs directly except
// "worship", which the app files under attraction.
const POI_SLUG_TO_CATEGORY: Record<string, string> = {
  museum: "museum",
  attraction: "attraction",
  nature: "nature",
  beach: "beach",
  worship: "attraction",
};

/** Log a discovery highlight as an experience under an existing destination:
 * the bridge from browsing a POI to saving it on a trip. The category slug is
 * resolved server-side so the client never handles category ids. */
export async function addPoiExperienceAction(input: {
  destinationId: string;
  name: string;
  categorySlug: string | null;
  lat: number | null;
  lng: number | null;
}): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const slug = input.categorySlug
    ? POI_SLUG_TO_CATEGORY[input.categorySlug] ?? null
    : null;
  const categories = slug ? await getCategories() : [];
  const category = categories.find((c) => c.slug === slug) ?? null;
  try {
    await createExperience(input.destinationId, {
      name: input.name,
      category_id: category?.id ?? null,
      rating: null,
      visited_date: null,
      notes: null,
      lat: input.lat,
      lng: input.lng,
    });
  } catch {
    return { error: "Could not add the experience. Please try again." };
  }
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

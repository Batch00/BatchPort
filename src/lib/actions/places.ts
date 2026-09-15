"use server";

import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { isDemoBlocked } from "@/lib/demo-guard";
import { revalidateAppData } from "@/lib/revalidate";
import { toTransportMode } from "@/lib/transport";
import {
  countPlaceVisits,
  createPlaceVisit,
  createPlaceWithVisit,
  findDuplicatePlace,
  deletePlace,
  deletePlaceVisit,
  getVisitPlaceId,
  updatePlace,
  updatePlaceVisit,
  type PlaceInput,
  type PlaceVisitInput,
} from "@/lib/places";

// Server actions for place and visit mutations.
//
// None of these redirect. Destinations do, because they are edited on their own
// pages; a place is logged from a sheet that stays open over whatever the user
// was looking at, so the caller decides where to go next and the action returns
// the ids it created. revalidateAppData() still runs on every write.

const PLACE_TYPES = ["city", "campus", "stadium", "park", "landmark", "other"] as const;

// The sheet validates too, but the action is the boundary that actually holds.
function validatePlaceInput(input: PlaceInput): string | null {
  if (!input.name || !input.name.trim()) return "A name is required.";
  if (!PLACE_TYPES.includes(input.place_type)) return "Unknown place type.";
  if (!Number.isFinite(input.lat) || input.lat < -90 || input.lat > 90) {
    return "The location's latitude is out of range.";
  }
  if (!Number.isFinite(input.lng) || input.lng < -180 || input.lng > 180) {
    return "The location's longitude is out of range.";
  }
  return null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateVisitInput(input: PlaceVisitInput): string | null {
  if (!input.visit_date || !ISO_DATE.test(input.visit_date)) {
    return "A visit date is required.";
  }
  if (input.end_date) {
    if (!ISO_DATE.test(input.end_date)) return "The end date is not a valid date.";
    if (input.end_date < input.visit_date) {
      return "The end date cannot be before the visit date.";
    }
  }
  // transport_mode is text with a check constraint in the database, so an
  // unknown string would be rejected there as an opaque write failure. Narrow
  // it here instead and say what happened.
  if (input.transport_mode !== null && toTransportMode(input.transport_mode) === null) {
    return "Unknown transport mode.";
  }
  return null;
}

/**
 * Log a place.
 *
 * If the user already has this place, this ADDS A VISIT to it rather than
 * creating a second one, and says so in the result. The guard lives here rather
 * than in the sheet because every entry point reaches this action, and one
 * venue is one pin: a duplicate double-counts a catalog's denominator, puts two
 * pins on one spot, and splits a visit history that only makes sense whole.
 * American Family Field was logged twice before this existed.
 */
export async function createPlaceAction(
  place: PlaceInput,
  visit: PlaceVisitInput,
): Promise<
  { error: string } | { placeId: string; visitId: string; addedToExisting: boolean }
> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const invalidPlace = validatePlaceInput(place);
  if (invalidPlace) return { error: invalidPlace };
  const invalidVisit = validateVisitInput(visit);
  if (invalidVisit) return { error: invalidVisit };

  const existingId = await findDuplicatePlace(place);
  if (existingId) {
    const created = await createPlaceVisit(existingId, visit);
    revalidateAppData();
    return { placeId: existingId, visitId: created.id, addedToExisting: true };
  }

  const created = await createPlaceWithVisit(place, visit);
  revalidateAppData();
  return { ...created, addedToExisting: false };
}

export async function updatePlaceAction(
  id: string,
  input: PlaceInput,
): Promise<{ error: string } | { placeId: string }> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const invalid = validatePlaceInput(input);
  if (invalid) return { error: invalid };
  await updatePlace(id, input);
  revalidateAppData();
  return { placeId: id };
}

export async function deletePlaceAction(
  id: string,
): Promise<{ error: string } | { ok: true }> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  // place_visits cascades from places, so this takes the visit history with it.
  await deletePlace(id);
  revalidateAppData();
  return { ok: true };
}

export async function addPlaceVisitAction(
  placeId: string,
  visit: PlaceVisitInput,
): Promise<{ error: string } | { visitId: string }> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const invalid = validateVisitInput(visit);
  if (invalid) return { error: invalid };
  const created = await createPlaceVisit(placeId, visit);
  revalidateAppData();
  return { visitId: created.id };
}

export async function updatePlaceVisitAction(
  id: string,
  visit: PlaceVisitInput,
): Promise<{ error: string } | { visitId: string }> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const invalid = validateVisitInput(visit);
  if (invalid) return { error: invalid };
  await updatePlaceVisit(id, visit);
  revalidateAppData();
  return { visitId: id };
}

/**
 * Delete one visit.
 *
 * Deleting the LAST visit of a place would leave a place nothing has ever
 * happened at, which the schema permits and the list can draw but which is
 * almost never what somebody means. So this refuses by default and hands the
 * decision back: the caller either deletes the place instead
 * (deletePlaceAction) or says keepPlace and gets the orphan deliberately.
 *
 * The count is taken here rather than trusted from the client, because the
 * client's copy is as old as its last render and two tabs can disagree.
 */
export async function deletePlaceVisitAction(
  id: string,
  options?: { keepPlace?: boolean },
): Promise<
  | { error: string }
  | { ok: true }
  | { needsChoice: true; placeId: string }
> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };

  const placeId = await getVisitPlaceId(id);
  if (!placeId) return { error: "That visit no longer exists." };

  if (!options?.keepPlace && (await countPlaceVisits(placeId)) <= 1) {
    return { needsChoice: true, placeId };
  }

  await deletePlaceVisit(id);
  revalidateAppData();
  return { ok: true };
}

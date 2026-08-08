/*
 * DATABASE CHANGES REQUIRED (see scripts/sql/2026-08-07-featured-curation.sql
 * and scripts/sql/2026-08-08-curation-slots.sql):
 *
 * ALTER TABLE batchport.experiences ADD COLUMN IF NOT EXISTS featured_rank smallint;
 * ALTER TABLE batchport.photos ADD COLUMN IF NOT EXISTS featured_rank smallint;
 * ALTER TABLE batchport.photos ADD COLUMN IF NOT EXISTS featured_slot text;
 */

"use server";

import { requireUser } from "@/lib/current-user";
import { revalidateAppData } from "@/lib/revalidate";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { isDemoBlocked } from "@/lib/demo-guard";
import { SLOT_CAPACITY } from "@/lib/curation";
import { ownersForTrip } from "@/lib/photo-cleanup";
import type { ActionResult } from "@/lib/action-result";

// Curation: electing what represents a trip.
//
// Every action here writes a WHOLE SLOT, not one item. That is the difference
// between this and the toggle it replaced, and it is what makes the panel
// possible: "these three, in this order" is one call, reordering is the same
// call with the list rearranged, and clearing a slot back to automatic is the
// same call with an empty list. Nothing has to reason about which rank is free,
// nothing can end up half-assigned, and there is no cap to bump into because
// the caller sends at most as many ids as the slot holds.
//
// The ids come from the caller, as they do for reorderPhotos. RLS is still the
// access boundary: every write below is scoped to the caller's own rows by
// policy, so an id belonging to somebody else simply updates nothing.

type ServerClient = Awaited<ReturnType<typeof requireUser>>["supabase"];

/** A column that does not exist: PGRST204 when the write names it, 42703 when
 * a filter does. Both mean the same thing here, and both have to be caught, or
 * a database missing the migration would report a generic failure instead of
 * saying which migration to run. */
function isMissingColumnWrite(error: { code?: string } | null): boolean {
  return error?.code === "PGRST204" || error?.code === "42703";
}

const NOT_SET_UP =
  "Curation is not set up on this database yet. Run the featured-curation and curation-slots migrations.";

/** Every photo id on a trip, at every level: the trip's own, its stops', and
 * its experiences'. ownersForTrip already resolves that fan-out for the delete
 * cascade, so this borrows it rather than repeating it. */
async function tripPhotoIds(
  supabase: ServerClient,
  tripId: string,
): Promise<string[]> {
  const owners = await ownersForTrip(tripId);
  const ids: string[] = [];
  for (const owner of owners) {
    if (owner.ids.length === 0) continue;
    const { data, error } = await supabase
      .from("photos")
      .select("id")
      .eq("owner_type", owner.type)
      .in("owner_id", owner.ids);
    if (error) continue;
    ids.push(...((data ?? []) as { id: string }[]).map((row) => row.id));
  }
  return ids;
}

/** Every experience id on a trip. */
async function tripExperienceIds(
  supabase: ServerClient,
  tripId: string,
): Promise<string[]> {
  const { data: dests } = await supabase
    .from("destinations")
    .select("id")
    .eq("trip_id", tripId);
  const destinationIds = ((dests ?? []) as { id: string }[]).map((row) => row.id);
  if (destinationIds.length === 0) return [];
  const { data, error } = await supabase
    .from("experiences")
    .select("id")
    .in("destination_id", destinationIds);
  if (error) return [];
  return ((data ?? []) as { id: string }[]).map((row) => row.id);
}

/** Ids the caller named that actually belong to the trip. Anything else is
 * dropped rather than refused: a stale panel (a photo deleted on another
 * device) should still be able to save the rest of the slot. */
function within(candidates: string[], requested: string[]): string[] {
  const allowed = new Set(candidates);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const id of requested) {
    if (!allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    kept.push(id);
  }
  return kept;
}

/**
 * The trip's hero photo: the recap's opening frame and the share card's
 * backdrop. One per trip, so setting it clears whatever held the slot before.
 * Passing null returns the slot to automatic.
 */
export async function setTripHeroPhotoAction(
  tripId: string,
  photoId: string | null,
): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const { supabase } = await requireUser();

  const candidates = await tripPhotoIds(supabase, tripId);
  const chosen = photoId ? within(candidates, [photoId])[0] ?? null : null;
  if (photoId && !chosen) return { error: "That photo is not on this trip." };

  // Clear the old hero first, and only the hero: a photo holding a stop slot
  // is answering a different question and must not be swept up here.
  if (candidates.length > 0) {
    const { error } = await supabase
      .from("photos")
      .update({ featured_slot: null, featured_rank: null })
      .in("id", candidates)
      .eq("featured_slot", "hero");
    if (isMissingColumnWrite(error)) return { error: NOT_SET_UP };
    if (error) return { error: "Could not update the hero photo." };
  }

  if (chosen) {
    const { error } = await supabase
      .from("photos")
      .update({ featured_slot: "hero", featured_rank: 1 })
      .eq("id", chosen);
    if (isMissingColumnWrite(error)) return { error: NOT_SET_UP };
    if (error) return { error: "Could not update the hero photo." };
  }

  revalidateAppData();
  return { ok: true };
}

/**
 * The photos that lead one stop's story slides, in order. `candidateIds` is
 * the full set the panel offered for this stop; anything in it that is not in
 * `photoIds` goes back to automatic, which is what makes deselecting work
 * without a second call.
 */
export async function setStopPhotosAction(
  tripId: string,
  destinationId: string,
  photoIds: string[],
  candidateIds: string[],
): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const { supabase } = await requireUser();

  const onTrip = await tripPhotoIds(supabase, tripId);
  const candidates = within(onTrip, candidateIds);
  const chosen = within(candidates, photoIds).slice(0, SLOT_CAPACITY.stopPhotos);

  if (candidates.length > 0) {
    // Only stop picks are cleared. A hero elected from this stop's photos
    // keeps its slot; the two are independent elections.
    const { error } = await supabase
      .from("photos")
      .update({ featured_slot: null, featured_rank: null })
      .in("id", candidates)
      .or("featured_slot.is.null,featured_slot.eq.stop");
    if (isMissingColumnWrite(error)) return { error: NOT_SET_UP };
    if (error) return { error: "Could not update this stop's photos." };
  }

  for (let index = 0; index < chosen.length; index += 1) {
    const { error } = await supabase
      .from("photos")
      .update({ featured_slot: "stop", featured_rank: index + 1 })
      .eq("id", chosen[index]);
    if (isMissingColumnWrite(error)) return { error: NOT_SET_UP };
    if (error) return { error: "Could not update this stop's photos." };
  }

  // destinationId is not written anywhere: which stop a photo leads is already
  // determined by the stop it hangs off, exactly as a journal entry's stop is
  // determined by its date. Storing it would be a second copy that drifts the
  // first time a photo is moved between stops. It is a parameter only so the
  // action can be read at the call site as "this stop's slot".
  void destinationId;

  revalidateAppData();
  return { ok: true };
}

/**
 * The trip's three highlights, in order: the share card's list, the story's
 * closing line, the recap's moments, and the "best of this trip" block on the
 * trip page. An empty list returns the slot to automatic (best-rated first).
 */
export async function setTripHighlightsAction(
  tripId: string,
  experienceIds: string[],
): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const { supabase } = await requireUser();

  const candidates = await tripExperienceIds(supabase, tripId);
  const chosen = within(candidates, experienceIds).slice(
    0,
    SLOT_CAPACITY.highlights,
  );

  if (candidates.length > 0) {
    const { error } = await supabase
      .from("experiences")
      .update({ featured_rank: null })
      .in("id", candidates)
      .not("featured_rank", "is", null);
    if (isMissingColumnWrite(error)) return { error: NOT_SET_UP };
    if (error) return { error: "Could not update the highlights." };
  }

  for (let index = 0; index < chosen.length; index += 1) {
    const { error } = await supabase
      .from("experiences")
      .update({ featured_rank: index + 1 })
      .eq("id", chosen[index]);
    if (isMissingColumnWrite(error)) return { error: NOT_SET_UP };
    if (error) return { error: "Could not update the highlights." };
  }

  revalidateAppData();
  return { ok: true };
}

import { requireUser } from "@/lib/current-user";
import { createAdminClient } from "@/utils/supabase/admin";
import { PHOTO_BUCKET, THUMB_SUFFIX } from "@/lib/photos";
import type { Photo, PhotoOwnerType } from "@/lib/types";

// Photo lifecycle cleanup shared by the photo delete action and by the
// trip/destination/experience delete actions.
//
// photos is polymorphic (owner_type + owner_id, no foreign key), so deleting a
// trip cascades to its destinations and experiences in Postgres but never
// touches their photo rows. Without this module every deleted entity left its
// photos behind: invisible rows that still counted in the photo map and still
// held Storage objects. The entity delete actions call cleanupPhotosForOwners
// after the delete succeeds.

type ServerClient = Awaited<ReturnType<typeof requireUser>>["supabase"];

/** A set of photo owners of one type, e.g. every destination of a trip. */
export interface PhotoOwnerRef {
  type: PhotoOwnerType;
  ids: string[];
}

export type PhotoDeleteOutcome =
  | { ok: true; failedIds: string[] }
  | { error: string };

// PostgREST puts `in` lists in the query string, so very long lists are
// chunked to keep URLs within server limits.
const ID_CHUNK = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

// Delete photo rows and their upload Storage objects.
//
// Ordering guarantees:
// - Cover pointers are cleared first, with errors checked (an unchecked
//   failure here would make the row delete hit the foreign key).
// - Database rows are deleted next. The rows are the source of truth.
// - Storage cleanup runs LAST and is strictly best-effort: a missing object
//   or a Storage outage must never block or un-report a delete. Orphaned
//   storage files are acceptable; resurrected photos are not.
// - Only upload-sourced objects (and their derived "{path}_thumb" thumbnails)
//   are removed. Wikimedia cache files live at a shared wikimedia/{hash} path
//   that other photo rows may still reference, so they always stay in place.
// - Ids whose row no longer exists count as already deleted, so retrying a
//   partially-applied batch converges instead of erroring.
export async function deletePhotosByIds(
  supabase: ServerClient,
  ids: string[],
): Promise<PhotoDeleteOutcome> {
  if (ids.length === 0) return { ok: true, failedIds: [] };

  const photos: Pick<Photo, "id" | "source" | "storage_path">[] = [];
  for (const batch of chunk(ids, ID_CHUNK)) {
    const { data, error } = await supabase
      .from("photos")
      .select("id,source,storage_path")
      .in("id", batch);
    if (error) return { error: "Could not load the photos to delete." };
    photos.push(
      ...((data ?? []) as Pick<Photo, "id" | "source" | "storage_path">[]),
    );
  }
  const existingIds = photos.map((photo) => photo.id);
  if (existingIds.length === 0) return { ok: true, failedIds: [] };

  // Clear cover pointers so the row deletes never dangle a foreign key. A
  // trip's cover can reference a destination-owned photo (set from the trip
  // gallery), so both tables are checked by pointer rather than by owner. This
  // is also what clears a surviving parent's cover when a child entity's
  // photos are deleted with it.
  for (const batch of chunk(existingIds, ID_CHUNK)) {
    const [tripClear, destClear] = await Promise.all([
      supabase
        .from("trips")
        .update({ cover_photo_id: null })
        .in("cover_photo_id", batch),
      supabase
        .from("destinations")
        .update({ cover_photo_id: null })
        .in("cover_photo_id", batch),
    ]);
    if (tripClear.error || destClear.error) {
      return { error: "Could not detach the photos from their covers." };
    }
  }

  // Delete every row; if a batch fails, fall back to per-id deletes so a
  // single bad row cannot block the rest.
  const failedIds: string[] = [];
  for (const batch of chunk(existingIds, ID_CHUNK)) {
    const { error } = await supabase.from("photos").delete().in("id", batch);
    if (!error) continue;
    const results = await Promise.all(
      batch.map((id) => supabase.from("photos").delete().eq("id", id)),
    );
    failedIds.push(...batch.filter((_, index) => results[index].error));
  }

  // Best-effort Storage cleanup for rows that are actually gone. The thumb
  // path is derived ("{path}_thumb"), so cleanup works whether or not the
  // thumb_path column exists yet; removing a nonexistent object is a no-op.
  const failedSet = new Set(failedIds);
  const removablePaths = photos
    .filter(
      (photo) =>
        !failedSet.has(photo.id) &&
        photo.source === "upload" &&
        photo.storage_path,
    )
    .flatMap((photo) => [
      photo.storage_path as string,
      `${photo.storage_path}${THUMB_SUFFIX}`,
    ]);
  if (removablePaths.length > 0) {
    try {
      const storage = createAdminClient().storage.from(PHOTO_BUCKET);
      for (const batch of chunk(removablePaths, ID_CHUNK)) {
        await storage.remove(batch);
      }
    } catch {
      // Orphaned storage files are acceptable; the rows are already deleted.
    }
  }

  return { ok: true, failedIds };
}

/** Every photo id owned by the given entities. Owners with no ids are skipped
 * so an empty trip never issues a query. */
async function collectPhotoIds(
  supabase: ServerClient,
  owners: PhotoOwnerRef[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const owner of owners) {
    for (const batch of chunk(owner.ids, ID_CHUNK)) {
      if (batch.length === 0) continue;
      const { data, error } = await supabase
        .from("photos")
        .select("id")
        .eq("owner_type", owner.type)
        .in("owner_id", batch);
      if (error) throw error;
      ids.push(...((data ?? []) as { id: string }[]).map((row) => row.id));
    }
  }
  return ids;
}

/** Delete every photo owned by the given entities. Strictly best-effort: the
 * entity delete has already succeeded by the time this runs, so a failure here
 * leaves recoverable orphans (see scripts/cleanup-orphan-photos.ts) rather
 * than resurrecting the entity. Returns the number of rows deleted. */
export async function cleanupPhotosForOwners(
  owners: PhotoOwnerRef[],
): Promise<number> {
  try {
    const { supabase } = await requireUser();
    const ids = await collectPhotoIds(supabase, owners);
    if (ids.length === 0) return 0;
    const result = await deletePhotosByIds(supabase, ids);
    if ("error" in result) return 0;
    return ids.length - result.failedIds.length;
  } catch (error) {
    console.warn("Photo cleanup skipped:", error);
    return 0;
  }
}

// The owner collectors run BEFORE the entity delete, so a failure in them must
// not throw: that would leave the user unable to delete the entity at all. They
// degrade to the owners they could resolve, and the script recovers the rest.

/** The photo owners a trip delete takes with it: the trip, its destinations,
 * and their experiences. Must be called BEFORE the delete, while the child
 * rows still exist to be listed. */
export async function ownersForTrip(tripId: string): Promise<PhotoOwnerRef[]> {
  const owners: PhotoOwnerRef[] = [{ type: "trip", ids: [tripId] }];
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("destinations")
      .select("id")
      .eq("trip_id", tripId);
    if (error) throw error;
    const destinationIds = ((data ?? []) as { id: string }[]).map(
      (row) => row.id,
    );
    owners.push({ type: "destination", ids: destinationIds });
    owners.push({
      type: "experience",
      ids: await experienceIds(supabase, destinationIds),
    });
  } catch (error) {
    console.warn("Could not list a trip's photo owners:", error);
  }
  return owners;
}

/** The photo owners a destination delete takes with it: the destination and
 * its experiences. Must be called BEFORE the delete. */
export async function ownersForDestination(
  destinationId: string,
): Promise<PhotoOwnerRef[]> {
  const owners: PhotoOwnerRef[] = [
    { type: "destination", ids: [destinationId] },
  ];
  try {
    const { supabase } = await requireUser();
    owners.push({
      type: "experience",
      ids: await experienceIds(supabase, [destinationId]),
    });
  } catch (error) {
    console.warn("Could not list a destination's photo owners:", error);
  }
  return owners;
}

/** The photo owners an experience delete takes with it. */
export function ownersForExperience(experienceId: string): PhotoOwnerRef[] {
  return [{ type: "experience", ids: [experienceId] }];
}

async function experienceIds(
  supabase: ServerClient,
  destinationIds: string[],
): Promise<string[]> {
  if (destinationIds.length === 0) return [];
  const ids: string[] = [];
  for (const batch of chunk(destinationIds, ID_CHUNK)) {
    const { data, error } = await supabase
      .from("experiences")
      .select("id")
      .in("destination_id", batch);
    if (error) throw error;
    ids.push(...((data ?? []) as { id: string }[]).map((row) => row.id));
  }
  return ids;
}

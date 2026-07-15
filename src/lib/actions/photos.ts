/*
 * DATABASE CHANGES REQUIRED (run in Supabase SQL editor before deploying):
 *
 * ALTER TABLE batchport.trips ADD COLUMN IF NOT EXISTS cover_position jsonb DEFAULT '{"x": 50, "y": 50}';
 * ALTER TABLE batchport.destinations ADD COLUMN IF NOT EXISTS cover_position jsonb DEFAULT '{"x": 50, "y": 50}';
 * -- cover_position may also carry a zoom factor: {"x": 50, "y": 50, "scale": 1.4}.
 * -- No migration needed: rows without "scale" are treated as scale 1 by the app.
 * ALTER TABLE batchport.photos ADD COLUMN IF NOT EXISTS date_taken timestamptz;
 * -- EXIF GPS coordinates captured at upload time.
 * ALTER TABLE batchport.photos ADD COLUMN IF NOT EXISTS gps_lat double precision;
 * ALTER TABLE batchport.photos ADD COLUMN IF NOT EXISTS gps_lng double precision;
 * -- Duplicate detection: SHA-256 of the original file content.
 * ALTER TABLE batchport.photos ADD COLUMN IF NOT EXISTS fingerprint text;
 * CREATE INDEX IF NOT EXISTS photos_owner_fingerprint_idx
 *   ON batchport.photos (owner_type, owner_id, fingerprint);
 * -- Storage path of the small gallery thumbnail ("{storage_path}_thumb").
 * ALTER TABLE batchport.photos ADD COLUMN IF NOT EXISTS thumb_path text;
 */

"use server";

import { requireUser } from "@/lib/current-user";
import { revalidateAppData } from "@/lib/revalidate";
import { createAdminClient } from "@/utils/supabase/admin";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { isDemoBlocked } from "@/lib/demo-guard";
import {
  PHOTO_BUCKET,
  THUMB_SUFFIX,
  type InsertPhotoInput,
} from "@/lib/photos";
import type { ActionResult } from "@/lib/action-result";
import type { Photo, PhotoOwnerType } from "@/lib/types";

// Server actions for photo records. Writes are blocked for the demo account.
// Storage uploads happen client-side; these actions own the database rows and
// cover-photo pointers, plus server-side Storage cleanup on delete.

export type InsertPhotoResult = { ok: true; photoId: string } | { error: string };

export async function insertPhotoRecord(
  input: InsertPhotoInput,
): Promise<InsertPhotoResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const { supabase, user } = await requireUser();

  // Append after any existing photos for this owner.
  const { data: last } = await supabase
    .from("photos")
    .select("order_index")
    .eq("owner_type", input.ownerType)
    .eq("owner_id", input.ownerId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((last?.order_index as number | undefined) ?? -1) + 1;

  const payload: Record<string, unknown> = {
    user_id: user.id,
    owner_type: input.ownerType,
    owner_id: input.ownerId,
    source: input.source,
    storage_path: input.storagePath ?? null,
    external_url: input.externalUrl ?? null,
    attribution: input.attribution ?? null,
    order_index: nextOrder,
  };
  if (input.dateTaken !== undefined && input.dateTaken !== null) {
    payload.date_taken = input.dateTaken;
  }
  if (input.fingerprint !== undefined && input.fingerprint !== null) {
    payload.fingerprint = input.fingerprint;
  }
  const hasGps = input.gpsLat != null && input.gpsLng != null;
  if (hasGps) {
    payload.gps_lat = input.gpsLat;
    payload.gps_lng = input.gpsLng;
  }
  const hasThumb = input.thumbPath != null;
  if (hasThumb) {
    payload.thumb_path = input.thumbPath;
  }

  let { data, error } = await supabase
    .from("photos")
    .insert(payload)
    .select("id")
    .single();
  // Databases created before the GPS or thumbnail columns existed reject the
  // insert with a schema error. Retry without those optional fields so the
  // upload never fails just because the metadata could not be stored.
  if (error && (hasGps || hasThumb)) {
    delete payload.gps_lat;
    delete payload.gps_lng;
    delete payload.thumb_path;
    ({ data, error } = await supabase
      .from("photos")
      .insert(payload)
      .select("id")
      .single());
  }
  if (error || !data) return { error: "Could not save the photo." };

  revalidateAppData();
  return { ok: true, photoId: data.id as string };
}

export async function setCoverPhoto(
  ownerType: PhotoOwnerType,
  ownerId: string,
  photoId: string,
  position?: { x: number; y: number; scale?: number },
): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const { supabase } = await requireUser();
  const table = ownerType === "trip" ? "trips" : "destinations";
  const patch =
    position !== undefined
      ? {
          cover_photo_id: photoId,
          cover_position: {
            x: position.x,
            y: position.y,
            scale: position.scale ?? 1,
          },
        }
      : { cover_photo_id: photoId };
  const { error } = await supabase.from(table).update(patch).eq("id", ownerId);
  if (error) return { error: "Could not set the cover photo." };

  revalidateAppData();
  return { ok: true };
}

// Move a photo to a different owner (trip, destination, or experience).
export async function retagPhoto(
  photoId: string,
  ownerType: PhotoOwnerType,
  ownerId: string,
): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const { supabase } = await requireUser();

  // Append to the end of the new owner's photos.
  const { data: last } = await supabase
    .from("photos")
    .select("order_index")
    .eq("owner_type", ownerType)
    .eq("owner_id", ownerId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((last?.order_index as number | undefined) ?? -1) + 1;

  const { error } = await supabase
    .from("photos")
    .update({ owner_type: ownerType, owner_id: ownerId, order_index: nextOrder })
    .eq("id", photoId);
  if (error) return { error: "Could not tag the photo." };

  revalidateAppData();
  return { ok: true };
}

export type DeletePhotosResult =
  | { ok: true; failedIds: string[] }
  | { error: string };

// Delete a batch of photos in ONE action round trip. The previous approach
// (one action call per photo from the client) serialized N requests, each
// re-rendering the whole app via revalidation; on a flaky mobile connection an
// interrupted or rejected request silently stranded the remaining deletes
// while the UI had already hidden the photos, so they "resurrected" later.
// This action processes every id server-side in a single request and reports
// per-photo outcomes.
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
export async function deletePhotoRecords(
  ids: string[],
): Promise<DeletePhotosResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  if (ids.length === 0) return { ok: true, failedIds: [] };
  const { supabase } = await requireUser();

  const { data: rows, error: fetchError } = await supabase
    .from("photos")
    .select("id,source,storage_path")
    .in("id", ids);
  if (fetchError) {
    return { error: "Could not load the photos to delete." };
  }
  const photos = (rows ?? []) as Pick<Photo, "id" | "source" | "storage_path">[];
  const existingIds = photos.map((photo) => photo.id);
  if (existingIds.length === 0) {
    revalidateAppData();
    return { ok: true, failedIds: [] };
  }

  // Clear cover pointers so the row deletes never dangle a foreign key. A
  // trip's cover can reference a destination-owned photo (set from the trip
  // gallery), so both tables are checked by pointer rather than by owner.
  const [tripClear, destClear] = await Promise.all([
    supabase
      .from("trips")
      .update({ cover_photo_id: null })
      .in("cover_photo_id", existingIds),
    supabase
      .from("destinations")
      .update({ cover_photo_id: null })
      .in("cover_photo_id", existingIds),
  ]);
  if (tripClear.error || destClear.error) {
    return { error: "Could not detach the photos from their covers." };
  }

  // Delete every row in one statement; if that fails, fall back to per-id
  // deletes so a single bad row cannot block the rest of the batch.
  let failedIds: string[] = [];
  const { error: bulkError } = await supabase
    .from("photos")
    .delete()
    .in("id", existingIds);
  if (bulkError) {
    const results = await Promise.all(
      existingIds.map((id) => supabase.from("photos").delete().eq("id", id)),
    );
    failedIds = existingIds.filter((_, index) => results[index].error);
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
      await createAdminClient()
        .storage.from(PHOTO_BUCKET)
        .remove(removablePaths);
    } catch {
      // Orphaned storage files are acceptable; the rows are already deleted.
    }
  }

  revalidateAppData();
  return { ok: true, failedIds };
}

export async function deletePhotoRecord(id: string): Promise<ActionResult> {
  const result = await deletePhotoRecords([id]);
  if ("error" in result) return result;
  if (result.failedIds.length > 0) {
    return { error: "Could not delete the photo." };
  }
  return { ok: true };
}

// Persist a complete new order for one owner's photos: order_index = position
// in orderedIds. Replaces the old neighbor-swap approach, which silently
// no-oped when photos shared an order_index (legacy rows and concurrent
// uploads both produce ties). Writing the full sequence also repairs any
// existing ties. One action call per reorder; PostgREST cannot set distinct
// values per row in a single request, so the per-id updates run in parallel
// inside the action (same pattern as reorderDestinations).
export async function reorderPhotos(orderedIds: string[]): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  if (orderedIds.length === 0) return { ok: true };
  const { supabase } = await requireUser();

  // All photos must belong to a single owner; a cross-owner reorder would
  // corrupt the galleries it touches.
  const { data: rows } = await supabase
    .from("photos")
    .select("id, owner_type, owner_id")
    .in("id", orderedIds);
  const photos = (rows ?? []) as Pick<Photo, "id" | "owner_type" | "owner_id">[];
  if (photos.length !== orderedIds.length) {
    return { error: "Some photos could not be found." };
  }
  const owner = photos[0];
  if (
    !photos.every(
      (p) => p.owner_type === owner.owner_type && p.owner_id === owner.owner_id,
    )
  ) {
    return { error: "Photos belong to different owners." };
  }

  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from("photos").update({ order_index: index }).eq("id", id),
    ),
  );
  if (results.some((result) => result.error)) {
    return { error: "Could not reorder the photos." };
  }

  revalidateAppData();
  return { ok: true };
}

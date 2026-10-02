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
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { isDemoBlocked } from "@/lib/demo-guard";
import {
  deletePhotosByIds,
  type PhotoDeleteOutcome,
} from "@/lib/photo-cleanup";
import {
  PHOTO_BUCKET,
  THUMB_SUFFIX,
  type InsertPhotoInput,
} from "@/lib/photos";
import { sanitizeDateTaken, sanitizeGps } from "@/lib/photo-metadata";
import { createAdminClient } from "@/utils/supabase/admin";
import type { ActionResult } from "@/lib/action-result";
import type { Photo, PhotoOwnerType } from "@/lib/types";

// Server actions for photo records. Writes are blocked for the demo account.
// Storage uploads happen client-side; these actions own the database rows and
// cover-photo pointers, plus server-side Storage cleanup on delete.

export type InsertPhotoResult =
  { ok: true; photoId: string } | { error: string };

// Postgres data errors (class 22: invalid input syntax, value out of range,
// numeric overflow) and check violations. These are what a malformed EXIF
// value produces, and the only failures that retrying without the metadata
// can fix.
function isDataError(error: { code?: string }): boolean {
  return (
    error.code !== undefined &&
    (error.code.startsWith("22") || error.code === "23514")
  );
}

// A column the database does not have yet: PostgREST's schema cache miss on
// insert, or Postgres's own undefined column.
function isMissingColumnError(error: { code?: string }): boolean {
  return error.code === "PGRST204" || error.code === "42703";
}

// Remove a just-uploaded Storage object and its thumbnail after its photos row
// failed to save, so a failed save never leaves orphaned files. Strictly
// best-effort and never throws: an orphan is recoverable with
// scripts/cleanup-orphan-uploads.ts, a thrown cleanup would hide the real
// error. Only paths inside the caller's own upload prefix are touched, and
// never one a photos row references (the path came from the client).
async function discardUpload(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  userId: string,
  storagePath: string,
): Promise<void> {
  try {
    if (!storagePath.startsWith(`${userId}/`) || storagePath.includes("..")) {
      return;
    }
    const { data: referenced, error } = await supabase
      .from("photos")
      .select("id")
      .eq("user_id", userId)
      .eq("storage_path", storagePath)
      .limit(1);
    if (error || (referenced ?? []).length > 0) return;
    await createAdminClient()
      .storage.from(PHOTO_BUCKET)
      .remove([storagePath, `${storagePath}${THUMB_SUFFIX}`]);
  } catch {
    // Best-effort; see above.
  }
}

export async function insertPhotoRecord(
  input: InsertPhotoInput,
): Promise<InsertPhotoResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const { supabase, user } = await requireUser();

  // Append after any existing photos for this owner.
  const { data: last } = await supabase
    .from("photos")
    .select("order_index")
    .eq("user_id", user.id)
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
  if (input.fingerprint !== undefined && input.fingerprint !== null) {
    payload.fingerprint = input.fingerprint;
  }
  // EXIF-derived fields are validated again here: the client already ran the
  // same checks, but the server is the one that pays for a bad value.
  const dateTaken = sanitizeDateTaken(input.dateTaken);
  if (dateTaken !== null) payload.date_taken = dateTaken;
  const { gpsLat, gpsLng } = sanitizeGps(input.gpsLat, input.gpsLng);
  const hasGps = gpsLat !== null && gpsLng !== null;
  if (hasGps) {
    payload.gps_lat = gpsLat;
    payload.gps_lng = gpsLng;
  }
  const hasExif = dateTaken !== null || hasGps;
  const hasThumb = input.thumbPath != null;
  if (hasThumb) {
    payload.thumb_path = input.thumbPath;
  }

  const insert = () =>
    supabase.from("photos").insert(payload).select("id").single();

  let { data, error } = await insert();
  // Metadata is a bonus, never a blocker. A value that passed validation and
  // still failed as data goes, and the photo saves without its metadata.
  if (error && hasExif && isDataError(error)) {
    console.warn(
      `insertPhotoRecord: retrying without EXIF metadata (${error.code} ${error.message})`,
    );
    delete payload.date_taken;
    delete payload.gps_lat;
    delete payload.gps_lng;
    ({ data, error } = await insert());
  }
  // Databases created before the GPS or thumbnail columns existed reject the
  // insert with a schema error. Retry without those optional fields so the
  // upload never fails just because the metadata could not be stored.
  if (error && (hasGps || hasThumb) && isMissingColumnError(error)) {
    delete payload.gps_lat;
    delete payload.gps_lng;
    delete payload.thumb_path;
    ({ data, error } = await insert());
  }
  if (error || !data) {
    if (input.source === "upload" && input.storagePath) {
      await discardUpload(supabase, user.id, input.storagePath);
    }
    const detail = error
      ? `${error.message}${error.code ? ` (${error.code})` : ""}`
      : "no row returned";
    return { error: `Could not save the photo: ${detail}` };
  }

  revalidateAppData();
  return { ok: true, photoId: data.id as string };
}

// Discard an upload whose insert never ran or never answered (the action
// threw, or the network dropped mid-call). insertPhotoRecord cleans up after
// its own failures; this is for the ones it never saw.
export async function discardUploadedPhoto(
  storagePath: string,
): Promise<void> {
  if (await isDemoBlocked()) return;
  const { supabase, user } = await requireUser();
  await discardUpload(supabase, user.id, storagePath);
}

export async function setCoverPhoto(
  ownerType: PhotoOwnerType,
  ownerId: string,
  photoId: string,
  position?: { x: number; y: number; scale?: number },
): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  // Only trips and destinations carry covers; guard so a bad ownerType can
  // never fall through to the destinations table.
  if (ownerType !== "trip" && ownerType !== "destination") {
    return { error: "Covers apply to trips and destinations only." };
  }
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
  const { supabase, user } = await requireUser();

  // Append to the end of the new owner's photos.
  const { data: last } = await supabase
    .from("photos")
    .select("order_index")
    .eq("user_id", user.id)
    .eq("owner_type", ownerType)
    .eq("owner_id", ownerId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((last?.order_index as number | undefined) ?? -1) + 1;

  const { error } = await supabase
    .from("photos")
    .update({
      owner_type: ownerType,
      owner_id: ownerId,
      order_index: nextOrder,
    })
    .eq("id", photoId);
  if (error) return { error: "Could not tag the photo." };

  revalidateAppData();
  return { ok: true };
}

/** Where a photo's map location should come from after a manual fix. */
export type PhotoLocationTarget = { destinationId: string } | "clear";

// Manual location override for a mislocated photo. Overwrites gps_lat/gps_lng:
// once the user corrects a photo, the stored coordinate (not the EXIF in the
// file) is the source of truth, and the map's resolution chain already puts
// stored GPS first. "clear" nulls the GPS so the photo falls back to its
// owner's location (experience, destination, or the trip's first destination).
export async function setPhotoLocation(
  photoId: string,
  target: PhotoLocationTarget,
): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const { supabase, user } = await requireUser();

  let patch: { gps_lat: number | null; gps_lng: number | null };
  if (target === "clear") {
    patch = { gps_lat: null, gps_lng: null };
  } else {
    // Coordinates come from the user's own destination row (RLS-scoped), not
    // from the client, so the override can never point at arbitrary input.
    const { data: dest, error } = await supabase
      .from("destinations")
      .select("latitude, longitude")
      .eq("user_id", user.id)
      .eq("id", target.destinationId)
      .maybeSingle();
    if (error || !dest || dest.latitude == null || dest.longitude == null) {
      return { error: "That destination has no coordinates to use." };
    }
    patch = {
      gps_lat: dest.latitude as number,
      gps_lng: dest.longitude as number,
    };
  }

  const { error } = await supabase
    .from("photos")
    .update(patch)
    .eq("id", photoId);
  if (error) return { error: "Could not update the photo location." };

  revalidateAppData();
  return { ok: true };
}

export type DeletePhotosResult = PhotoDeleteOutcome;

// Delete a batch of photos in ONE action round trip. The previous approach
// (one action call per photo from the client) serialized N requests, each
// re-rendering the whole app via revalidation; on a flaky mobile connection an
// interrupted or rejected request silently stranded the remaining deletes
// while the UI had already hidden the photos, so they "resurrected" later.
// This action processes every id server-side in a single request and reports
// per-photo outcomes.
//
// The delete itself (cover pointer clearing, row deletes, best-effort Storage
// cleanup) lives in deletePhotosByIds, shared with the entity delete actions
// that take a trip's, destination's, or experience's photos with them.
export async function deletePhotoRecords(
  ids: string[],
): Promise<DeletePhotosResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  if (ids.length === 0) return { ok: true, failedIds: [] };
  const { supabase } = await requireUser();

  const result = await deletePhotosByIds(supabase, ids);
  if ("error" in result) return result;

  revalidateAppData();
  return result;
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
export async function reorderPhotos(
  orderedIds: string[],
): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  if (orderedIds.length === 0) return { ok: true };
  const { supabase, user } = await requireUser();

  // All photos must belong to a single owner; a cross-owner reorder would
  // corrupt the galleries it touches.
  const { data: rows } = await supabase
    .from("photos")
    .select("id, owner_type, owner_id")
    .eq("user_id", user.id)
    .in("id", orderedIds);
  const photos = (rows ?? []) as Pick<
    Photo,
    "id" | "owner_type" | "owner_id"
  >[];
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

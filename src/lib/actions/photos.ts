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
 */

"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/current-user";
import { createAdminClient } from "@/utils/supabase/admin";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { isDemoBlocked } from "@/lib/demo-guard";
import { PHOTO_BUCKET, type InsertPhotoInput } from "@/lib/photos";
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

  let { data, error } = await supabase
    .from("photos")
    .insert(payload)
    .select("id")
    .single();
  // Databases created before the GPS columns existed reject the insert with a
  // schema error. Retry without the GPS fields so the upload never fails just
  // because coordinates could not be stored.
  if (error && hasGps) {
    delete payload.gps_lat;
    delete payload.gps_lng;
    ({ data, error } = await supabase
      .from("photos")
      .insert(payload)
      .select("id")
      .single());
  }
  if (error || !data) return { error: "Could not save the photo." };

  revalidatePath("/dashboard");
  revalidatePath("/trips/[id]", "page");
  revalidatePath("/trips/[id]/destinations/[destId]", "page");
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

  revalidatePath("/dashboard");
  revalidatePath("/trips/[id]", "page");
  revalidatePath("/trips/[id]/destinations/[destId]", "page");
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

  revalidatePath("/dashboard");
  revalidatePath("/trips/[id]", "page");
  revalidatePath("/trips/[id]/destinations/[destId]", "page");
  return { ok: true };
}

export async function deletePhotoRecord(id: string): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const { supabase } = await requireUser();

  const { data: photo } = await supabase
    .from("photos")
    .select("id,owner_type,owner_id,source,storage_path")
    .eq("id", id)
    .maybeSingle<Pick<Photo, "id" | "owner_type" | "owner_id" | "source" | "storage_path">>();
  if (!photo) return { error: "Photo not found." };

  // Clear cover pointers first so the foreign key never dangles. A trip's
  // cover can reference a destination-owned photo (set from the trip gallery),
  // so both tables are checked by pointer rather than by the photo's owner.
  await Promise.all([
    supabase.from("trips").update({ cover_photo_id: null }).eq("cover_photo_id", id),
    supabase
      .from("destinations")
      .update({ cover_photo_id: null })
      .eq("cover_photo_id", id),
  ]);

  const { error } = await supabase.from("photos").delete().eq("id", id);
  if (error) return { error: "Could not delete the photo." };

  // Remove the Storage object for uploads.
  if (photo.source === "upload" && photo.storage_path) {
    await createAdminClient()
      .storage.from(PHOTO_BUCKET)
      .remove([photo.storage_path]);
  }

  revalidatePath("/dashboard");
  revalidatePath("/trips/[id]", "page");
  revalidatePath("/trips/[id]/destinations/[destId]", "page");
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

  revalidatePath("/dashboard");
  revalidatePath("/trips/[id]", "page");
  revalidatePath("/trips/[id]/destinations/[destId]", "page");
  return { ok: true };
}

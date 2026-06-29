/*
 * DATABASE CHANGES REQUIRED (run in Supabase SQL editor before deploying):
 *
 * ALTER TABLE batchport.trips ADD COLUMN IF NOT EXISTS cover_position jsonb DEFAULT '{"x": 50, "y": 50}';
 * ALTER TABLE batchport.destinations ADD COLUMN IF NOT EXISTS cover_position jsonb DEFAULT '{"x": 50, "y": 50}';
 * ALTER TABLE batchport.photos ADD COLUMN IF NOT EXISTS date_taken timestamptz;
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

  const { data, error } = await supabase
    .from("photos")
    .insert(payload)
    .select("id")
    .single();
  if (error || !data) return { error: "Could not save the photo." };

  revalidatePath("/dashboard");
  return { ok: true, photoId: data.id as string };
}

export async function setCoverPhoto(
  ownerType: PhotoOwnerType,
  ownerId: string,
  photoId: string,
  position?: { x: number; y: number },
): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const { supabase } = await requireUser();
  const table = ownerType === "trip" ? "trips" : "destinations";
  const patch =
    position !== undefined
      ? { cover_photo_id: photoId, cover_position: { x: position.x, y: position.y } }
      : { cover_photo_id: photoId };
  const { error } = await supabase.from(table).update(patch).eq("id", ownerId);
  if (error) return { error: "Could not set the cover photo." };

  revalidatePath("/dashboard");
  if (ownerType === "trip") revalidatePath(`/trips/${ownerId}`);
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

  // Clear the cover pointer first so the foreign key never dangles. Only trips
  // and destinations have a cover; experience photos have none.
  if (photo.owner_type === "trip" || photo.owner_type === "destination") {
    const table = photo.owner_type === "trip" ? "trips" : "destinations";
    await supabase
      .from(table)
      .update({ cover_photo_id: null })
      .eq("id", photo.owner_id)
      .eq("cover_photo_id", id);
  }

  const { error } = await supabase.from("photos").delete().eq("id", id);
  if (error) return { error: "Could not delete the photo." };

  // Remove the Storage object for uploads.
  if (photo.source === "upload" && photo.storage_path) {
    await createAdminClient()
      .storage.from(PHOTO_BUCKET)
      .remove([photo.storage_path]);
  }

  revalidatePath("/dashboard");
  return { ok: true };
}

// Swap the order_index of a photo with its left or right neighbor in the same owner.
export async function reorderPhoto(
  photoId: string,
  direction: "left" | "right",
): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const { supabase } = await requireUser();

  const { data: photo } = await supabase
    .from("photos")
    .select("id, owner_type, owner_id, order_index")
    .eq("id", photoId)
    .maybeSingle<Pick<Photo, "id" | "owner_type" | "owner_id" | "order_index">>();
  if (!photo) return { error: "Photo not found." };

  let neighborQuery = supabase
    .from("photos")
    .select("id, order_index")
    .eq("owner_type", photo.owner_type)
    .eq("owner_id", photo.owner_id);

  if (direction === "left") {
    neighborQuery = neighborQuery
      .lt("order_index", photo.order_index)
      .order("order_index", { ascending: false });
  } else {
    neighborQuery = neighborQuery
      .gt("order_index", photo.order_index)
      .order("order_index", { ascending: true });
  }

  const { data: neighbor } = await neighborQuery.limit(1).maybeSingle<Pick<Photo, "id" | "order_index">>();
  if (!neighbor) return { ok: true }; // Already at the edge, no-op.

  // Use a temporary index to avoid any unique constraint conflict during swap.
  const tempIndex = -999999;
  await supabase.from("photos").update({ order_index: tempIndex }).eq("id", photoId);
  await supabase
    .from("photos")
    .update({ order_index: photo.order_index })
    .eq("id", neighbor.id);
  await supabase
    .from("photos")
    .update({ order_index: neighbor.order_index })
    .eq("id", photoId);

  revalidatePath("/dashboard");
  return { ok: true };
}

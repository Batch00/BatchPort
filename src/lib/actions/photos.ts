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

  const { data, error } = await supabase
    .from("photos")
    .insert({
      user_id: user.id,
      owner_type: input.ownerType,
      owner_id: input.ownerId,
      source: input.source,
      storage_path: input.storagePath ?? null,
      external_url: input.externalUrl ?? null,
      attribution: input.attribution ?? null,
      order_index: nextOrder,
    })
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
): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const { supabase } = await requireUser();
  const table = ownerType === "trip" ? "trips" : "destinations";
  const { error } = await supabase
    .from(table)
    .update({ cover_photo_id: photoId })
    .eq("id", ownerId);
  if (error) return { error: "Could not set the cover photo." };

  revalidatePath("/dashboard");
  if (ownerType === "trip") revalidatePath(`/trips/${ownerId}`);
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

  // Remove the Storage object for uploads. The admin client makes cleanup
  // reliable regardless of Storage row-level policies.
  if (photo.source === "upload" && photo.storage_path) {
    await createAdminClient()
      .storage.from(PHOTO_BUCKET)
      .remove([photo.storage_path]);
  }

  revalidatePath("/dashboard");
  return { ok: true };
}

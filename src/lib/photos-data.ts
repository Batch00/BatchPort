import { requireUser } from "@/lib/current-user";
import { getWikimediaPhoto } from "@/lib/wikimedia";
import { PHOTO_COLUMNS, formatWikimediaAttribution } from "@/lib/photos";
import type { Photo, PhotoOwnerType } from "@/lib/types";

// pickCover lives in the client-safe photos module; re-export it so server
// callers can import cover helpers and reads from one place.
export { pickCover } from "@/lib/photos";

// Server-side reads for photos. These run with the user's session, so
// row-level security scopes every query to the current user.

// All photos for one entity, ordered for display.
export async function getPhotos(
  ownerType: PhotoOwnerType,
  ownerId: string,
): Promise<Photo[]> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("photos")
    .select(PHOTO_COLUMNS)
    .eq("owner_type", ownerType)
    .eq("owner_id", ownerId)
    .order("order_index", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Photo[];
}

// Photos for many entities of the same type in one query. Used to gather every
// destination's photos for a trip.
export async function getPhotosForOwners(
  ownerType: PhotoOwnerType,
  ownerIds: string[],
): Promise<Photo[]> {
  if (ownerIds.length === 0) return [];
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("photos")
    .select(PHOTO_COLUMNS)
    .eq("owner_type", ownerType)
    .in("owner_id", ownerIds)
    .order("order_index", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Photo[];
}

// Resolve specific photo records by id. Used to look up trip cover photos for
// the dashboard cards.
export async function getPhotosByIds(ids: string[]): Promise<Photo[]> {
  if (ids.length === 0) return [];
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("photos")
    .select(PHOTO_COLUMNS)
    .in("id", ids);
  if (error) throw error;
  return (data ?? []) as Photo[];
}

// Best-effort: fetch a Wikimedia lead image for a freshly created destination,
// store it as a photo record, and set it as the destination cover. Runs in the
// background of destination creation, so any failure is swallowed.
export async function autoPopulateDestinationCover(destination: {
  id: string;
  name: string;
}): Promise<void> {
  try {
    const photo = await getWikimediaPhoto(destination.name);
    if (!photo.url) return;

    const { supabase, user } = await requireUser();
    const { data, error } = await supabase
      .from("photos")
      .insert({
        user_id: user.id,
        owner_type: "destination",
        owner_id: destination.id,
        source: "wikimedia",
        external_url: photo.url,
        attribution: formatWikimediaAttribution(
          photo.attribution,
          photo.license,
        ),
        order_index: 0,
      })
      .select("id")
      .single();
    if (error || !data) return;

    await supabase
      .from("destinations")
      .update({ cover_photo_id: data.id })
      .eq("id", destination.id);
  } catch {
    // Auto-population is a nicety; never block destination creation on it.
  }
}

import { requireUser } from "@/lib/current-user";
import { getWikimediaPhoto } from "@/lib/wikimedia";
import {
  PHOTO_COLUMNS,
  PHOTO_COLUMNS_CURATED,
  formatWikimediaAttribution,
  isMissingPhotoColumn,
} from "@/lib/photos";
import type { Photo, PhotoOwnerType } from "@/lib/types";

// pickCover lives in the client-safe photos module; re-export it so server
// callers can import cover helpers and reads from one place.
export { pickCover } from "@/lib/photos";

// Server-side reads for photos. These run with the user's session, so
// row-level security scopes every query to the current user.

interface PhotoQueryResult {
  data: unknown;
  error: { code?: string } | null;
}

// Every read here asks for the curation column and retries without it when the
// database does not have it yet. One helper rather than a retry at each call
// site: the three reads below feed the trip page, the destination page, and
// the galleries on both, which is every surface that can feature a photo or
// render one that was featured.
async function selectPhotos(
  build: (columns: string) => PromiseLike<PhotoQueryResult>,
): Promise<Photo[]> {
  let { data, error } = await build(PHOTO_COLUMNS_CURATED);
  if (isMissingPhotoColumn(error)) {
    ({ data, error } = await build(PHOTO_COLUMNS));
  }
  if (error) throw error;
  return ((data ?? []) as Photo[]).map(normalizePhoto);
}

/** A row from a database without the curation columns reads as uncurated. A
 * row that has a rank but no slot is a stop pick, which is what a bare rank
 * meant before the slot column existed (see lib/curation.ts). */
function normalizePhoto(row: Photo): Photo {
  const rank = typeof row.featured_rank === "number" ? row.featured_rank : null;
  const slot =
    row.featured_slot === "hero" || row.featured_slot === "stop"
      ? row.featured_slot
      : rank !== null
        ? "stop"
        : null;
  return { ...row, featured_rank: rank, featured_slot: slot };
}

// All photos for one entity, ordered for display.
export async function getPhotos(
  ownerType: PhotoOwnerType,
  ownerId: string,
): Promise<Photo[]> {
  const { supabase } = await requireUser();
  return selectPhotos((columns) =>
    supabase
      .from("photos")
      .select(columns)
      .eq("owner_type", ownerType)
      .eq("owner_id", ownerId)
      .order("order_index", { ascending: true })
      .order("created_at", { ascending: true }),
  );
}

// Photos for many entities of the same type in one query. Used to gather every
// destination's photos for a trip.
export async function getPhotosForOwners(
  ownerType: PhotoOwnerType,
  ownerIds: string[],
): Promise<Photo[]> {
  if (ownerIds.length === 0) return [];
  const { supabase } = await requireUser();
  return selectPhotos((columns) =>
    supabase
      .from("photos")
      .select(columns)
      .eq("owner_type", ownerType)
      .in("owner_id", ownerIds)
      .order("order_index", { ascending: true })
      .order("created_at", { ascending: true }),
  );
}

// Resolve specific photo records by id. Used to look up trip cover photos for
// the dashboard cards.
export async function getPhotosByIds(ids: string[]): Promise<Photo[]> {
  if (ids.length === 0) return [];
  const { supabase } = await requireUser();
  return selectPhotos((columns) =>
    supabase.from("photos").select(columns).in("id", ids),
  );
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

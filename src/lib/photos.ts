import type { CSSProperties } from "react";

import { createClient } from "@/utils/supabase/client";
import type {
  CoverPosition,
  Photo,
  PhotoOwnerType,
  PhotoSource,
} from "@/lib/types";

// The fields a client passes when persisting a photo record via the
// insertPhotoRecord server action.
export interface InsertPhotoInput {
  ownerType: PhotoOwnerType;
  ownerId: string;
  source: PhotoSource;
  storagePath?: string | null;
  externalUrl?: string | null;
  attribution?: string | null;
  dateTaken?: string | null;
  // EXIF GPS coordinates from the original file, when present.
  gpsLat?: number | null;
  gpsLng?: number | null;
  // SHA-256 of the original file content, used for duplicate detection.
  fingerprint?: string | null;
}

// Shared photo helpers. These are safe to import from both server and client:
// the functions that touch the browser (canvas resize, Storage upload) are only
// ever invoked client-side, while getPhotoUrl is pure and used everywhere.

// The single public Storage bucket shared by the app.
export const PHOTO_BUCKET = "batchport";

const DEFAULT_MAX_WIDTH = 1920;
const DEFAULT_MAX_HEIGHT = 1080;
const DEFAULT_QUALITY = 0.85;

// Client-side downscale + re-encode via canvas. Keeps uploads small without any
// server-side image processing. Returns a Blob; the output mime mirrors the
// source for png/webp, otherwise jpeg.
export function resizeImage(
  file: File,
  maxWidth: number = DEFAULT_MAX_WIDTH,
  maxHeight: number = DEFAULT_MAX_HEIGHT,
  quality: number = DEFAULT_QUALITY,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(
        1,
        maxWidth / image.width,
        maxHeight / image.height,
      );
      const width = Math.round(image.width * scale);
      const height = Math.round(image.height * scale);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Canvas is not supported in this browser."));
        return;
      }
      context.drawImage(image, 0, 0, width, height);

      const outputType =
        file.type === "image/png"
          ? "image/png"
          : file.type === "image/webp"
            ? "image/webp"
            : "image/jpeg";
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Could not encode the resized image."));
        },
        outputType,
        quality,
      );
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read the image file."));
    };
    image.src = objectUrl;
  });
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

// SHA-256 of the original file bytes as a hex string. crypto.subtle hashes off
// the main thread, so this stays cheap even for multi-megabyte phone photos.
// Content hashing (rather than name + size + mtime) survives renames and
// re-downloads, which is where duplicate uploads actually come from.
export async function computeFingerprint(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// Whether a photo with this content fingerprint already exists for the owner.
// Runs on the browser client; RLS scopes the check to the current user.
export async function isDuplicatePhoto(
  ownerType: PhotoOwnerType,
  ownerId: string,
  fingerprint: string,
): Promise<boolean> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("photos")
    .select("id")
    .eq("owner_type", ownerType)
    .eq("owner_id", ownerId)
    .eq("fingerprint", fingerprint)
    .limit(1);
  // On error (e.g. the fingerprint column is missing), fail open: never block
  // an upload because the duplicate check itself failed.
  if (error) return false;
  return (data ?? []).length > 0;
}

// Upload an already-resized blob to Storage at
// {userId}/{ownerType}/{ownerId}/{ts}_{name}. Returns the storage path to
// persist on the photo record.
export async function uploadPhotoBlob(
  blob: Blob,
  originalName: string,
  userId: string,
  ownerType: PhotoOwnerType,
  ownerId: string,
): Promise<string> {
  const supabase = createClient();
  const path = `${userId}/${ownerType}/${ownerId}/${Date.now()}_${sanitizeFilename(
    originalName,
  )}`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, {
    contentType: blob.type,
    upsert: false,
    // Photos are immutable once uploaded (new content gets a new path), so
    // the CDN and browser can cache them for a year.
    cacheControl: "31536000",
  });
  if (error) throw error;
  return path;
}

// Resize then upload. Kept for callers that do not need separate status
// reporting for the resize and upload steps.
export async function uploadPhoto(
  file: File,
  userId: string,
  ownerType: PhotoOwnerType,
  ownerId: string,
): Promise<string> {
  const resized = await resizeImage(file);
  return uploadPhotoBlob(resized, file.name, userId, ownerType, ownerId);
}

export async function deletePhoto(storagePath: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .remove([storagePath]);
  if (error) throw error;
}

// Compose the single attribution string stored on a photo record from the
// author and license returned by the Wikimedia API. Pure, so it is shared by
// the server fetch and the client cover picker.
export function formatWikimediaAttribution(
  attribution: string | null,
  license: string | null,
): string {
  const credit = attribution ?? "Unknown author";
  const tail = license ? `${credit} (${license})` : credit;
  return `${tail} via Wikimedia Commons`;
}

// Shared cover aspect ratios so a cover crops identically everywhere a given
// context appears. Cards (dashboard and share trip cards) are 16:9; banners
// (trip and destination detail headers) are wider, with a minimum height so
// overlaid titles and actions always fit.
export const COVER_CARD_ASPECT = "aspect-video";
export const COVER_BANNER_ASPECT = "aspect-[3/1] min-h-48 sm:min-h-56";

// Default gallery order: date taken ascending when known; photos without a
// date sort after dated ones, falling back to manual order then upload time.
export function compareByDateTaken(a: Photo, b: Photo): number {
  const aDate = a.date_taken;
  const bDate = b.date_taken;
  if (aDate && bDate && aDate !== bDate) return aDate < bDate ? -1 : 1;
  if (aDate && !bDate) return -1;
  if (!aDate && bDate) return 1;
  if (a.order_index !== b.order_index) return a.order_index - b.order_index;
  return a.created_at < b.created_at ? -1 : 1;
}

// Client-side fetch of every photo attached to a trip at any level (the trip
// itself, its destinations, and their experiences). Used by the dashboard
// cover editor, which loads photos lazily on open instead of shipping every
// trip's gallery with the dashboard payload. RLS scopes results to the user.
export async function fetchTripGalleryPhotos(
  tripId: string,
  destinationIds: string[],
  experienceIds: string[],
): Promise<Photo[]> {
  const supabase = createClient();
  const queries = [
    supabase
      .from("photos")
      .select("*")
      .eq("owner_type", "trip")
      .eq("owner_id", tripId),
    destinationIds.length > 0
      ? supabase
          .from("photos")
          .select("*")
          .eq("owner_type", "destination")
          .in("owner_id", destinationIds)
      : null,
    experienceIds.length > 0
      ? supabase
          .from("photos")
          .select("*")
          .eq("owner_type", "experience")
          .in("owner_id", experienceIds)
      : null,
  ].filter((query) => query !== null);
  const results = await Promise.all(queries);
  const photos: Photo[] = [];
  for (const result of results) {
    if (result.error) throw result.error;
    photos.push(...((result.data ?? []) as Photo[]));
  }
  return photos.sort(compareByDateTaken);
}

// Pick the cover photo for an owner from its photo list: the explicit cover if
// it is present, otherwise the first photo, otherwise null.
export function pickCover(
  photos: Photo[],
  coverPhotoId: string | null,
): Photo | null {
  if (coverPhotoId) {
    const match = photos.find((photo) => photo.id === coverPhotoId);
    if (match) return match;
  }
  return photos[0] ?? null;
}

// Inline style that applies a stored cover position (and optional zoom) to an
// object-cover image. object-position places the focal point at (x%, y%) of
// the container, and transform-origin at the same point means scale() zooms
// around that focal point, so the two compose without shifting the crop.
// Callers must clip the image (overflow-hidden) since the scaled element
// extends past its box. Returns undefined when there is nothing to apply.
export function coverImageStyle(
  position: CoverPosition | null | undefined,
): CSSProperties | undefined {
  if (!position) return undefined;
  const scale = position.scale ?? 1;
  const style: CSSProperties = {
    objectPosition: `${position.x}% ${position.y}%`,
  };
  if (scale !== 1) {
    style.transform = `scale(${scale})`;
    style.transformOrigin = `${position.x}% ${position.y}%`;
  }
  return style;
}

// The display URL for a photo. Any photo with a storage_path (uploads, and
// Wikimedia images the proxy has already cached into Storage) resolves to the
// public Storage CDN URL directly. Uncached Wikimedia images route through the
// proxy (which caches them for next time), and plain urls are returned as-is.
export function getPhotoUrl(
  photo: Pick<Photo, "source" | "storage_path" | "external_url">,
): string {
  if (photo.storage_path && photo.source !== "url") {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    return `${base}/storage/v1/object/public/${PHOTO_BUCKET}/${photo.storage_path}`;
  }
  if (photo.source === "wikimedia" && photo.external_url) {
    return `/api/photos/wikimedia/proxy?url=${encodeURIComponent(
      photo.external_url,
    )}`;
  }
  return photo.external_url ?? "";
}

import { createClient } from "@/utils/supabase/client";
import type { Photo, PhotoOwnerType, PhotoSource } from "@/lib/types";

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

// Resize then upload to Storage at {userId}/{ownerType}/{ownerId}/{ts}_{name}.
// Returns the storage path to persist on the photo record.
export async function uploadPhoto(
  file: File,
  userId: string,
  ownerType: PhotoOwnerType,
  ownerId: string,
): Promise<string> {
  const resized = await resizeImage(file);
  const supabase = createClient();
  const path = `${userId}/${ownerType}/${ownerId}/${Date.now()}_${sanitizeFilename(
    file.name,
  )}`;
  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, resized, { contentType: resized.type, upsert: false });
  if (error) throw error;
  return path;
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

// The display URL for a photo. Uploads resolve to the public Storage URL,
// Wikimedia images route through the proxy to avoid CORS and hotlinking, and
// plain urls are returned as-is.
export function getPhotoUrl(
  photo: Pick<Photo, "source" | "storage_path" | "external_url">,
): string {
  if (photo.source === "upload" && photo.storage_path) {
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

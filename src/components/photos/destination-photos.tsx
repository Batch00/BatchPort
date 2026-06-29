"use client";

import { useRouter } from "next/navigation";

import { PhotoUpload } from "@/components/photos/photo-upload";
import { PhotoGallery } from "@/components/photos/photo-gallery";
import type { Photo } from "@/lib/types";

interface DestinationPhotosProps {
  destinationId: string;
  userId: string;
  isDemo: boolean;
  photos: Photo[];
  coverPhotoId: string | null;
  coverPosition?: { x: number; y: number } | null;
}

// The photos section on the destination detail page: an upload dropzone over an
// editable gallery. Mutations refresh the route so the server re-supplies the
// updated photo list.
export function DestinationPhotos({
  destinationId,
  userId,
  isDemo,
  photos,
  coverPhotoId,
  coverPosition,
}: DestinationPhotosProps) {
  const router = useRouter();

  return (
    <section className="mt-10">
      <h2 className="mb-4 text-sm font-medium text-foreground/80">Photos</h2>

      <div className="flex flex-col gap-4">
        <PhotoUpload
          ownerType="destination"
          ownerId={destinationId}
          userId={userId}
          isDemo={isDemo}
          onUploaded={() => router.refresh()}
        />

        {photos.length > 0 ? (
          <PhotoGallery
            photos={photos}
            coverPhotoId={coverPhotoId}
            coverPosition={coverPosition}
            editable
            ownerType="destination"
            ownerId={destinationId}
            isDemo={isDemo}
            onChanged={() => router.refresh()}
          />
        ) : (
          <p className="rounded-xl border border-dashed border-white/10 px-6 py-8 text-center text-sm text-foreground/50">
            No photos yet. Add some from your trip.
          </p>
        )}
      </div>
    </section>
  );
}

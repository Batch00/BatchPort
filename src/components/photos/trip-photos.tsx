"use client";

import { useRouter } from "next/navigation";

import { PhotoGallery } from "@/components/photos/photo-gallery";
import type { Photo } from "@/lib/types";

interface TripPhotosProps {
  tripId: string;
  coverPhotoId: string | null;
  photos: Photo[];
}

// The aggregated photos section on the trip detail page. Photos here belong to
// the trip's destinations; choosing one sets the trip's cover. Deleting is left
// to the owning destination, so only the set-cover action is offered.
export function TripPhotos({ tripId, coverPhotoId, photos }: TripPhotosProps) {
  const router = useRouter();

  return (
    <section className="mt-10">
      <h2 className="mb-4 text-sm font-medium text-foreground/80">Photos</h2>
      <PhotoGallery
        photos={photos}
        coverPhotoId={coverPhotoId}
        editable
        allowDelete={false}
        ownerType="trip"
        ownerId={tripId}
        onChanged={() => router.refresh()}
      />
    </section>
  );
}

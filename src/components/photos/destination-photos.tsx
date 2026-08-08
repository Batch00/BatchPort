"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  PhotoUpload,
  type TagDestination,
} from "@/components/photos/photo-upload";
import { PhotoGallery } from "@/components/photos/photo-gallery";
import { cn } from "@/lib/utils";
import type { CoverPosition, Photo } from "@/lib/types";

interface DestinationPhotosProps {
  // The destination itself, passed as a taggable target so the review step
  // can optionally file photos under one of its experiences.
  destination: TagDestination;
  // The owning trip, offered as a second cover target ("Set as trip cover").
  tripId: string;
  userId: string;
  isDemo: boolean;
  photos: Photo[];
  // Photos owned by this destination's experiences. Shown in the main gallery
  // alongside the destination's own photos, narrowable with the filter pills.
  experiencePhotos: Photo[];
  coverPhotoId: string | null;
  coverPosition?: CoverPosition | null;
}

// The photos section on the destination detail page: an upload dropzone with a
// review step over an editable gallery of every photo at this stop, including
// experience-owned ones. Mutations refresh the route so the server re-supplies
// the updated photo list.
export function DestinationPhotos({
  destination,
  tripId,
  userId,
  isDemo,
  photos,
  experiencePhotos,
  coverPhotoId,
  coverPosition,
}: DestinationPhotosProps) {
  const router = useRouter();

  // null = all photos; "destination" = destination-owned only; otherwise an
  // experience id.
  const [filter, setFilter] = useState<string | null>(null);

  const allPhotos = [...photos, ...experiencePhotos];
  const filtered =
    filter === null
      ? allPhotos
      : filter === "destination"
        ? photos
        : experiencePhotos.filter((photo) => photo.owner_id === filter);

  const experiencePills = destination.experiences.filter((experience) =>
    experiencePhotos.some((photo) => photo.owner_id === experience.id),
  );
  const showPills = experiencePhotos.length > 0 && allPhotos.length > 0;

  return (
    <section className="mt-10">
      <h2 className="mb-4 text-sm font-medium text-foreground/80">Photos</h2>

      <div className="flex flex-col gap-4">
        <PhotoUpload
          ownerType="destination"
          ownerId={destination.id}
          userId={userId}
          isDemo={isDemo}
          tagDestinations={[destination]}
          onUploaded={() => router.refresh()}
        />

        {showPills ? (
          <div className="flex flex-wrap gap-2">
            <FilterPill active={filter === null} onClick={() => setFilter(null)}>
              All photos
            </FilterPill>
            {photos.length > 0 ? (
              <FilterPill
                active={filter === "destination"}
                onClick={() => setFilter("destination")}
              >
                {destination.name}
              </FilterPill>
            ) : null}
            {experiencePills.map((experience) => (
              <FilterPill
                key={experience.id}
                active={filter === experience.id}
                onClick={() => setFilter(experience.id)}
              >
                {experience.name}
              </FilterPill>
            ))}
          </div>
        ) : null}

        {filtered.length > 0 ? (
          <PhotoGallery
            photos={filtered}
            coverPhotoId={coverPhotoId}
            coverPosition={coverPosition}
            editable
            ownerType="destination"
            ownerId={destination.id}
            tripId={tripId}
            secondaryCoverTarget={() => ({ ownerType: "trip", ownerId: tripId })}
            retagDestinations={[destination]}
            isDemo={isDemo}
            onChanged={() => router.refresh()}
          />
        ) : allPhotos.length > 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 px-6 py-8 text-center text-sm text-foreground/50">
            No photos in this filter yet.
          </p>
        ) : (
          <p className="rounded-xl border border-dashed border-white/10 px-6 py-8 text-center text-sm text-foreground/50">
            No photos yet. Add some from your trip.
          </p>
        )}
      </div>
    </section>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-brand text-brand-foreground"
          : "bg-white/5 text-foreground/70 hover:bg-white/10 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

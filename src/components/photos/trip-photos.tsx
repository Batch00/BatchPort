"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2Icon, Trash2Icon } from "lucide-react";

import { PhotoUpload } from "@/components/photos/photo-upload";
import { PhotoGallery } from "@/components/photos/photo-gallery";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { retagPhoto, deletePhotoRecord } from "@/lib/actions/photos";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { getPhotoUrl } from "@/lib/photos";
import { cn } from "@/lib/utils";
import type { Photo } from "@/lib/types";

export interface TagDestination {
  id: string;
  name: string;
  experiences: { id: string; name: string }[];
}

interface TripPhotosSectionProps {
  tripId: string;
  userId: string;
  isDemo: boolean;
  coverPhotoId: string | null;
  coverPosition?: { x: number; y: number } | null;
  destinations: TagDestination[];
  untaggedPhotos: Photo[];
  taggedPhotos: Photo[];
}

const WHOLE_DESTINATION = "__whole__";

function photoInDestination(photo: Photo, destination: TagDestination): boolean {
  if (photo.owner_type === "destination" && photo.owner_id === destination.id) {
    return true;
  }
  return (
    photo.owner_type === "experience" &&
    destination.experiences.some((exp) => exp.id === photo.owner_id)
  );
}

// The trip detail photos section: bulk upload at the trip level, inline tagging
// of untagged photos into destinations/experiences, and a destination-filtered
// gallery of everything already sorted.
export function TripPhotosSection({
  tripId,
  userId,
  isDemo,
  coverPhotoId,
  coverPosition,
  destinations,
  untaggedPhotos,
  taggedPhotos,
}: TripPhotosSectionProps) {
  const router = useRouter();
  const refresh = () => router.refresh();

  const [activeDest, setActiveDest] = useState<string | null>(null);
  const [activeExp, setActiveExp] = useState<string | null>(null);

  const activeDestination =
    destinations.find((d) => d.id === activeDest) ?? null;

  const filtered = taggedPhotos.filter((photo) => {
    if (!activeDest) return true;
    if (activeExp) {
      return photo.owner_type === "experience" && photo.owner_id === activeExp;
    }
    return activeDestination ? photoInDestination(photo, activeDestination) : true;
  });

  // Only show destinations that actually have tagged photos as filter pills.
  const destinationsWithPhotos = destinations.filter((destination) =>
    taggedPhotos.some((photo) => photoInDestination(photo, destination)),
  );

  const experiencePills =
    activeDestination?.experiences.filter((exp) =>
      taggedPhotos.some(
        (photo) =>
          photo.owner_type === "experience" && photo.owner_id === exp.id,
      ),
    ) ?? [];

  const isEmpty = untaggedPhotos.length === 0 && taggedPhotos.length === 0;

  return (
    <section className="mt-10">
      <h2 className="mb-4 text-sm font-medium text-foreground/80">Photos</h2>

      <div className="flex flex-col gap-5">
        <PhotoUpload
          ownerType="trip"
          ownerId={tripId}
          userId={userId}
          isDemo={isDemo}
          onUploaded={refresh}
        />

        {untaggedPhotos.length > 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium text-foreground/60">
              Untagged photos ({untaggedPhotos.length}). Sort each into a
              destination or experience.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {untaggedPhotos.map((photo) => (
                <UntaggedPhoto
                  key={photo.id}
                  photo={photo}
                  destinations={destinations}
                  isDemo={isDemo}
                  onChanged={refresh}
                />
              ))}
            </div>
          </div>
        ) : null}

        {taggedPhotos.length > 0 ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <FilterPill
                active={!activeDest}
                onClick={() => {
                  setActiveDest(null);
                  setActiveExp(null);
                }}
              >
                All photos
              </FilterPill>
              {destinationsWithPhotos.map((destination) => (
                <FilterPill
                  key={destination.id}
                  active={activeDest === destination.id}
                  onClick={() => {
                    setActiveDest(destination.id);
                    setActiveExp(null);
                  }}
                >
                  {destination.name}
                </FilterPill>
              ))}
            </div>

            {experiencePills.length > 0 ? (
              <div className="flex flex-wrap gap-2 border-t border-white/5 pt-3">
                <FilterPill small active={!activeExp} onClick={() => setActiveExp(null)}>
                  All of {activeDestination?.name}
                </FilterPill>
                {experiencePills.map((exp) => (
                  <FilterPill
                    key={exp.id}
                    small
                    active={activeExp === exp.id}
                    onClick={() => setActiveExp(exp.id)}
                  >
                    {exp.name}
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
                allowDelete={false}
                ownerType="trip"
                ownerId={tripId}
                retagDestinations={destinations}
                isDemo={isDemo}
                onChanged={refresh}
              />
            ) : (
              <p className="rounded-xl border border-dashed border-white/10 px-6 py-8 text-center text-sm text-foreground/50">
                No photos in this filter yet.
              </p>
            )}
          </div>
        ) : null}

        {isEmpty ? (
          <p className="rounded-xl border border-dashed border-white/10 px-6 py-8 text-center text-sm text-foreground/50">
            No photos yet. Upload some to get started.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function FilterPill({
  active,
  small,
  onClick,
  children,
}: {
  active: boolean;
  small?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full font-medium transition-colors",
        small ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
        active
          ? "bg-brand text-brand-foreground"
          : "bg-white/5 text-foreground/70 hover:bg-white/10 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function UntaggedPhoto({
  photo,
  destinations,
  isDemo,
  onChanged,
}: {
  photo: Photo;
  destinations: TagDestination[];
  isDemo: boolean;
  onChanged: () => void;
}) {
  const [destId, setDestId] = useState<string>("");
  const [expId, setExpId] = useState<string>(WHOLE_DESTINATION);
  const [busy, setBusy] = useState(false);

  const destination = destinations.find((d) => d.id === destId) ?? null;

  async function apply() {
    if (isDemo) {
      toast.error(DEMO_READONLY_MESSAGE);
      return;
    }
    if (!destId) {
      toast.error("Choose a destination.");
      return;
    }
    setBusy(true);
    const taggingExperience = expId !== WHOLE_DESTINATION;
    const result = await retagPhoto(
      photo.id,
      taggingExperience ? "experience" : "destination",
      taggingExperience ? expId : destId,
    );
    setBusy(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success("Photo tagged.");
    onChanged();
  }

  async function remove() {
    if (isDemo) {
      toast.error(DEMO_READONLY_MESSAGE);
      return;
    }
    setBusy(true);
    const result = await deletePhotoRecord(photo.id);
    setBusy(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success("Photo deleted.");
    onChanged();
  }

  return (
    <div className="flex gap-3 rounded-lg bg-white/[0.02] p-3 ring-1 ring-foreground/10">
      <div className="size-20 shrink-0 overflow-hidden rounded-md bg-white/5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={getPhotoUrl(photo)}
          alt=""
          className="size-full object-cover"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Select
          value={destId}
          onValueChange={(value) => {
            setDestId(value);
            setExpId(WHOLE_DESTINATION);
          }}
        >
          <SelectTrigger className="h-8" aria-label="Destination">
            <SelectValue placeholder="Tag to destination" />
          </SelectTrigger>
          <SelectContent>
            {destinations.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {destination && destination.experiences.length > 0 ? (
          <Select value={expId} onValueChange={setExpId}>
            <SelectTrigger className="h-8" aria-label="Experience">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={WHOLE_DESTINATION}>Whole destination</SelectItem>
              {destination.experiences.map((exp) => (
                <SelectItem key={exp.id} value={exp.id}>
                  {exp.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={apply}
            disabled={busy || !destId}
            className="bg-brand text-brand-foreground hover:bg-brand/90"
          >
            {busy ? <Loader2Icon className="size-4 animate-spin" /> : "Tag"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={remove}
            disabled={busy}
            aria-label="Delete photo"
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>
    </div>
  );
}

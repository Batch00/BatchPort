"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDownIcon, ImageIcon, Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PhotoUpload } from "@/components/photos/photo-upload";
import { insertPhotoRecord, setCoverPhoto } from "@/lib/actions/photos";
import {
  getPhotoUrl,
  pickCover,
  formatWikimediaAttribution,
} from "@/lib/photos";
import { cn } from "@/lib/utils";
import type { Photo, PhotoOwnerType } from "@/lib/types";

interface WikimediaSuggestion {
  url: string | null;
  attribution: string | null;
  license: string | null;
}

interface CoverPhotoPickerProps {
  ownerType: PhotoOwnerType;
  // Undefined while the owner has not been created yet (create forms).
  ownerId?: string;
  userId: string;
  isDemo: boolean;
  photos: Photo[];
  coverPhotoId: string | null;
  // A place name used to fetch a Wikimedia suggestion when no cover is set.
  suggestQuery?: string;
}

export function CoverPhotoPicker({
  ownerType,
  ownerId,
  userId,
  isDemo,
  photos,
  coverPhotoId,
  suggestQuery,
}: CoverPhotoPickerProps) {
  const router = useRouter();
  const cover = pickCover(photos, coverPhotoId);
  const [mode, setMode] = useState<"idle" | "upload" | "gallery">("idle");
  const [suggestion, setSuggestion] = useState<WikimediaSuggestion | null>(null);
  const [applying, setApplying] = useState(false);

  // Offer a Wikimedia suggestion only when there is no cover yet.
  useEffect(() => {
    if (cover || !suggestQuery) return;
    let active = true;
    fetch(`/api/photos/wikimedia?q=${encodeURIComponent(suggestQuery)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: WikimediaSuggestion | null) => {
        if (active && data?.url) setSuggestion(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [cover, suggestQuery]);

  function refresh() {
    setMode("idle");
    router.refresh();
  }

  async function applyGalleryChoice(photo: Photo) {
    if (!ownerId) return;
    const result = await setCoverPhoto(ownerType, ownerId, photo.id);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success("Cover photo updated.");
    refresh();
  }

  async function applySuggestion() {
    if (!ownerId || !suggestion?.url) return;
    if (isDemo) {
      toast.error("Demo accounts are read-only.");
      return;
    }
    setApplying(true);
    const inserted = await insertPhotoRecord({
      ownerType,
      ownerId,
      source: "wikimedia",
      externalUrl: suggestion.url,
      attribution: formatWikimediaAttribution(
        suggestion.attribution,
        suggestion.license,
      ),
    });
    if ("error" in inserted) {
      setApplying(false);
      toast.error(inserted.error);
      return;
    }
    await setCoverPhoto(ownerType, ownerId, inserted.photoId);
    setApplying(false);
    toast.success("Cover photo set.");
    refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-4">
        <div className="relative aspect-[16/10] w-40 shrink-0 overflow-hidden rounded-lg ring-1 ring-foreground/10">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={getPhotoUrl(cover)}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center bg-white/5 text-foreground/30">
              <ImageIcon className="size-6" />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm text-foreground/70">
            {cover ? "Current cover photo" : "No cover photo yet"}
          </p>
          {ownerId ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  Change cover
                  <ChevronDownIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => setMode("upload")}>
                  Upload new
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setMode("gallery")}
                  disabled={photos.length === 0}
                >
                  Choose from gallery
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <p className="max-w-xs text-xs text-foreground/40">
              You can set a cover photo once this {ownerType} is created.
            </p>
          )}
        </div>
      </div>

      {ownerId && mode === "upload" ? (
        <PhotoUpload
          ownerType={ownerType}
          ownerId={ownerId}
          userId={userId}
          isDemo={isDemo}
          setCoverOnUpload
          onUploaded={() => refresh()}
        />
      ) : null}

      {ownerId && mode === "gallery" ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((photo) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => applyGalleryChoice(photo)}
              className={cn(
                "relative aspect-square overflow-hidden rounded-md ring-1 transition-all",
                photo.id === cover?.id
                  ? "ring-2 ring-brand"
                  : "ring-foreground/10 hover:ring-brand/50",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getPhotoUrl(photo)}
                alt=""
                loading="lazy"
                className="size-full object-cover"
              />
            </button>
          ))}
        </div>
      ) : null}

      {ownerId && !cover && suggestion?.url ? (
        <div className="flex items-center gap-3 rounded-lg border border-brand/20 bg-brand/5 p-3">
          <div className="relative aspect-[16/10] w-28 shrink-0 overflow-hidden rounded-md ring-1 ring-foreground/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getPhotoUrl({
                source: "wikimedia",
                external_url: suggestion.url,
                storage_path: null,
              })}
              alt=""
              className="size-full object-cover"
            />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm text-foreground/80">Use suggested photo?</p>
            <Button
              type="button"
              size="sm"
              disabled={applying}
              onClick={applySuggestion}
              className="bg-brand text-brand-foreground hover:bg-brand/90"
            >
              {applying ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                "Use this photo"
              )}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

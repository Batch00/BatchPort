"use client";

import { useEffect, useState } from "react";
import { XIcon } from "lucide-react";

import { Lightbox } from "@/components/photos/lightbox";
import { SafeImage } from "@/components/photos/safe-image";
import type { UnlocatedPhoto } from "@/lib/photo-map-data";

// A viewer for photos that could not be placed on the map (no GPS and no owner
// coordinates). They cannot be pinned, so photo map mode surfaces them here as
// a simple grid, and each opens in the shared lightbox. This keeps every photo
// reachable even when it is unmappable.
export function UnlocatedPhotosModal({
  photos,
  onClose,
}: {
  photos: UnlocatedPhoto[];
  onClose: () => void;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Escape closes the lightbox first, then the modal. Arrows step the lightbox.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (lightboxIndex !== null) setLightboxIndex(null);
        else onClose();
      }
      if (lightboxIndex === null) return;
      if (event.key === "ArrowRight") {
        setLightboxIndex((i) => (i === null ? i : (i + 1) % photos.length));
      }
      if (event.key === "ArrowLeft") {
        setLightboxIndex((i) =>
          i === null ? i : (i - 1 + photos.length) % photos.length,
        );
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIndex, photos.length, onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 sm:p-8"
        onClick={onClose}
      >
        <div
          className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0a] shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-3.5">
            <div>
              <h2 className="text-sm font-medium text-foreground">
                Photos without a location
              </h2>
              <p className="mt-0.5 text-xs text-foreground/50">
                {photos.length}{" "}
                {photos.length === 1 ? "photo has" : "photos have"} no GPS or
                place to map, so they live here.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-foreground/70 transition-colors hover:bg-white/10 hover:text-foreground"
            >
              <XIcon className="size-4" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1.5 overflow-y-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:grid-cols-4">
            {photos.map((photo, index) => {
              const caption =
                [photo.destinationName, photo.tripName]
                  .filter(Boolean)
                  .join(" · ") || null;
              return (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => setLightboxIndex(index)}
                  className="group relative aspect-square overflow-hidden rounded-md border border-white/10 bg-white/5 transition-colors hover:border-brand/40"
                >
                  <SafeImage
                    src={photo.thumbUrl}
                    alt={caption ?? ""}
                    loading="lazy"
                    className="size-full object-cover transition-transform group-hover:scale-105"
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {lightboxIndex !== null && photos[lightboxIndex] ? (
        (() => {
          const photo = photos[lightboxIndex];
          const caption =
            [photo.destinationName, photo.tripName]
              .filter(Boolean)
              .join(" · ") || null;
          return (
            <Lightbox
              item={{
                src: photo.fullUrl,
                dateTaken: photo.dateTaken,
                attribution: photo.attribution,
                caption,
              }}
              index={lightboxIndex}
              total={photos.length}
              onPrev={() =>
                setLightboxIndex(
                  (i) => (i === null ? i : (i - 1 + photos.length) % photos.length),
                )
              }
              onNext={() =>
                setLightboxIndex((i) =>
                  i === null ? i : (i + 1) % photos.length,
                )
              }
              onClose={() => setLightboxIndex(null)}
            />
          );
        })()
      ) : null}
    </>
  );
}

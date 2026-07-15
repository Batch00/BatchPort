import {
  COVER_BANNER_SHAPE,
  coverImageStyle,
  getPhotoUrl,
} from "@/lib/photos";
import { cn } from "@/lib/utils";
import type { CoverPosition, Photo } from "@/lib/types";

// A header banner for trips and destinations. Renders the cover photo behind a
// dark gradient so overlaid text stays readable, or a subtle gradient
// placeholder when there is no cover. Pure and server-renderable. All banners
// share COVER_BANNER_SHAPE (16:9 on phones, matching the cover crop editor and
// the trip cards; fixed heights from sm up), which also reserves the box
// before the image loads (no layout shift).
// w-full pins the box to its container; isolate forces a stacking context so
// Safari reliably clips the scaled (composited) cover image inside the
// rounded corners.
export function PhotoBanner({
  photo,
  coverPosition,
  className,
  children,
}: {
  photo: Photo | null;
  coverPosition?: CoverPosition | null;
  className?: string;
  children: React.ReactNode;
}) {

  return (
    <div
      className={cn(
        "relative isolate w-full max-w-full overflow-hidden rounded-2xl bg-gradient-to-br from-white/[0.08] to-transparent ring-1 ring-foreground/10",
        COVER_BANNER_SHAPE,
        className,
      )}
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={getPhotoUrl(photo)}
          alt=""
          loading="lazy"
          style={coverImageStyle(coverPosition)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/10" />
      <div className="relative flex size-full flex-col justify-end p-5 sm:p-6">
        {children}
      </div>
    </div>
  );
}

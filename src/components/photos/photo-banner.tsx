import type { CSSProperties } from "react";

import { COVER_BANNER_SHAPE, getPhotoUrl } from "@/lib/photos";
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
//
// Cover framing: the stored position/zoom was authored in the 16:9 crop
// dialog. On phones the banner is that same 16:9 shape, so both focal point
// and zoom apply verbatim. From sm up the banner is a much wider, shorter box
// where object-cover already crops far more of the image; layering the
// authored zoom on top is what made banners look "more zoomed" than the
// dashboard cards. So sm+ keeps only the focal point (object-position) and
// drops the zoom, biasing toward showing more of the image. The split is done
// with a CSS variable so the server-rendered markup stays responsive.
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
  const scale = coverPosition?.scale ?? 1;
  const hasZoom = Boolean(coverPosition) && scale !== 1;
  const imageStyle: CSSProperties | undefined = coverPosition
    ? ({
        objectPosition: `${coverPosition.x}% ${coverPosition.y}%`,
        ...(hasZoom
          ? {
              transformOrigin: `${coverPosition.x}% ${coverPosition.y}%`,
              "--cover-zoom": String(scale),
            }
          : {}),
      } as CSSProperties)
    : undefined;

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
          style={imageStyle}
          className={cn(
            "absolute inset-0 size-full object-cover",
            hasZoom && "[transform:scale(var(--cover-zoom))] sm:[transform:none]",
          )}
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/10" />
      <div className="relative flex size-full flex-col justify-end p-5 sm:p-6">
        {children}
      </div>
    </div>
  );
}

import { THUMB_MAX_DIM } from "@/lib/photos";

// A card cover that is sharp on every screen: one srcset (the thumbnail and
// the full image, each with its width descriptor) and an accurate `sizes`, at
// every viewport width, so the browser picks by device pixels everywhere.
//
// That is the point, phones included. A 340px phone card at 3x needs about
// 1000 device pixels, so the 400px thumbnail is upscaled 2.5x and visibly
// blurry; the previous version forced the thumbnail below 640px and shipped
// exactly that. A 1x screen with a small slot still gets the thumbnail,
// because that is what the srcset arithmetic picks there.
//
// Thumbnails alone are for small tiles and grids (gallery cells, recap tiles,
// the On This Day strip), never for a card cover. See CLAUDE.md, "Which Photo
// Size a Surface Requests".
//
// The width descriptors are the long edge each file is generated at
// (THUMB_MAX_DIM, and the 1920 resize cap). Covers render in 16:9 boxes, where
// the long edge is the width for the landscape photographs that make up most
// covers.

const FULL_MAX_DIM = 1920;

/** The srcset for a card cover, or null when there is only one file to offer
 * (an uncached Wikimedia image, whose thumbnail and full image are one url). */
export function coverSrcSet(
  thumbUrl: string | null | undefined,
  fullUrl: string | null | undefined,
): string | null {
  if (!thumbUrl || !fullUrl || thumbUrl === fullUrl) return null;
  return `${thumbUrl} ${THUMB_MAX_DIM}w, ${fullUrl} ${FULL_MAX_DIM}w`;
}

/** Trip cards: one column below sm inside p-6 (100vw - 48px); two from sm
 * inside max-w-6xl with sm:p-8 and gap-4, so (100vw - 64px - 16px) / 2,
 * capped at 536px. */
export const TRIP_CARD_SIZES =
  "(max-width: 639px) calc(100vw - 48px), (min-width: 1152px) 536px, calc(50vw - 40px)";

/** Bucket cards: one column below sm inside p-6, two from sm, three from lg,
 * inside max-w-5xl (the bucket page) or max-w-6xl (the share grid). The
 * larger container's width is used, since over-asking by a few pixels costs
 * less than a blurry card. */
export const BUCKET_CARD_SIZES =
  "(max-width: 639px) calc(100vw - 48px), (min-width: 1152px) 352px, (min-width: 1024px) calc(33vw - 32px), calc(50vw - 40px)";

export function CoverPicture({
  thumbUrl,
  fullUrl,
  sizes,
  alt = "",
  className,
  style,
  loading = "lazy",
}: {
  thumbUrl: string;
  fullUrl?: string | null;
  sizes: string;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  loading?: "lazy" | "eager";
}) {
  const srcSet = coverSrcSet(thumbUrl, fullUrl);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={thumbUrl}
      srcSet={srcSet ?? undefined}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      loading={loading}
      style={style}
      className={className}
    />
  );
}

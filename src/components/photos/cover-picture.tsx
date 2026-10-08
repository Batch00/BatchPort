import { THUMB_MAX_DIM } from "@/lib/photos";

// A card cover that is sharp on a wide or high-DPI screen and still loads the
// thumbnail on a phone.
//
// WHY A <picture> AND NOT A BARE srcset
//
// A srcset with an accurate `sizes` lets the browser choose by DEVICE pixels,
// and a 340px phone card at 2x or 3x wants 680 to 1020 of them, so a bare
// srcset sends every modern phone the full image. The rule for phones is the
// thumbnail (CLAUDE.md, "Which Photo Size a Surface Requests"), so the choice
// is split at the sm breakpoint instead:
//
//   - below WIDE_MEDIA the <img> src is the thumbnail, full stop;
//   - from WIDE_MEDIA up, a <source> offers both with an accurate `sizes`, and
//     the browser picks: a 300px slot at 1x keeps the thumbnail, a 536px card
//     or any 2x screen gets the full image.
//
// The width descriptors are the long edge each file is generated at
// (THUMB_MAX_DIM, and the 1920 resize cap). Covers render in 16:9 boxes, where
// the long edge is the width for the landscape photographs that make up most
// covers.

export const WIDE_MEDIA = "(min-width: 640px)";
const FULL_MAX_DIM = 1920;

/** The wide-screen srcset, or null when there is only one file to offer. */
export function coverSrcSet(
  thumbUrl: string | null | undefined,
  fullUrl: string | null | undefined,
): string | null {
  if (!thumbUrl || !fullUrl || thumbUrl === fullUrl) return null;
  return `${thumbUrl} ${THUMB_MAX_DIM}w, ${fullUrl} ${FULL_MAX_DIM}w`;
}

/** Trip cards: one column on a phone, two from sm inside max-w-6xl with
 * sm:p-8 and gap-4, so (100vw - 64px - 16px) / 2, capped at 536px. */
export const TRIP_CARD_SIZES = "(min-width: 1152px) 536px, calc(50vw - 40px)";

/** Bucket cards: two columns from sm, three from lg, inside max-w-5xl (the
 * bucket page) or max-w-6xl (the share grid). The larger container's width is
 * used, since over-asking by a few pixels costs less than a blurry card. */
export const BUCKET_CARD_SIZES =
  "(min-width: 1152px) 352px, (min-width: 1024px) calc(33vw - 32px), calc(50vw - 40px)";

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
    <picture>
      {srcSet ? <source media={WIDE_MEDIA} srcSet={srcSet} sizes={sizes} /> : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={thumbUrl}
        alt={alt}
        loading={loading}
        style={style}
        className={className}
      />
    </picture>
  );
}

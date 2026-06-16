import { getPhotoUrl } from "@/lib/photos";
import { cn } from "@/lib/utils";
import type { Photo } from "@/lib/types";

// A header banner for trips and destinations. Renders the cover photo behind a
// dark gradient so overlaid text stays readable, or a subtle gradient
// placeholder when there is no cover. Pure and server-renderable.
export function PhotoBanner({
  photo,
  className,
  children,
}: {
  photo: Photo | null;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl bg-gradient-to-br from-white/[0.08] to-transparent ring-1 ring-foreground/10",
        className,
      )}
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={getPhotoUrl(photo)}
          alt=""
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

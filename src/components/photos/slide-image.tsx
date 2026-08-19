"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

// The photograph layer for the full-screen surfaces: the trip story and the
// Year in Travel recap.
//
// It exists because those two surfaces have the same two problems and both
// have the same answer.
//
// QUALITY. A slide is the whole viewport. The 400px gallery thumbnail is built
// for a grid tile and looks exactly as bad blown up to 1200 as that implies,
// which is what "the story looks blurry" was. So the FULL image is what gets
// requested, and the thumbnail is demoted to what it is good at: a placeholder
// that paints instantly (it is usually already in cache from a gallery) and is
// crossfaded out the moment the real one arrives. Nothing here fetches ahead;
// the hosts still mount only the slides next to the current one.
//
// FIT. A slide has whatever shape the viewport has and a photograph has
// whatever shape the camera had, and cover-cropping every combination of those
// is how a portrait phone photo loses somebody's head on a desktop slide. The
// rule is one number:
//
//   mismatch = max(slideAspect / photoAspect, photoAspect / slideAspect)
//
//   mismatch <= CONTAIN_THRESHOLD  ->  cover. The crop is modest and a filled
//                                      frame reads better than bars.
//   mismatch >  CONTAIN_THRESHOLD  ->  contain, over a blurred blow-up of the
//                                      same photo. Nothing is cropped away and
//                                      the frame is still full.
//
// At 1.8 the cases fall where they should. A portrait phone photo on a phone
// (about 1.6) fills the screen. The same photo on a desktop slide (about 2.4)
// is shown whole. A 3:2 landscape on a phone (about 3.2) is shown whole rather
// than reduced to a slice of itself. The blurred backdrop is the placeholder
// layer doing a second job, so contain mode costs no extra request.

/** Past this much disagreement between the two aspect ratios, stop cropping. */
export const CONTAIN_THRESHOLD = 1.8;

/**
 * The rule above, as a function, so nothing has to restate it.
 *
 * SlideImage calls it to decide what to render. The curation picker calls it to
 * mark the candidates that will be letterboxed, without rendering anything. A
 * second copy of `Math.max(a / b, b / a) > 1.8` living in the picker is exactly
 * the drift this exists to prevent: the marker would go on saying "bars" for a
 * week after somebody moved the threshold.
 *
 * Null for either aspect means "not measured yet", and the answer is false: the
 * common case is cover, and settling into contain afterwards is a far quieter
 * change than the reverse.
 */
export function willContain(
  frameAspect: number | null,
  imageAspect: number | null,
): boolean {
  if (frameAspect === null || imageAspect === null) return false;
  if (!(frameAspect > 0) || !(imageAspect > 0)) return false;
  return (
    Math.max(frameAspect / imageAspect, imageAspect / frameAspect) >
    CONTAIN_THRESHOLD
  );
}

/**
 * The shape a story or recap slide has on THIS device: the viewport, because
 * both surfaces are `fixed inset-0`.
 *
 * The picker previews against it rather than against a fixed 16:9 or a phone
 * shape, because the story is a live surface each viewer opens at their own
 * size, not an exported image with one baked ratio. Previewing a shape the
 * person curating will never see would be the "approximation somebody trusts"
 * problem wearing a different hat.
 */
export function useSlideFrameAspect(): number | null {
  const [aspect, setAspect] = useState<number | null>(null);
  useEffect(() => {
    const measure = () => {
      const { innerWidth, innerHeight } = window;
      if (innerWidth > 0 && innerHeight > 0) {
        setAspect((current) => {
          const next = innerWidth / innerHeight;
          // Rounded before comparing, so a mobile browser's address bar
          // sliding away does not re-render every tile in the picker.
          return current !== null && Math.abs(current - next) < 0.01
            ? current
            : next;
        });
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return aspect;
}

export function SlideImage({
  src,
  thumbSrc,
  priority = false,
  allowContain = true,
  className,
  alt = "",
}: {
  /** The full image. Always what is finally displayed. */
  src: string;
  /** The gallery thumbnail, if there is one. Placeholder and blurred backdrop. */
  thumbSrc?: string | null;
  /** Eager-load the full image. The host sets this on a slide's lead photo. */
  priority?: boolean;
  /**
   * Off for a tile in a mosaic. A day with four photos is a grid of crops by
   * design, and letterboxing each cell would turn it into four small pictures
   * floating in blur rather than one composition. The rule above is about the
   * photo somebody is actually looking at.
   */
  allowContain?: boolean;
  className?: string;
  alt?: string;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [frameAspect, setFrameAspect] = useState<number | null>(null);
  const [imageAspect, setImageAspect] = useState<number | null>(null);

  // A new photo in the same slot (the recap swaps years in place) starts over.
  // Render-phase state adjustment, the React-documented pattern for deriving
  // state from props: an effect here would paint one frame of the old photo's
  // fit applied to the new one.
  const [prevSrc, setPrevSrc] = useState(src);
  if (prevSrc !== src) {
    setPrevSrc(src);
    setLoaded(false);
    setImageAspect(null);
  }

  /** What onLoad does, pulled out so a already-complete image can run it too. */
  const applyLoaded = useCallback((image: HTMLImageElement) => {
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      setImageAspect(image.naturalWidth / image.naturalHeight);
    }
    setLoaded(true);
  }, []);

  // A CACHED IMAGE NEVER FIRES onLoad.
  //
  // The browser can finish an image out of cache before React has attached the
  // handler, and the event is then simply missed: `loaded` stays false, the
  // crossfade never runs, and a photograph that downloaded perfectly sits at
  // opacity 0 forever. It is easy to miss because the first view of any photo
  // is uncached and works, and it is the same trap `usePhotoRatio` in the
  // curation picker already guards against.
  //
  // Keyed on src rather than run once, because the render above resets `loaded`
  // when the photo in this slot changes (the recap swaps years in place) and
  // the replacement may be cached too.
  useEffect(() => {
    const image = imageRef.current;
    if (image && image.complete) applyLoaded(image);
  }, [src, applyLoaded]);

  useEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setFrameAspect(rect.width / rect.height);
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Until both are known, assume cover: it is the common case, and switching
  // to contain after the fact is a far quieter change than the reverse.
  const contain = allowContain && willContain(frameAspect, imageAspect);

  const placeholder = thumbSrc && thumbSrc !== src ? thumbSrc : null;

  return (
    <div ref={frameRef} className={cn("relative size-full overflow-hidden", className)}>
      {placeholder ? (
        // Scaled past the edges so the blur has no soft border to give itself
        // away, and dimmed so a bright photo's bands do not compete with the
        // photo sitting on them.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={placeholder}
          alt=""
          aria-hidden="true"
          decoding="async"
          className={cn(
            "absolute inset-0 size-full scale-110 object-cover blur-2xl",
            contain ? "opacity-55" : "opacity-100",
          )}
        />
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imageRef}
        src={src}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        onLoad={(event) => applyLoaded(event.currentTarget)}
        className={cn(
          "absolute inset-0 size-full transition-opacity duration-500",
          contain ? "object-contain" : "object-cover",
          loaded ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

"use client";

import { useState } from "react";
import { ImageOffIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface SafeImageProps {
  src: string;
  alt: string;
  // Class applied to the img tag (e.g. "size-full object-cover").
  className?: string;
  loading?: "lazy" | "eager";
  style?: React.CSSProperties;
  // Tried once if src fails to load (e.g. a thumbnail whose file is missing
  // falls back to the full image) before showing the error state.
  fallbackSrc?: string;
}

// Drop-in replacement for <img> that shows an animate-pulse skeleton while
// the image loads and an ImageOff icon if the src fails to fetch.
// The parent container must have position: relative (or overflow: hidden)
// so the skeleton div renders behind the image correctly.
export function SafeImage({
  src,
  alt,
  className,
  loading,
  style,
  fallbackSrc,
}: SafeImageProps) {
  const [errored, setErrored] = useState(false);
  const [useFallback, setUseFallback] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const activeSrc =
    useFallback && fallbackSrc && fallbackSrc !== src ? fallbackSrc : src;

  function handleError() {
    if (!useFallback && fallbackSrc && fallbackSrc !== src) {
      setUseFallback(true);
      setLoaded(false);
      return;
    }
    setErrored(true);
  }

  if (errored) {
    return (
      <div className="flex size-full items-center justify-center bg-white/5 text-foreground/25">
        <ImageOffIcon className="size-5" />
      </div>
    );
  }

  return (
    <>
      {!loaded && (
        <div className="absolute inset-0 animate-pulse bg-muted" />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={activeSrc}
        alt={alt}
        loading={loading}
        style={style}
        onError={handleError}
        onLoad={() => setLoaded(true)}
        className={cn(
          "transition-opacity duration-300",
          loaded ? "opacity-100" : "opacity-0",
          className,
        )}
      />
    </>
  );
}

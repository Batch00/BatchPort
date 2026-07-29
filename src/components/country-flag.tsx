"use client";

import { useState } from "react";

import { flagEmoji } from "@/lib/format";
import { cn } from "@/lib/utils";

// A country flag rendered as an SVG image rather than an emoji. Windows has no
// color flag emoji (regional indicator pairs fall back to bare letters like
// "DK"), so emoji flags only work on phones; the flagcdn.com SVGs render
// everywhere. If the image fails to load, the emoji is the fallback, which is
// at worst the two-letter code.

let regionNames: Intl.DisplayNames | null = null;
/** "DK" -> "Denmark". Falls back to the code when Intl cannot resolve it. */
export function countryName(code: string): string {
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export function CountryFlag({
  code,
  className,
}: {
  code?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return null;
  const name = countryName(code);

  // No `title` on either branch. In almost every call site the country name is
  // already visible next to the flag, so a tip would just repeat it, and making
  // every flag in a combobox or search list a focusable tip trigger would bury
  // keyboard users in tab stops. `alt` still names it for screen readers; the
  // one place a flag stands alone (the stats flag row) wraps it in an InfoTip.
  if (failed) {
    return (
      <span aria-label={name} role="img" className={className}>
        {flagEmoji(code) || code.toUpperCase()}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://flagcdn.com/${code.toLowerCase()}.svg`}
      alt={name}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn(
        // inline-block with a slight downshift so the flag sits naturally in
        // running text; flex parents simply ignore the vertical alignment.
        "inline-block h-3.5 w-auto shrink-0 rounded-[3px] align-[-2px] ring-1 ring-white/10",
        className,
      )}
    />
  );
}

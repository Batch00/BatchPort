"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Fullscreen state for a globe host. The layout mechanism is CSS: the host
// swaps its card container to fixed inset-0, which works everywhere including
// iOS Safari and the installed PWA (where the Fullscreen API is unavailable
// or limited). Where the native Fullscreen API exists it is layered on top as
// an enhancement, requested on the document root rather than the globe card:
// page-level overlays (the discovery panel portal) are siblings of the card,
// and fullscreening the card itself would hide them.
//
// `overlayOpen` reports whether a panel (drill-down, discovery) is currently
// open. Escape then belongs to the panel: the hook only exits fullscreen on
// Escape when no overlay is up, and likewise keeps the CSS mode alive when
// the browser drops native fullscreen while a panel is absorbing the key.
export function useGlobeFullscreen(overlayOpen: boolean) {
  const [fullscreen, setFullscreen] = useState(false);
  const overlayOpenRef = useRef(overlayOpen);
  useEffect(() => {
    overlayOpenRef.current = overlayOpen;
  });

  const enter = useCallback(() => {
    setFullscreen(true);
    const root = document.documentElement;
    if (root.requestFullscreen) {
      root.requestFullscreen().catch(() => {
        // iOS Safari and some embedded views reject; CSS mode still applies.
      });
    }
  }, []);

  const exit = useCallback(() => {
    setFullscreen(false);
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  const toggle = useCallback(() => {
    if (fullscreen) {
      exit();
    } else {
      enter();
    }
  }, [fullscreen, enter, exit]);

  // Escape exits fullscreen, but only when no panel is open: panels handle
  // their own Escape (walking up a level), and one keypress should do one
  // thing.
  useEffect(() => {
    if (!fullscreen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || overlayOpenRef.current) return;
      exit();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen, exit]);

  // When the browser leaves native fullscreen on its own (Escape, system UI),
  // fold the CSS mode too so one Escape press does not need a second. If a
  // panel was open, that Escape was meant for the panel: keep the CSS mode.
  useEffect(() => {
    if (!fullscreen) return;
    function onChange() {
      if (!document.fullscreenElement && !overlayOpenRef.current) {
        setFullscreen(false);
      }
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [fullscreen]);

  // Lock page scroll behind the fixed container.
  useEffect(() => {
    if (!fullscreen) return;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previous;
    };
  }, [fullscreen]);

  return { fullscreen, toggle, exit };
}

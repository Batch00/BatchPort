"use client";

import { useEffect } from "react";

// Registers the pass-through service worker once the window has loaded, which
// makes the PWA install prompt available. Registration failures are
// non-fatal: the app shell works the same with or without the worker.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Ignore: the app does not depend on the worker yet.
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}

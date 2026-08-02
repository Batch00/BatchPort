"use client";

import { useEffect } from "react";

// Registers the service worker and keeps it honest across deploys.
//
// Three things happen here beyond the registration itself, and each exists to
// prevent a specific staleness bug:
//
//   1. updateViaCache: "none" stops the browser serving sw.js itself from its
//      HTTP cache. Without it a worker can outlive several deploys, because
//      the update check reads a cached copy of the file it is checking.
//   2. An explicit update() on load and on every return to the tab, so a long
//      lived installed PWA notices a new build without being force quit.
//   3. A REFRESH_OFFLINE_SHELL message once the worker is controlling the
//      page. The offline fallback is the only HTML in any cache, so it is the
//      only thing that can go stale; refreshing it on each online load pins it
//      to the build the user is actually running.
//
// Every step is best-effort. The app works identically with no worker at all.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          updateViaCache: "none",
        });
        if (cancelled) return;
        void registration.update().catch(() => {});
      } catch {
        // Ignore: registration is an enhancement, never a requirement.
      }

      try {
        await navigator.serviceWorker.ready;
        if (cancelled || !navigator.onLine) return;
        navigator.serviceWorker.controller?.postMessage({
          type: "REFRESH_OFFLINE_SHELL",
        });
      } catch {
        // Ignore.
      }
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void navigator.serviceWorker
        .getRegistration()
        .then((registration) => registration?.update())
        .catch(() => {});
    };

    const onLoad = () => {
      void register();
    };

    if (document.readyState === "complete") {
      void register();
    } else {
      window.addEventListener("load", onLoad);
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.removeEventListener("load", onLoad);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}

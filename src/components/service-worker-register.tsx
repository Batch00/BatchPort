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
//
// IT DOES NOT RUN IN DEVELOPMENT, and that is not tidiness. sw.js serves
// /_next/static/** CACHE-FIRST, which its own comment justifies with "those
// filenames contain a content hash". That is true of a production build and
// FALSE of the dev server: Turbopack reuses a chunk URL across rebuilds with
// different contents (measured: the same
// /_next/static/chunks/src_components_*.js served two different md5s either
// side of a one line source edit). So in dev the worker can answer with a
// chunk from a previous build.
//
// The symptom is not subtle and is nothing like a caching problem:
//
//   Module [project]/src/lib/actions/data:HASH [app-client] was instantiated
//   because it was required from module .../globe.tsx, but the module factory
//   is not available.
//
// A cached client chunk asks for a server-action module id that the current
// build renumbered. ADDING ANY SERVER ACTION ANYWHERE renumbers them, so this
// fires on unrelated work and points at an unrelated file.
//
// It survives every obvious remedy, which is what makes it expensive:
// deleting .next does not touch browser Cache Storage; a hard reload does not
// either; and unregistering the worker does not delete its caches, because
// they are origin scoped and outlive the registration. sw.js also keeps
// batchport-static-* in its activate keep-set, so nothing evicts it while
// SHELL_VERSION is unchanged.
//
// Hence the dev branch below actively CLEANS UP rather than merely declining
// to register: an already-installed worker from before this guard existed
// would otherwise keep serving stale chunks forever.
function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}

/** Undo any worker and cache a previous dev session left behind. */
async function unregisterInDevelopment(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch {
    // Ignore: this is cleanup, never a requirement.
  }
  try {
    // Only this app's caches. Deleting everything would take out whatever else
    // is served from localhost.
    const names = await caches.keys();
    await Promise.all(
      names.filter((name) => name.startsWith("batchport-")).map((name) => caches.delete(name)),
    );
  } catch {
    // Ignore.
  }
}

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (isDevelopment()) {
      void unregisterInDevelopment();
      return;
    }

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

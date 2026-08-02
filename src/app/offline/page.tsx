import type { Metadata } from "next";

import { OfflineShell } from "@/components/offline/offline-shell";

// The offline reading surface.
//
// It sits outside the (app) route group on purpose. That group's layout calls
// getUser() and redirects an unauthenticated visitor, which a page that must
// be servable from a cache with no network cannot survive: the service worker
// precaches this document, and a redirect is not a document. It is also public
// in proxy.ts for the same reason.
//
// Nothing here reads the session or the database. The page is an empty frame
// that a client component fills from IndexedDB, so it renders identically
// whether it came from the network or from Cache Storage, and it can only ever
// show data this device already stored for the account that stored it.

export const metadata: Metadata = {
  title: "Offline",
  description: "Your saved trips, readable without a connection",
};

export default function OfflinePage() {
  return <OfflineShell />;
}

"use client";

import { PHOTO_CACHE } from "./constants";
import { clearOfflineStorage } from "./db";

// Signing out has to take the offline copy with it.
//
// The snapshot is one account's whole travel history sitting in IndexedDB on a
// device that may be shared, and the photo cache is that account's pictures.
// Leaving either behind would mean the next person to sign in on this browser
// could open /offline and read the previous user's trips, which is a data leak
// dressed up as a cache.
//
// It runs from the sign-out form's onSubmit rather than the server action,
// because only the browser can reach browser storage. It is fire and forget
// and deliberately does not block the submit: the sign-out itself must not
// hang on IndexedDB, and anything left behind is overwritten by the next
// account's snapshot on its first load.
//
// The queue is cleared too. That is the one place this feature deletes an
// unsent write without the user tapping discard, and it is defensible because
// signing out is an explicit statement that this session is over: replaying a
// previous user's checkoff into the next user's account would be far worse
// than losing it.
export function forgetOfflineData(): void {
  void clearOfflineStorage();
  if (typeof caches === "undefined") return;
  void caches.delete(PHOTO_CACHE).catch(() => false);
}

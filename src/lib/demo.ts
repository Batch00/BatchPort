import { DEMO_USER_ID } from "./constants";

// Message shown wherever a demo user hits a write. Kept consistent with the
// invite-only copy on the landing page.
export const DEMO_READONLY_MESSAGE =
  "Demo accounts are read-only. Request access at batch-apps.com";

// True when the given user id is the shared demo account. Returns false while
// DEMO_USER_ID is still the empty placeholder, so the demo behaves like a
// normal account until the real user id is wired in.
export function isDemoUser(userId: string | null | undefined): boolean {
  return Boolean(DEMO_USER_ID) && userId === DEMO_USER_ID;
}

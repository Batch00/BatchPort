import { toast } from "sonner";

import { DEMO_USER_ID } from "./constants";

// Message shown wherever a demo user hits a write. Kept consistent with the
// invite-only copy on the landing page.
const DEMO_READONLY_MESSAGE =
  "Demo accounts are read-only. Request access at batch-apps.com";

// True when the given user id is the shared demo account. Returns false while
// DEMO_USER_ID is still the empty placeholder, so the demo behaves like a
// normal account until the real user id is wired in.
export function isDemoUser(userId: string | null | undefined): boolean {
  return Boolean(DEMO_USER_ID) && userId === DEMO_USER_ID;
}

// Server helper: the standard 403 to return from a route handler when a demo
// user attempts a mutation. The body carries a `demo` flag so the client can
// recognise it via handleDemoResponse below.
export function demoGuardResponse(): Response {
  return new Response(
    JSON.stringify({ error: DEMO_READONLY_MESSAGE, demo: true }),
    {
      status: 403,
      headers: { "Content-Type": "application/json" },
    },
  );
}

// Client helper: inspect a fetch Response. If it is the demo 403, show a toast
// and return true so the caller can stop. Returns false for any other response.
export async function handleDemoResponse(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  let message = DEMO_READONLY_MESSAGE;
  try {
    const body = (await response.clone().json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    // Non-JSON 403: fall back to the default read-only message.
  }
  toast.error(message);
  return true;
}

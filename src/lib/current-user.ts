import { cache } from "react";

import { createClient } from "@/utils/supabase/server";

// Resolve the authenticated user and a request-scoped Supabase client. Throws
// when there is no session: callers run inside the protected (app) route group,
// where the layout has already guaranteed a user, so this is a safety net.
//
// Wrapped in React cache() so a page that calls several data-layer functions
// (each of which calls requireUser) performs the auth.getUser() network
// round-trip only once per request instead of once per query.
export const requireUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not authenticated");
  }
  return { supabase, user };
});

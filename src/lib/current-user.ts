import { createClient } from "@/utils/supabase/server";

// Resolve the authenticated user and a request-scoped Supabase client. Throws
// when there is no session: callers run inside the protected (app) route group,
// where the layout has already guaranteed a user, so this is a safety net.
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not authenticated");
  }
  return { supabase, user };
}

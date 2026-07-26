import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Sessionless anon Supabase client, scoped to the "batchport" schema.
//
// The client in server.ts reads request cookies to resolve a session, which
// makes every call that uses it a Request-time operation. This one deliberately
// carries no cookies and no session, so its reads can live inside a cache scope
// (unstable_cache) where cookies() is not allowed.
//
// It sends the anon key, so RLS applies exactly as it does for a signed-out
// visitor: the is_shared() helper is the only thing that lets any row through,
// which is precisely the access the public demo and share surfaces rely on.
// Never reach for the admin client to fill this role; it would bypass RLS.
//
// Returns null when the Supabase environment is not configured, so callers can
// degrade instead of throwing (the app shell is expected to render without it).
export function createPublicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  return createSupabaseClient(url, anonKey, {
    db: { schema: "batchport" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

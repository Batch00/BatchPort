import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role Supabase client for privileged server-side operations such as
// inviting users. Built with @supabase/supabase-js (NOT @supabase/ssr) because
// it never touches request cookies and must not persist a session.
//
// SERVER ONLY. Never import this from a client component: it carries the
// service-role key, which bypasses row-level security.
//
// Unlike the anon clients in client.ts and server.ts, this one is NOT scoped to
// the "batchport" schema. The service role defaults to the public schema, so
// any query against app tables must call .schema("batchport") explicitly.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client.
// All data access is scoped to the "batchport" Postgres schema so this app
// stays isolated from the other apps sharing the Supabase project.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: "batchport" },
    },
  );
}

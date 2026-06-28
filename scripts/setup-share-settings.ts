// One-time (repeatable) setup of user_settings rows for the demo account and
// public share profiles. Uses the admin (service-role) client and upserts on
// the user_id primary key, so it is safe to run more than once.
//
// This is reference/admin data, not application code. It does NOT need the dev
// server. Requires .env.local with NEXT_PUBLIC_SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY.
//
// Run with: npm run setup-shares
//
// Equivalent SQL (run manually instead if you prefer; do NOT run automatically):
//
//   insert into batchport.user_settings
//     (user_id, is_demo, public_share_enabled, public_slug)
//   values
//     ('703fbe07-db8a-41bd-bdee-928c2fa88107', true,  true, 'demo'),
//     ('1ca08f60-c0eb-4fae-8297-1a2c73fb9cfc', false, true, 'carson')
//   on conflict (user_id) do update set
//     is_demo = excluded.is_demo,
//     public_share_enabled = excluded.public_share_enabled,
//     public_slug = excluded.public_slug;

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

const DEMO_USER_ID = "703fbe07-db8a-41bd-bdee-928c2fa88107";
const CARSON_USER_ID = "1ca08f60-c0eb-4fae-8297-1a2c73fb9cfc";

interface SettingsRow {
  user_id: string;
  is_demo: boolean;
  public_share_enabled: boolean;
  public_slug: string;
}

const ROWS: SettingsRow[] = [
  {
    user_id: DEMO_USER_ID,
    is_demo: true,
    public_share_enabled: true,
    public_slug: "demo",
  },
  {
    user_id: CARSON_USER_ID,
    is_demo: false,
    public_share_enabled: true,
    public_slug: "carson",
  },
];

// Parse .env.local by hand so the script stays free of extra dependencies.
function loadEnvLocal(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  } catch {
    // No .env.local: fall back to whatever is already in process.env.
  }
  return env;
}

async function main() {
  const env = loadEnvLocal();
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
  }

  // Admin client. Not scoped to a schema by default, so name it explicitly.
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Upserting ${ROWS.length} user_settings rows...`);

  const { data, error } = await supabase
    .schema("batchport")
    .from("user_settings")
    .upsert(ROWS, { onConflict: "user_id" })
    .select("user_id, public_slug, is_demo, public_share_enabled");
  if (error) throw error;

  for (const row of data ?? []) {
    console.log(
      `  ${row.public_slug}: user ${row.user_id} (demo=${row.is_demo}, shared=${row.public_share_enabled})`,
    );
  }
  console.log("Share settings ready.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

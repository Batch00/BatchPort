// Can the ANON key actually read every places view the public surfaces read?
//
// Run with: npm run check-places-anon
//
// NEEDS A DATABASE. READS ONLY: it writes nothing, so it is safe against the
// live project at any time. Requires NEXT_PUBLIC_SUPABASE_URL,
// NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local.
//
// WHY THIS EXISTS. /share/[slug] and /demo read the places views with the
// anon key (or a signed-in session that is not the owner). Every view is
// security_invoker, so three separate things must all be true for a row to
// come back: a GRANT on the view, a GRANT on every table it reads, and an RLS
// policy on each of those tables that admits the shared account. A missing
// grant raises 42501; a missing POLICY returns zero rows and no error, which
// renders as an empty section and looks exactly like "this person has no
// places". Service role bypasses RLS, so no service-role check can see it.
// The anon key is the only instrument that can, so this compares, view by
// view, what anon sees against what the service role sees for the same owner.
//
// A positive control runs first (anon can read the account's trips through
// is_shared), because "anon saw zero rows" also passes when the anon key is
// broken.
//
// Accounts checked: every account that is publicly shared or is the demo
// account, i.e. exactly the set /share/[slug] can resolve. An account with no
// places is still checked (zero must equal zero), and is reported as such.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

// Every view and table the public places surfaces read, with a column known
// to exist so a bad select fails loudly rather than as an empty result.
const VIEWS: { view: string; column: string }[] = [
  // The globe: pins, first visits, and country_code for the places-only hatch.
  { view: "v_place_presence", column: "place_id" },
  { view: "v_place_visits_to_date", column: "place_id" },
  { view: "v_places", column: "id" },
  // The two overview tiles.
  { view: "v_places_summary", column: "places_visited" },
  // The /demo recent strip's caption (occasion_label, for admitted visit ids).
  { view: "place_visits", column: "id" },
];

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // Fall through to process.env.
  }
  return { ...env, ...(process.env as Record<string, string>) };
}

function connect(url: string, key: string) {
  return createClient(url, key, {
    db: { schema: "batchport" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
type Client = ReturnType<typeof connect>;

async function count(
  client: Client,
  view: string,
  column: string,
  userId: string,
): Promise<{ rows: number | null; error: string | null }> {
  const { count: rows, error } = await client
    .from(view)
    .select(column, { count: "exact", head: true })
    .eq("user_id", userId);
  return { rows, error: error ? `${error.code ?? ""} ${error.message}`.trim() : null };
}

async function main() {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    throw new Error(
      "Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  const anon = connect(url, anonKey);
  const service = connect(url, serviceKey);

  const { data: accounts, error } = await service
    .from("user_settings")
    .select("user_id, public_slug, public_share_enabled, is_demo")
    .or("public_share_enabled.eq.true,is_demo.eq.true");
  if (error) throw new Error(`Could not list shared accounts: ${error.message}`);
  if (!accounts || accounts.length === 0) {
    throw new Error("No shared or demo account to check against.");
  }

  let failures = 0;
  for (const account of accounts as {
    user_id: string;
    public_slug: string | null;
    is_demo: boolean;
  }[]) {
    const name = account.is_demo ? "demo" : (account.public_slug ?? account.user_id);
    console.log(`\n${name}`);

    // Positive control: if anon cannot read this account's trips, the key or
    // the share flag is broken and every zero below would be meaningless.
    const control = await count(anon, "trips", "id", account.user_id);
    if (control.error || !control.rows) {
      console.log(
        `  FAIL control: anon read ${control.rows ?? 0} trips (${control.error ?? "no rows"})`,
      );
      failures += 1;
      continue;
    }
    console.log(`  ok   control: anon reads ${control.rows} trips`);

    for (const { view, column } of VIEWS) {
      const [a, s] = await Promise.all([
        count(anon, view, column, account.user_id),
        count(service, view, column, account.user_id),
      ]);
      if (s.error) {
        console.log(`  FAIL ${view}: service role error ${s.error}`);
        failures += 1;
      } else if (a.error) {
        console.log(`  FAIL ${view}: anon error ${a.error} (missing GRANT?)`);
        failures += 1;
      } else if (a.rows !== s.rows) {
        console.log(
          `  FAIL ${view}: anon ${a.rows} rows, service ${s.rows} (missing policy?)`,
        );
        failures += 1;
      } else {
        console.log(`  ok   ${view}: ${a.rows} rows`);
      }
    }
  }

  // The strip's occasion labels: a reference table with no owner, read by
  // the anon client on /demo. Zero here would blank every caption.
  const occasions = await anon
    .from("occasions")
    .select("id", { count: "exact", head: true });
  if (occasions.error || !occasions.count) {
    console.log(
      `\nFAIL occasions: anon read ${occasions.count ?? 0} rows (${occasions.error?.message ?? "no rows"})`,
    );
    failures += 1;
  } else {
    console.log(`\nok   occasions (reference): anon reads ${occasions.count} rows`);
  }

  if (failures > 0) {
    console.log(`\ncheck-places-anon: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\ncheck-places-anon: anon sees exactly what the service role sees");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

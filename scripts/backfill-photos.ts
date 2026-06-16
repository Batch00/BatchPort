// One-time backfill of Wikimedia cover photos for destinations that have none.
//
// This is a maintenance script, not application code. It talks to Supabase with
// the service-role key (owner data, bypasses RLS) and to the running dev server
// for Wikimedia photo lookups.
//
// Prerequisites:
//   - The dev server is running at http://localhost:3000 (npm run dev).
//   - .env.local holds NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
//   - SEED_USER_ID is set (env var or .env.local), otherwise the script prompts.
//
// Run with: npm run backfill-photos

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import { createClient } from "@supabase/supabase-js";

const BASE_URL = "http://localhost:3000";

// --- Types -----------------------------------------------------------------

interface WikimediaResult {
  url: string | null;
  attribution: string | null;
  license: string | null;
}

interface DestinationRow {
  id: string;
  name: string;
}

// --- Environment -----------------------------------------------------------

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

async function resolveUserId(env: Record<string, string>): Promise<string> {
  const fromEnv = process.env.SEED_USER_ID ?? env.SEED_USER_ID;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Enter SEED_USER_ID (your auth user UUID): ");
  rl.close();
  return answer.trim();
}

// --- Helpers ---------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Mirror of the app's formatWikimediaAttribution so stored credit reads the same.
function formatAttribution(
  attribution: string | null,
  license: string | null,
): string {
  const credit = attribution ?? "Unknown author";
  const tail = license ? `${credit} (${license})` : credit;
  return `${tail} via Wikimedia Commons`;
}

// Query by destination name only. Wikidata entity search does not match
// comma-separated "city,country" strings.
async function wikimedia(name: string): Promise<WikimediaResult | null> {
  const q = encodeURIComponent(name);
  try {
    const res = await fetch(`${BASE_URL}/api/photos/wikimedia?q=${q}`);
    if (!res.ok) return null;
    return (await res.json()) as WikimediaResult;
  } catch {
    return null;
  }
}

// --- Main ------------------------------------------------------------------

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

  const userId = await resolveUserId(env);
  if (!userId) {
    throw new Error("A SEED_USER_ID is required.");
  }

  // Service-role client scoped to the batchport schema. Bypasses RLS.
  const supabase = createClient(supabaseUrl, serviceKey, {
    db: { schema: "batchport" },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Confirm the dev server is reachable before doing any work.
  try {
    const ping = await fetch(`${BASE_URL}/api/photos/wikimedia?q=test`);
    if (!ping.ok) throw new Error(`status ${ping.status}`);
  } catch (error) {
    throw new Error(
      `Dev server is not reachable at ${BASE_URL}. Start it with "npm run dev" first. (${String(error)})`,
    );
  }

  // Destinations for this user that still have no cover photo.
  const { data: destinations, error: destError } = await supabase
    .from("destinations")
    .select("id, name")
    .eq("user_id", userId)
    .is("cover_photo_id", null)
    .order("created_at", { ascending: true });
  if (destError) throw destError;

  const rows = (destinations ?? []) as DestinationRow[];
  console.log(`Found ${rows.length} destination(s) without a cover photo.`);

  let updated = 0;
  let missing = 0;

  for (const dest of rows) {
    const photo = await wikimedia(dest.name);
    if (!photo?.url) {
      console.warn(`  No Wikimedia photo for "${dest.name}".`);
      missing++;
      await sleep(400);
      continue;
    }

    const { data: photoRow, error: photoError } = await supabase
      .from("photos")
      .insert({
        user_id: userId,
        owner_type: "destination",
        owner_id: dest.id,
        source: "wikimedia",
        external_url: photo.url,
        attribution: formatAttribution(photo.attribution, photo.license),
        order_index: 0,
      })
      .select("id")
      .single();
    if (photoError || !photoRow) {
      console.error(`  Failed to insert photo for "${dest.name}":`, photoError);
      await sleep(400);
      continue;
    }

    const { error: coverError } = await supabase
      .from("destinations")
      .update({ cover_photo_id: photoRow.id })
      .eq("id", dest.id);
    if (coverError) {
      console.error(`  Failed to set cover for "${dest.name}":`, coverError);
      await sleep(400);
      continue;
    }

    console.log(`  ${dest.name} -> cover set.`);
    updated++;

    // Be a courteous client to the Wikimedia provider.
    await sleep(400);
  }

  console.log(
    `\nBackfill complete. ${updated} cover(s) set, ${missing} without a photo, ${rows.length} checked.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

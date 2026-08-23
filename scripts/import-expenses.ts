// Import the reviewed expense fixture into Supabase.
//
// This is the second half of the fixture-over-parser call. The classification
// decisions were made in scripts/build-expense-fixture.ts and reviewed as
// scripts/expense-fixture.ts; this script does no judgment at all. It resolves
// two trip names to ids, resolves category slugs to ids, and upserts.
//
// IDEMPOTENT BY PRIMARY KEY. Every fixture row carries a deterministic uuid v5
// derived from the source line, so a second run updates the same 226 rows
// rather than creating 226 more. That matters more here than anywhere else in
// the app: two identical 7.00 Tesco runs on consecutive days are two real
// transactions, so there is no natural key to deduplicate on and no duplicate
// check that would not also reject real data.
//
// Prerequisites:
//   - scripts/sql/2026-08-19-expenses.sql has been applied.
//   - .env.local holds NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
//   - IMPORT_USER_ID, or exactly one non-demo user_settings row to infer it.
//   - The two trips already exist under that user, by name.
//
// Run with:
//   npm run import-expenses -- --dry-run   resolve and report, write nothing
//   npm run import-expenses                upsert
//   npm run import-expenses -- --undo      delete exactly these 226 rows

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { EXPENSE_FIXTURE, type FixtureExpense } from "./expense-fixture";

// --- Client -----------------------------------------------------------------

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

function makeClient(url: string, key: string) {
  return createClient(url, key, {
    db: { schema: "batchport" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
type Client = ReturnType<typeof makeClient>;

// --- Resolution -------------------------------------------------------------

async function resolveUser(
  admin: Client,
  env: Record<string, string>,
): Promise<string> {
  const explicit = env.IMPORT_USER_ID ?? process.env.IMPORT_USER_ID;
  if (explicit) return explicit;

  const { data, error } = await admin
    .from("user_settings")
    .select("user_id, is_demo");
  if (error) throw new Error(`Could not read user_settings: ${error.message}`);
  const others = ((data ?? []) as { user_id: string; is_demo: boolean }[]).filter(
    (row) => !row.is_demo,
  );
  if (others.length !== 1) {
    throw new Error(
      `Cannot infer the owner: ${others.length} non-demo users. ` +
        "Set IMPORT_USER_ID in .env.local.",
    );
  }
  return others[0].user_id;
}

/** Trip name to id, for exactly the names the fixture uses. Fails loudly on a
 * missing or ambiguous name: importing 160 transactions onto the wrong trip is
 * not something to discover later. */
async function resolveTrips(
  admin: Client,
  userId: string,
  names: string[],
): Promise<Map<string, string>> {
  const { data, error } = await admin
    .from("trips")
    .select("id, name")
    .eq("user_id", userId)
    .in("name", names);
  if (error) throw new Error(`Could not read trips: ${error.message}`);

  const byName = new Map<string, string[]>();
  for (const row of (data ?? []) as { id: string; name: string }[]) {
    byName.set(row.name, [...(byName.get(row.name) ?? []), row.id]);
  }

  const resolved = new Map<string, string>();
  const problems: string[] = [];
  for (const name of names) {
    const ids = byName.get(name) ?? [];
    if (ids.length === 0) problems.push(`no trip named "${name}"`);
    else if (ids.length > 1) problems.push(`${ids.length} trips named "${name}"`);
    else resolved.set(name, ids[0]);
  }
  if (problems.length > 0) {
    throw new Error(`Trip resolution failed:\n  ${problems.join("\n  ")}`);
  }
  return resolved;
}

async function resolveCategories(admin: Client): Promise<Map<string, string>> {
  const { data, error } = await admin
    .from("expense_categories")
    .select("id, slug");
  if (error) {
    throw new Error(
      `Could not read expense_categories: ${error.message}\n` +
        "Has scripts/sql/2026-08-19-expenses.sql been applied?",
    );
  }
  return new Map(
    ((data ?? []) as { id: string; slug: string }[]).map((row) => [
      row.slug,
      row.id,
    ]),
  );
}

// --- Rows -------------------------------------------------------------------

interface ExpenseRow {
  id: string;
  user_id: string;
  trip_id: string;
  category_id: string | null;
  vendor: string;
  amount_usd: number;
  spent_on: string | null;
  is_alcohol: boolean;
  note: string | null;
}

function buildRows(
  fixture: FixtureExpense[],
  userId: string,
  trips: Map<string, string>,
  categories: Map<string, string>,
): ExpenseRow[] {
  const problems: string[] = [];
  const rows = fixture.map((row) => {
    const tripId = trips.get(row.tripName);
    if (!tripId) problems.push(`line ${row.sourceLine}: unknown trip`);
    let categoryId: string | null = null;
    if (row.categorySlug !== null) {
      categoryId = categories.get(row.categorySlug) ?? null;
      if (categoryId === null) {
        problems.push(
          `line ${row.sourceLine}: category "${row.categorySlug}" is not seeded`,
        );
      }
    }
    return {
      id: row.id,
      user_id: userId,
      trip_id: tripId as string,
      // destination_id is deliberately left null: the boundary rule derives it
      // on read (v_expense_rows), and a stored value would mean the traveller
      // overruled that rule. Nobody overruled anything by importing a sheet.
      category_id: categoryId,
      vendor: row.vendor,
      amount_usd: row.amountUsd,
      spent_on: row.spentOn,
      is_alcohol: row.isAlcohol,
      note: row.note,
    };
  });
  if (problems.length > 0) {
    throw new Error(`Row build failed:\n  ${problems.join("\n  ")}`);
  }
  return rows;
}

// --- Report -----------------------------------------------------------------

function money(value: number): string {
  return value.toFixed(2);
}

function sum(values: number[]): number {
  return Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;
}

function reportPlan(rows: ExpenseRow[], trips: Map<string, string>): void {
  console.log("\nResolved:");
  for (const [name, id] of trips) {
    const own = rows.filter((row) => row.trip_id === id);
    console.log(
      `  ${name.padEnd(16)} ${String(own.length).padStart(3)} rows  ` +
        `${money(sum(own.map((r) => r.amount_usd))).padStart(9)}  ${id}`,
    );
  }
  const alcohol = rows.filter((row) => row.is_alcohol);
  console.log(
    `  ${"of which alcohol".padEnd(16)} ${String(alcohol.length).padStart(3)} rows  ` +
      `${money(sum(alcohol.map((r) => r.amount_usd))).padStart(9)}`,
  );
  console.log(
    `  ${"undated".padEnd(16)} ${String(rows.filter((r) => r.spent_on === null).length).padStart(3)} rows`,
  );
  console.log(
    `  ${"negative".padEnd(16)} ${String(rows.filter((r) => r.amount_usd < 0).length).padStart(3)} rows`,
  );
  console.log(`  ${"total".padEnd(16)} ${String(rows.length).padStart(3)} rows  ` +
    `${money(sum(rows.map((r) => r.amount_usd))).padStart(9)}\n`);
}

// --- Write ------------------------------------------------------------------

const CHUNK = 100;

async function upsertAll(admin: Client, rows: ExpenseRow[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const { data, error } = await admin
      .from("expenses")
      .upsert(batch, { onConflict: "id" })
      .select("id");
    if (error) {
      throw new Error(
        `Upsert failed at row ${i}: ${error.message}\n` +
          `${written} row(s) were written before this. Re-running is safe: ` +
          "the ids are deterministic, so it will update rather than duplicate.",
      );
    }
    written += data?.length ?? 0;
  }
  return written;
}

async function undoAll(admin: Client, rows: ExpenseRow[]): Promise<number> {
  let removed = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const ids = rows.slice(i, i + CHUNK).map((row) => row.id);
    const { data, error } = await admin
      .from("expenses")
      .delete()
      .in("id", ids)
      .select("id");
    if (error) throw new Error(`Delete failed at row ${i}: ${error.message}`);
    removed += data?.length ?? 0;
  }
  return removed;
}

/** What is already there, so a re-run reports an update rather than implying a
 * fresh import. */
async function countExisting(admin: Client, rows: ExpenseRow[]): Promise<number> {
  let found = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const ids = rows.slice(i, i + CHUNK).map((row) => row.id);
    const { data } = await admin.from("expenses").select("id").in("id", ids);
    found += data?.length ?? 0;
  }
  return found;
}

// --- Main -------------------------------------------------------------------

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const undo = process.argv.includes("--undo");

  const env = { ...loadEnvLocal(), ...process.env } as Record<string, string>;
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      "\nMissing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.\n",
    );
    process.exit(1);
  }

  const admin = makeClient(url, serviceKey);
  const userId = await resolveUser(admin, env);
  const tripNames = [...new Set(EXPENSE_FIXTURE.map((row) => row.tripName))];
  const trips = await resolveTrips(admin, userId, tripNames);
  const categories = await resolveCategories(admin);
  const rows = buildRows(EXPENSE_FIXTURE, userId, trips, categories);

  console.log(`\nOwner: ${userId}`);
  reportPlan(rows, trips);

  if (undo) {
    const removed = await undoAll(admin, rows);
    console.log(`Deleted ${removed} of ${rows.length} imported row(s).\n`);
    return;
  }

  const existing = await countExisting(admin, rows);
  if (existing > 0) {
    console.log(
      `${existing} of these rows are already present. This run will UPDATE them, not duplicate.\n`,
    );
  }

  if (dryRun) {
    console.log("Dry run, nothing written.\n");
    return;
  }

  const written = await upsertAll(admin, rows);
  console.log(`Upserted ${written} row(s).`);

  // Read the totals back out of the database rather than trusting the payload,
  // because "the script says it wrote 4492" and "the database holds 4492" are
  // different claims and only the second one matters.
  for (const [name, tripId] of trips) {
    const { data } = await admin
      .from("expenses")
      .select("amount_usd, is_alcohol")
      .eq("trip_id", tripId);
    const stored = (data ?? []) as { amount_usd: number | string; is_alcohol: boolean }[];
    const total = sum(stored.map((row) => Number(row.amount_usd)));
    const alcohol = sum(
      stored.filter((row) => row.is_alcohol).map((row) => Number(row.amount_usd)),
    );
    console.log(
      `  ${name.padEnd(16)} ${String(stored.length).padStart(3)} rows in the database, ` +
        `${money(total)} total, ${money(alcohol)} alcohol`,
    );
  }
  console.log("");
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

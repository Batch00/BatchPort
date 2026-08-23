// Parity checks for expense attribution, and for the privacy gate.
//
// UNLIKE THE OTHER check-* SCRIPTS, THIS ONE NEEDS A DATABASE AND WRITES TO
// THE LIVE PROJECT. It is a sibling of check-stays rather than part of it,
// precisely so check-stays stays pure.
//
// WHAT IT PINS DOWN
//
// Two claims that live in two places each, and would otherwise drift silently:
//
//  1. THE RULE. "A day belongs to the stay that arrived most recently on or
//     before it" is implemented in TypeScript (stayForDate in src/lib/stays.ts)
//     and again in SQL (the lateral in batchport.v_expense_rows), because a
//     view cannot call a TypeScript function. This inserts a trip shaped to
//     hit every hard case, then asserts the view and stayForDate agree on
//     every one. A comment cross-referencing the two would not fail a build.
//
//  2. THE GATE. Expenses must reach /demo and never /share/[slug]. Both share
//     routes are live (/share/demo and /share/batch00), so this reads the same
//     view through the ANON key and asserts it can see the demo account's
//     expenses and none of the real account's. That is the claim that matters,
//     and it is asserted rather than reasoned about.
//
//     The negative half is worthless on its own: "anon sees zero rows" also
//     passes if the anon key is broken. So it runs a positive control first
//     (anon can read the demo user's trips through is_shared) and asserts the
//     service role really can see the fixture rows, before concluding anything
//     from an empty anon result.
//
// SAFETY, because this writes trips and destinations, which feed the
// dashboard, the globe, the stats views, and a public profile:
//
//  * Every fixture row carries the reserved name __parity_fixture__, and
//    everything hangs off the fixture trip by foreign key so one delete takes
//    all of it.
//  * The fixture trip's status is 'planned', so a row that survives a crash is
//    excluded from every stats view and reads as a plan rather than as a
//    visited country on the globe.
//  * Purge runs ON ENTRY as well as in a finally, so a previous crashed run is
//    swept by the next run rather than waiting to be noticed.
//  * THE DEMO ACCOUNT IS NEVER WRITTEN TO. Everything this harness creates
//    belongs to the fixture trip on the non-demo account. An earlier version
//    inserted one throwaway expense onto a real demo trip, because the demo
//    had no spending to assert against; scripts/demo-dataset.ts now seeds
//    fictional ledgers, so the assertion reads those instead and the write is
//    gone. That matters: /demo and /share/demo are public, and a crashed run
//    used to be able to leave a row on them.
//  * npm run purge-parity-fixture removes everything by hand at any time.
//
// Prerequisites:
//   - scripts/sql/2026-08-19-expenses.sql has been applied.
//   - .env.local holds NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//     and NEXT_PUBLIC_SUPABASE_ANON_KEY.
//   - PARITY_USER_ID, or exactly one non-demo user_settings row to infer it.
//
// Run with:
//   npm run check-expense-attribution
//   npm run purge-parity-fixture

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { stayForDate, type Stay } from "../src/lib/stays";

const FIXTURE_MARKER = "__parity_fixture__";

// --- Tiny assertion harness, matching check-stays ---------------------------

let passed = 0;
const failures: string[] = [];

// The two halves are counted and reported separately, because "39 checks
// passed" cannot answer the question the gate half exists to answer. A gate
// that sees zero rows is only meaningful if its preconditions held, so the
// evidence lines below carry the actual numbers rather than a tick.
type Phase = "rule" | "gate";
let phase: Phase = "rule";
const tally: Record<Phase, number> = { rule: 0, gate: 0 };
const evidence: Record<Phase, string[]> = { rule: [], gate: [] };

/** A line of the report that is a measurement, not an assertion. */
function note(text: string): void {
  evidence[phase].push(text);
}

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    tally[phase] += 1;
    return;
  }
  failures.push(detail ? `[${phase}] ${name}\n    ${detail}` : `[${phase}] ${name}`);
}

function equal<T>(name: string, actual: T, expected: T): void {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  check(
    name,
    same,
    same
      ? undefined
      : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

// --- Environment ------------------------------------------------------------

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

function makeClient(url: string, key: string) {
  return createClient(url, key, {
    db: { schema: "batchport" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
type Client = ReturnType<typeof makeClient>;

// --- The fixture ------------------------------------------------------------
//
// One trip shaped to hit every case the boundary rule exists for. The stop
// names are deliberately boring; what matters is the dates and the order.

interface FixtureStop {
  key: string;
  name: string;
  arrival: string | null;
  departure: string | null;
  order: number;
}

const STOPS: FixtureStop[] = [
  // A plain first stay.
  { key: "A", name: "Alpha", arrival: "2025-09-27", departure: "2025-09-29", order: 0 },
  // Arrives the day Alpha departs: the everyday TRANSFER DAY. 09-29 is
  // contained by both, and belongs to this one.
  { key: "B", name: "Bravo", arrival: "2025-09-29", departure: "2025-10-01", order: 1 },
  // A GAP before this one: 10-02 and 10-03 belong to nobody.
  { key: "C", name: "Charlie", arrival: "2025-10-04", departure: "2025-10-07", order: 2 },
  // NESTED wholly inside Charlie. 10-05 is contained by both and belongs to
  // this one, because it arrived later.
  { key: "D", name: "Delta", arrival: "2025-10-05", departure: "2025-10-05", order: 3 },
  // A REVISIT arriving the day Charlie departs. Same shape as the transfer,
  // and the reason a stay is a ROW and not a place name.
  { key: "E", name: "Alpha", arrival: "2025-10-07", departure: "2025-10-08", order: 4 },
  // UNDATED: owns no days at all, and must never be the answer for any date.
  { key: "F", name: "Foxtrot", arrival: null, departure: null, order: 5 },
];

interface FixtureExpense {
  key: string;
  spentOn: string | null;
  /** Stop key to pin, exercising the override path. Null means derive. */
  pin: string | null;
  /** The stop key the rule should land on, or null for nobody. */
  expect: string | null;
  why: string;
}

const EXPENSES: FixtureExpense[] = [
  { key: "e1", spentOn: "2025-09-27", pin: null, expect: "A", why: "a stay's own first day" },
  { key: "e2", spentOn: "2025-09-28", pin: null, expect: "A", why: "a day only one stay contains" },
  { key: "e3", spentOn: "2025-09-29", pin: null, expect: "B", why: "TRANSFER DAY: the later arrival takes it" },
  { key: "e4", spentOn: "2025-10-02", pin: null, expect: null, why: "GAP DAY: belongs to nobody, never the nearest stop" },
  { key: "e5", spentOn: "2025-10-04", pin: null, expect: "C", why: "the day after a gap, on its own arrival" },
  { key: "e6", spentOn: "2025-10-05", pin: null, expect: "D", why: "NESTED: the inner stay arrived later" },
  { key: "e7", spentOn: "2025-10-06", pin: null, expect: "C", why: "inside the outer stay, past the nested one" },
  { key: "e8", spentOn: "2025-10-07", pin: null, expect: "E", why: "REVISIT: the second Alpha, not the first" },
  { key: "e9", spentOn: null, pin: null, expect: null, why: "UNDATED: no date, so no stay" },
  { key: "e10", spentOn: "2025-09-20", pin: null, expect: null, why: "before the trip began" },
  { key: "e11", spentOn: "2025-10-02", pin: "A", expect: "A", why: "OVERRIDE: a pin wins over a gap day" },
  { key: "e12", spentOn: "2025-10-05", pin: "C", expect: "C", why: "OVERRIDE: a pin wins over the nested stay" },
  { key: "e13", spentOn: null, pin: "F", expect: "F", why: "OVERRIDE: an undated spend pinned to an undated stop" },
];

// --- Purge ------------------------------------------------------------------

/** Remove every trace of a previous run. Expenses marked by vendor go first
 * (that catches the demo row, which hangs off a real trip and would survive a
 * trip delete), then the fixture trips, whose cascade takes their stops and
 * any expense still on them. Safe to call when nothing is there. */
async function purge(admin: Client): Promise<{ expenses: number; trips: number }> {
  const { data: expenseRows } = await admin
    .from("expenses")
    .delete()
    .eq("vendor", FIXTURE_MARKER)
    .select("id");

  const { data: tripRows } = await admin
    .from("trips")
    .delete()
    .eq("name", FIXTURE_MARKER)
    .select("id");

  return { expenses: expenseRows?.length ?? 0, trips: tripRows?.length ?? 0 };
}

// --- Users ------------------------------------------------------------------

interface Users {
  parity: string;
  demo: string;
}

async function resolveUsers(admin: Client, env: Record<string, string>): Promise<Users> {
  const { data: settings, error } = await admin
    .from("user_settings")
    .select("user_id, is_demo");
  if (error) {
    throw new Error(`Could not read user_settings: ${error.message}`);
  }
  const rows = (settings ?? []) as { user_id: string; is_demo: boolean }[];

  const demo = rows.find((row) => row.is_demo)?.user_id;
  if (!demo) {
    throw new Error("No user_settings row with is_demo = true.");
  }

  const explicit = env.PARITY_USER_ID ?? process.env.PARITY_USER_ID;
  if (explicit) return { parity: explicit, demo };

  const others = rows.filter((row) => !row.is_demo);
  if (others.length !== 1) {
    throw new Error(
      `Cannot infer the fixture owner: ${others.length} non-demo users. ` +
        "Set PARITY_USER_ID in .env.local.",
    );
  }
  return { parity: others[0].user_id, demo };
}

// --- Insert -----------------------------------------------------------------

interface Inserted {
  tripId: string;
  /** Fixture stop key to the destination id it was written as. */
  stopIds: Map<string, string>;
  /** Fixture expense key to the expense id it was written as. */
  expenseIds: Map<string, string>;
}

async function insertFixture(admin: Client, userId: string): Promise<Inserted> {
  const { data: trip, error: tripError } = await admin
    .from("trips")
    .insert({
      user_id: userId,
      name: FIXTURE_MARKER,
      // Planned, so a survivor of a crash is invisible to every stats view and
      // reads as a plan rather than a visited country.
      status: "planned",
      notes: "Temporary fixture written by npm run check-expense-attribution.",
    })
    .select("id")
    .single();
  if (tripError || !trip) {
    throw new Error(`Could not insert the fixture trip: ${tripError?.message}`);
  }
  const tripId = trip.id as string;

  const { data: stops, error: stopError } = await admin
    .from("destinations")
    .insert(
      STOPS.map((stop) => ({
        trip_id: tripId,
        user_id: userId,
        name: `${FIXTURE_MARKER} ${stop.name}`,
        arrival_date: stop.arrival,
        departure_date: stop.departure,
        order_index: stop.order,
      })),
    )
    .select("id, order_index");
  if (stopError || !stops) {
    throw new Error(`Could not insert the fixture stops: ${stopError?.message}`);
  }
  const byOrder = new Map(
    (stops as { id: string; order_index: number }[]).map((row) => [
      row.order_index,
      row.id,
    ]),
  );
  const stopIds = new Map<string, string>();
  for (const stop of STOPS) {
    const id = byOrder.get(stop.order);
    if (!id) throw new Error(`Stop ${stop.key} did not come back from the insert.`);
    stopIds.set(stop.key, id);
  }

  const { data: expenses, error: expenseError } = await admin
    .from("expenses")
    .insert(
      EXPENSES.map((expense, index) => ({
        user_id: userId,
        trip_id: tripId,
        destination_id: expense.pin ? stopIds.get(expense.pin) : null,
        vendor: FIXTURE_MARKER,
        // Distinct amounts so a mismatched row is identifiable in a failure.
        amount_usd: index + 1,
        spent_on: expense.spentOn,
        note: expense.key,
      })),
    )
    .select("id, note");
  if (expenseError || !expenses) {
    throw new Error(`Could not insert the fixture expenses: ${expenseError?.message}`);
  }
  const expenseIds = new Map<string, string>(
    (expenses as { id: string; note: string }[]).map((row) => [row.note, row.id]),
  );

  return { tripId, stopIds, expenseIds };
}

// --- Half one: the rule -----------------------------------------------------

async function checkRule(admin: Client, inserted: Inserted): Promise<void> {
  const { data, error } = await admin
    .from("v_expense_rows")
    .select("id, note, effective_destination_id, spent_on, pinned_destination_id")
    .eq("trip_id", inserted.tripId);

  if (error) {
    failures.push(
      `v_expense_rows is not readable: ${error.message}\n    ` +
        "Has scripts/sql/2026-08-19-expenses.sql been applied?",
    );
    return;
  }

  const rows = (data ?? []) as {
    id: string;
    note: string;
    effective_destination_id: string | null;
  }[];
  equal("the view returns every fixture expense", rows.length, EXPENSES.length);

  // The same stops, in the shape stays.ts reads.
  const stays: Stay[] = STOPS.map((stop) => ({
    id: inserted.stopIds.get(stop.key) as string,
    arrival: stop.arrival,
    departure: stop.departure,
    position: stop.order,
  }));

  const byNote = new Map(rows.map((row) => [row.note, row]));

  for (const expense of EXPENSES) {
    const row = byNote.get(expense.key);
    if (!row) {
      failures.push(`${expense.key} (${expense.why}) is missing from the view`);
      continue;
    }

    const expectedId = expense.expect
      ? (inserted.stopIds.get(expense.expect) as string)
      : null;

    // What SQL decided.
    equal(
      `SQL: ${expense.key}, ${expense.why}`,
      row.effective_destination_id,
      expectedId,
    );

    // What TypeScript decides, for the derived rows. A pinned row is an
    // override the rule never sees, so stayForDate is not asked about it.
    if (expense.pin === null) {
      const ts = expense.spentOn ? stayForDate(stays, expense.spentOn) : null;
      equal(
        `TS:  ${expense.key}, ${expense.why}`,
        ts?.id ?? null,
        expectedId,
      );
      // And the two agree with each other, which is the whole point.
      equal(
        `PARITY: ${expense.key}, stayForDate and v_expense_rows agree`,
        ts?.id ?? null,
        row.effective_destination_id,
      );
    }
  }
}

// --- Half two: the gate -----------------------------------------------------

async function checkGate(
  admin: Client,
  anon: Client,
  users: Users,
  inserted: Inserted,
): Promise<void> {
  // A zero-row anon result proves nothing unless the rows exist and the anon
  // client works. Both are established first.
  const { data: adminSees } = await admin
    .from("expenses")
    .select("id")
    .eq("trip_id", inserted.tripId);
  check(
    "PRECONDITION: service role can see the fixture expenses (so an empty anon read means something)",
    (adminSees?.length ?? 0) === EXPENSES.length,
    `service role saw ${adminSees?.length ?? 0} of ${EXPENSES.length}`,
  );
  note(
    `precondition: service role sees ${adminSees?.length ?? 0}/${EXPENSES.length} fixture expenses`,
  );

  // The reference taxonomy must be readable by anon, and this is asserted
  // rather than assumed because it failed silently once. expense_groups and
  // expense_categories were granted SELECT with no RLS policy, and RLS with no
  // policy returns ZERO ROWS AND NO ERROR. Nothing threw, no service-role
  // script noticed, and the surface rendered an empty category picker plus
  // "Mostly Uncategorized 100%" over a ledger where every row has a category.
  // A count comparison against the seed is the only thing that catches it.
  const { data: anonGroups, error: groupError } = await anon
    .from("expense_groups")
    .select("slug");
  const { data: anonCategories, error: categoryError } = await anon
    .from("expense_categories")
    .select("id");
  check(
    "PRECONDITION: anon can read the expense taxonomy (RLS policy present, not just a grant)",
    !groupError &&
      !categoryError &&
      (anonGroups?.length ?? 0) > 0 &&
      (anonCategories?.length ?? 0) > 0,
    groupError?.message ??
      categoryError?.message ??
      `anon read ${anonGroups?.length ?? 0} groups and ${anonCategories?.length ?? 0} categories; ` +
        "zero with no error means RLS is on with no policy",
  );
  note(
    `precondition: anon reads ${anonGroups?.length ?? 0} expense group(s) and ` +
      `${anonCategories?.length ?? 0} categor(ies) of taxonomy`,
  );

  const { data: anonTrips, error: anonTripError } = await anon
    .from("trips")
    .select("id")
    .eq("user_id", users.demo)
    .limit(1);
  check(
    "PRECONDITION: anon can read the demo account's trips through is_shared",
    !anonTripError && (anonTrips?.length ?? 0) > 0,
    anonTripError
      ? anonTripError.message
      : "anon read no demo trips, so the anon key or is_shared() is not working",
  );
  note(
    `precondition: anon reads ${anonTrips?.length ?? 0} demo trip(s) through is_shared, so the anon key is live`,
  );

  // The claim: anon cannot see the real account's expenses, filtered...
  const { data: anonFiltered, error: filteredError } = await anon
    .from("v_expense_rows")
    .select("id")
    .eq("user_id", users.parity);
  check(
    "anon sees no expenses for the non-demo account (filtered read)",
    !filteredError && (anonFiltered?.length ?? 0) === 0,
    filteredError ? filteredError.message : `saw ${anonFiltered?.length} row(s)`,
  );
  note(
    `filtered: anon asking for the owner's expenses got ${anonFiltered?.length ?? 0} row(s)`,
  );

  // ...and unfiltered, which is the stronger form: it does not depend on the
  // caller passing a filter, which is exactly what an attacker would not do.
  const { data: anonAll, error: allError } = await anon
    .from("v_expense_rows")
    .select("id, user_id")
    .limit(1000);
  const leaked = ((anonAll ?? []) as { user_id: string }[]).filter(
    (row) => row.user_id !== users.demo,
  );
  check(
    "anon sees no non-demo expenses at all (unfiltered read)",
    !allError && leaked.length === 0,
    allError ? allError.message : `${leaked.length} non-demo row(s) visible to anon`,
  );
  note(
    `unfiltered: anon read ${(anonAll ?? []).length} expense row(s) in total, ` +
      `${leaked.length} of them non-demo`,
  );

  // And the other direction, which is what makes /demo able to render spending
  // at all. This reads the demo account's REAL seeded expenses (see EXPENSES
  // in scripts/demo-dataset.ts). It used to insert a throwaway probe row onto
  // a demo trip, because the demo had no expenses to assert against; seeding
  // them removed the need, and with it the only write this harness ever made
  // to a publicly visible account.
  const { data: anonDemo, error: demoError } = await anon
    .from("v_expense_rows")
    .select("id, group_slug")
    .eq("user_id", users.demo);
  const demoRows = (anonDemo ?? []) as { group_slug: string | null }[];
  if (!demoError && demoRows.length === 0) {
    note(
      "SKIPPED the demo-visible half: the demo account has no expenses. " +
        "Run npm run seed-demo. This run did NOT prove /demo can read spending.",
    );
    return;
  }
  check(
    "anon CAN see the demo account's expenses (so /demo can render them)",
    !demoError && demoRows.length > 0,
    demoError ? demoError.message : "anon read no demo expense rows",
  );
  // The taxonomy join has to survive the anon path too. A row whose group is
  // null through anon and non-null through service role is the RLS bug this
  // feature shipped with, wearing a different hat.
  check(
    "the demo rows carry a resolved group through anon (the taxonomy join survives RLS)",
    demoRows.some((row) => row.group_slug !== null),
    `all ${demoRows.length} demo rows came back with a null group_slug`,
  );
  note(
    `demo-visible: anon read ${demoRows.length} demo expense row(s), ` +
      `${demoRows.filter((r) => r.group_slug !== null).length} with a resolved group`,
  );
}

// --- Main -------------------------------------------------------------------

async function main(): Promise<void> {
  const env = { ...loadEnvLocal(), ...process.env } as Record<string, string>;
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !serviceKey) {
    console.error(
      "\nMissing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.\n",
    );
    process.exit(1);
  }
  if (!anonKey) {
    console.error(
      "\nMissing NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local. The gate half " +
        "cannot run without it, and it is the half that matters.\n",
    );
    process.exit(1);
  }

  const admin = makeClient(url, serviceKey);
  const anon = makeClient(url, anonKey);

  // --purge: sweep and stop.
  if (process.argv.includes("--purge")) {
    const removed = await purge(admin);
    console.log(
      `\nPurged ${removed.trips} fixture trip(s) and ${removed.expenses} marked expense(s).\n`,
    );
    return;
  }

  const users = await resolveUsers(admin, env);

  // ON ENTRY, not only in the finally: a previous crashed run is swept by the
  // next one rather than waiting to be noticed.
  const swept = await purge(admin);
  if (swept.trips > 0 || swept.expenses > 0) {
    console.log(
      `\nSwept a previous run: ${swept.trips} trip(s), ${swept.expenses} expense(s).`,
    );
  }

  let inserted: Inserted | null = null;
  try {
    inserted = await insertFixture(admin, users.parity);

    phase = "rule";
    await checkRule(admin, inserted);
    phase = "gate";
    await checkGate(admin, anon, users, inserted);
  } finally {
    const removed = await purge(admin);
    const expected = (inserted ? 1 : 0);
    if (removed.trips < expected) {
      console.error(
        `\n!! Cleanup removed ${removed.trips} trip(s), expected ${expected}. ` +
          `Run: npm run purge-parity-fixture\n`,
      );
    }
  }

  console.log("\n--- THE RULE: stayForDate and v_expense_rows -------------");
  console.log(`  ${tally.rule} checks passed`);
  for (const line of evidence.rule) console.log(`  ${line}`);

  console.log("\n--- THE GATE: what the anon key can reach ----------------");
  console.log(`  ${tally.gate} checks passed`);
  for (const line of evidence.gate) console.log(`  ${line}`);
  console.log("");

  if (failures.length > 0) {
    console.error(`Expense attribution: ${failures.length} check(s) failed.\n`);
    for (const failure of failures) console.error(`  x ${failure}`);
    console.error("");
    process.exit(1);
  }
  console.log(`Expense attribution: ${passed} checks passed.\n`);
}

main().catch(async (error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  console.error("If this left anything behind: npm run purge-parity-fixture\n");
  process.exit(1);
});

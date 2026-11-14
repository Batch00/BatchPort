// What does a shared profile expose through the REST API, to anybody?
//
// Run with: npm run check:share-api -- [slug] [--scope past|current|all] [--journal on|off]
//   slug       the public slug to probe (default batch00)
//   --scope    the trip scope the owner chose in Settings (default past)
//   --journal  whether the owner turned journal sharing on (default off;
//              a bare --journal means on)
//
// NEEDS A DATABASE. READS ONLY, AND ONLY AS A STRANGER: it uses
// NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY with no session,
// exactly what anybody holding the anon key (it ships in the app) can do. It
// never reads the service role key, so it sees only what RLS admits.
//
// WHY THIS EXISTS (PORT-4). Not rendering a field is a presentation choice; the
// policies are the boundary. After PORT-4 part B every shared-read policy asks
// the helpers in batchport_private whether a row is part of what the owner
// chose to share, and user_settings is readable by its owner alone. This
// script asserts the result from the outside:
//
//   * no user_settings row is readable at all
//   * every trip is inside the scope (past: completed; current: completed and
//     ongoing; all: anything)
//   * every destination, experience, photo and transport leg hangs off a trip
//     that was returned
//   * no place visit is dated after today
//   * no journal entry while journal sharing is off (and, when it is on, none
//     on a trip that was not returned)
//   * no list and no list item
//   * demo_user_id() resolves and the demo profile returns at least one trip,
//     which is also the control: a broken anon key would make every "nothing
//     leaked" check above pass trivially
//
// Before part B is applied the settings, scope and lists checks are expected
// to fail. That is the point of running it before and after.
//
// "Today" is the UTC date, because the place_visits policy compares against
// Postgres current_date, which is UTC on this project.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

type Scope = "past" | "current" | "all";

const SCOPE_STATUSES: Record<Scope, readonly string[]> = {
  past: ["completed"],
  current: ["completed", "ongoing"],
  all: ["completed", "ongoing", "planned"],
};

// PostgREST caps a response at its max-rows setting (1000 by default), so
// every read pages until a short page comes back.
const PAGE = 1000;

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

interface Args {
  slug: string;
  scope: Scope;
  journal: boolean;
}

function parseOnOff(value: string): boolean {
  const normalized = value.toLowerCase();
  if (["on", "true", "yes", "1"].includes(normalized)) return true;
  if (["off", "false", "no", "0"].includes(normalized)) return false;
  throw new Error(`--journal takes on or off, not "${value}".`);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { slug: "batch00", scope: "past", journal: false };
  let slugSet = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inline] = arg.split("=", 2) as [string, string | undefined];
    if (flag === "--scope") {
      const value = inline ?? argv[++i];
      if (value !== "past" && value !== "current" && value !== "all") {
        throw new Error(`--scope takes past, current or all, not "${value}".`);
      }
      args.scope = value;
    } else if (flag === "--journal") {
      if (inline !== undefined) {
        args.journal = parseOnOff(inline);
      } else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) {
        args.journal = parseOnOff(argv[++i]);
      } else {
        args.journal = true;
      }
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option ${arg}.`);
    } else if (!slugSet) {
      args.slug = arg;
      slugSet = true;
    } else {
      throw new Error(`Unexpected argument ${arg}.`);
    }
  }
  return args;
}

function connect(url: string, anonKey: string) {
  return createClient(url, anonKey, {
    db: { schema: "batchport" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
type Client = ReturnType<typeof connect>;

type Row = Record<string, unknown>;
type ReadResult = { rows: Row[]; error: { code: string; message: string } | null };

async function readAll(
  client: Client,
  table: string,
  columns: string,
  userId: string | null,
): Promise<ReadResult> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = client.from(table).select(columns);
    if (userId) query = query.eq("user_id", userId);
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) {
      return { rows, error: { code: error.code ?? "", message: error.message } };
    }
    const page = (data ?? []) as unknown as Row[];
    rows.push(...page);
    if (page.length < PAGE) return { rows, error: null };
  }
}

function describeError(error: { code: string; message: string }): string {
  return `${error.code} ${error.message}`.trim();
}

// For checks whose passing answer is "nothing": a permission error is also
// nothing (the grant refuses before RLS is asked), any other error is not an
// answer at all and fails.
function isRefusal(error: { code: string }): boolean {
  return error.code === "42501";
}

let failures = 0;
function report(ok: boolean, name: string, detail: string): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
}

function sample(values: string[]): string {
  const shown = values.slice(0, 5).join(", ");
  return values.length > 5 ? `${shown}, and ${values.length - 5} more` : shown;
}

async function expectNothing(
  client: Client,
  name: string,
  table: string,
  column: string,
  userId: string | null,
): Promise<void> {
  const { rows, error } = await readAll(client, table, column, userId);
  if (error) {
    report(
      isRefusal(error),
      name,
      isRefusal(error)
        ? `refused (${describeError(error)})`
        : `read failed, so nothing is known (${describeError(error)})`,
    );
    return;
  }
  report(rows.length === 0, name, `${rows.length} row(s) readable`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
  const anon = connect(url, anonKey);
  const today = new Date().toISOString().slice(0, 10);

  console.log(
    `Probing /share/${args.slug} as anon: scope ${args.scope}, journal ${args.journal ? "on" : "off"}, today ${today} (UTC)\n`,
  );

  // Settings: no row of anybody's, not only this owner's.
  await expectNothing(anon, "user_settings unreadable", "user_settings", "user_id", null);

  // Slug resolution through the definer function.
  const resolved = await anon.rpc("resolve_share_slug", { p_slug: args.slug });
  const userId = typeof resolved.data === "string" ? resolved.data : null;
  report(
    userId !== null,
    "resolve_share_slug",
    resolved.error
      ? describeError({ code: resolved.error.code ?? "", message: resolved.error.message })
      : (userId ?? "returned null (unknown or unshared slug)"),
  );

  if (userId) {
    // Trips inside the scope.
    const allowed = SCOPE_STATUSES[args.scope];
    const trips = await readAll(anon, "trips", "id, status", userId);
    const tripIds = new Set(trips.rows.map((row) => String(row.id)));
    if (trips.error) {
      report(false, "trips in scope", `read failed (${describeError(trips.error)})`);
    } else {
      const outside = trips.rows.filter((row) => !allowed.includes(String(row.status)));
      report(
        outside.length === 0,
        "trips in scope",
        outside.length === 0
          ? `${trips.rows.length} trip(s), all ${allowed.join(" or ")}`
          : `${outside.length} of ${trips.rows.length} outside scope: ${sample(
              outside.map((row) => `${String(row.id)} (${String(row.status)})`),
            )}`,
      );
    }

    // Children of a trip that was not returned.
    const destinations = await readAll(anon, "destinations", "id, trip_id", userId);
    const destinationIds = new Set(destinations.rows.map((row) => String(row.id)));
    const experiences = await readAll(anon, "experiences", "id, destination_id", userId);
    const experienceIds = new Set(experiences.rows.map((row) => String(row.id)));

    const childChecks: {
      name: string;
      result: ReadResult;
      orphan: (row: Row) => boolean;
    }[] = [
      {
        name: "destinations on returned trips",
        result: destinations,
        orphan: (row) => !tripIds.has(String(row.trip_id)),
      },
      {
        name: "experiences on returned trips",
        result: experiences,
        orphan: (row) => !destinationIds.has(String(row.destination_id)),
      },
      {
        name: "photos on returned trips",
        result: await readAll(anon, "photos", "id, owner_type, owner_id", userId),
        orphan: (row) => {
          const owner = String(row.owner_id);
          switch (row.owner_type) {
            case "trip":
              return !tripIds.has(owner);
            case "destination":
              return !destinationIds.has(owner);
            case "experience":
              return !experienceIds.has(owner);
            default:
              return true;
          }
        },
      },
      {
        name: "transport legs on returned trips",
        result: await readAll(anon, "transport_legs", "id, trip_id", userId),
        orphan: (row) => !tripIds.has(String(row.trip_id)),
      },
    ];
    for (const { name, result, orphan } of childChecks) {
      if (trips.error || result.error) {
        const error = result.error ?? trips.error;
        report(false, name, `read failed (${error ? describeError(error) : "unknown"})`);
        continue;
      }
      const leaked = result.rows.filter(orphan);
      report(
        leaked.length === 0,
        name,
        leaked.length === 0
          ? `${result.rows.length} row(s), none outside the returned trips`
          : `${leaked.length} of ${result.rows.length} outside the returned trips: ${sample(
              leaked.map((row) => String(row.id)),
            )}`,
      );
    }

    // Place visits to date only.
    const visits = await readAll(anon, "place_visits", "id, visit_date", userId);
    if (visits.error) {
      report(false, "place visits to date", `read failed (${describeError(visits.error)})`);
    } else {
      const future = visits.rows.filter((row) => String(row.visit_date) > today);
      report(
        future.length === 0,
        "place visits to date",
        future.length === 0
          ? `${visits.rows.length} visit(s), none after ${today}`
          : `${future.length} dated after ${today}: ${sample(
              future.map((row) => `${String(row.id)} (${String(row.visit_date)})`),
            )}`,
      );
    }

    // Journal.
    if (!args.journal) {
      await expectNothing(anon, "journal hidden while off", "journal_entries", "id", userId);
    } else {
      const journal = await readAll(anon, "journal_entries", "id, trip_id", userId);
      if (journal.error || trips.error) {
        const error = journal.error ?? trips.error;
        report(false, "journal on returned trips", `read failed (${error ? describeError(error) : "unknown"})`);
      } else {
        const leaked = journal.rows.filter((row) => !tripIds.has(String(row.trip_id)));
        report(
          leaked.length === 0,
          "journal on returned trips",
          `${journal.rows.length} entries, ${leaked.length} outside the returned trips`,
        );
      }
    }

    // Lists: no UI exists, so only the demo shares them.
    await expectNothing(anon, "lists hidden", "lists", "user_id", userId);
    await expectNothing(anon, "list items hidden", "list_items", "user_id", userId);
  }

  // Demo: resolves, and still shares everything. Also the anon key control.
  const demo = await anon.rpc("demo_user_id");
  const demoId = typeof demo.data === "string" ? demo.data : null;
  report(
    demoId !== null,
    "demo_user_id",
    demo.error
      ? describeError({ code: demo.error.code ?? "", message: demo.error.message })
      : (demoId ?? "returned null (no demo row, or more than one)"),
  );
  if (demoId) {
    const demoTrips = await readAll(anon, "trips", "id", demoId);
    report(
      !demoTrips.error && demoTrips.rows.length > 0,
      "demo trips readable",
      demoTrips.error
        ? `read failed (${describeError(demoTrips.error)})`
        : `${demoTrips.rows.length} trip(s)`,
    );
  }

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

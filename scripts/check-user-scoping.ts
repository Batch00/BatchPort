// Assert that every session-client read of a user-owned table carries an
// explicit owner filter.
//
// Run with: npm run check-user-scoping (and as part of npm run lint)
//
// Pure and static: it parses source, touches no database, and needs no dev
// server. It exists because the bug it catches is invisible at runtime to the
// person who introduced it.
//
// WHY THIS IS NOT REDUNDANT WITH RLS. Nearly every user table's SELECT policy
// is `auth.uid() = user_id OR batchport.is_shared(user_id)`, and is_shared()
// grants the demo account and every account with public_share_enabled. So a
// read with no owner filter returns the caller's rows AND every shared
// profile's rows, with no error and nothing in the logs. getOnThisDay() shipped
// that way and put the demo account's data on a real user's dashboard; the same
// omission was in search, both exports, the offline snapshot, the trip pickers,
// three expense reads, and getPlacesList.
//
// The rule, and the only one: a `.from(<owned table>)` chain on a
// session-scoped client must contain `.eq("user_id", ...)`.
//
// Three things are deliberately NOT flagged:
//
//   * ADMIN-CLIENT chains. createAdminClient() bypasses RLS entirely and is
//     used for genuinely cross-user work (the slug uniqueness check). Those
//     are reviewed by hand, not by this script.
//   * WRITES. insert/update/delete are constrained by the RLS WITH CHECK
//     policies and by the id being written; an owner filter on a write is a
//     different question from an owner filter on a read.
//   * share-data.ts, which reads another user's rows on purpose. It is still
//     checked, because every read in it does carry .eq("user_id", userId): the
//     rule is "name an owner", not "name yourself".
//
// A read that genuinely cannot name an owner (the slug lookup that RESOLVES
// one) carries `// user-scoping-exempt: <reason>` on a line above it. The
// reason is mandatory by convention: an exemption with no argument attached is
// how this rule erodes.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

// Tables and views whose rows belong to a user. A read of one of these without
// an owner filter is the bug. Keep this list in step with the schema: a new
// user-owned table that is not here is not checked.
const OWNED = new Set([
  "trips",
  "destinations",
  "experiences",
  "photos",
  "journal_entries",
  "transport_legs",
  "bucket_list",
  "expenses",
  "user_settings",
  "places",
  "place_visits",
  // Views. security_invoker means they inherit exactly the policies above.
  "v_places",
  "v_expense_rows",
  "v_expense_vendors",
  "v_trip_expense_summary",
  "v_trip_expense_by_group",
  "v_trip_expense_by_category",
  "v_trip_expense_by_day",
  "v_destination_expense",
  "v_presence_points",
  "v_state_coverage",
  "v_user_travel_summary",
  "v_experiences_by_category",
  "v_country_frequency",
  "v_yearly_breakdown",
  "v_bucket_completion",
  "v_travel_extremes",
  "v_trip_days",
]);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) return walk(p);
    return /\.tsx?$/.test(entry.name) && statSync(p).isFile() ? [p] : [];
  });
}

const rel = (f: string) => relative(ROOT, f).replace(/\\/g, "/");

interface Violation {
  file: string;
  line: number;
  table: string;
  chain: string;
}

const violations: Violation[] = [];
let checked = 0;
let exempt = 0;

const files = [
  ...walk(join(ROOT, "src", "lib")),
  ...walk(join(ROOT, "src", "app")),
];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (!text.includes(".from(")) continue;

  // Match .from(...) on its own. Deliberately NOT anchored to a receiver
  // identifier: a comment or a line break between the client and .from() made
  // an earlier version stop matching, which skipped the read silently. A check
  // that quietly stops checking is worse than no check.
  const re = /\.from\(\s*["'`]([a-z_0-9]+)["'`]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const table = m[1];
    if (!OWNED.has(table)) continue;

    // The chain runs to the first statement-ending semicolon or the end of the
    // array element it sits in.
    const rest = text.slice(m.index);
    const stop = rest.search(/;\s*(\n|$)|\n\s*\]\)/);
    const chain = rest.slice(0, stop === -1 ? 500 : stop);

    // Skip writes.
    if (/\.(insert|update|upsert|delete)\(/.test(chain)) continue;

    // Everything that decides what KIND of read this is sits BEFORE .from():
    // `admin.schema("batchport").from(...)`, and any exemption comment. So look
    // backwards, not forwards.
    const before = text.slice(Math.max(0, m.index - 400), m.index);

    // Admin-client chains bypass RLS entirely and are reviewed by hand.
    if (/\.schema\(\s*["'`]batchport["'`]\s*\)\s*$/.test(before.trimEnd())) continue;
    if (/createAdminClient\(\)[\s\S]{0,80}$/.test(before)) continue;

    // An explicit, reasoned exemption within a few lines above.
    if (/\/\/\s*user-scoping-exempt:/.test(before.split(/\r?\n/).slice(-6).join("\n"))) {
      exempt++;
      continue;
    }

    checked++;
    if (!/\.eq\(\s*["'`]user_id["'`]/.test(chain)) {
      violations.push({
        file: rel(file),
        line: text.slice(0, m.index).split("\n").length,
        table,
        chain: chain.replace(/\s+/g, " ").slice(0, 100),
      });
    }
  }
}

console.log(
  `check-user-scoping: ${checked} reads on user-owned tables, ${exempt} exempt`,
);

if (violations.length === 0) {
  console.log("all carry an explicit user_id filter");
  process.exit(0);
}

console.error(`\n${violations.length} read(s) with no owner filter:\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  [${v.table}]`);
  console.error(`      ${v.chain}`);
}
console.error(
  "\nRLS does not scope these to the caller: the policy is\n" +
    "`auth.uid() = user_id OR is_shared(user_id)`, so an unfiltered read also\n" +
    "returns the demo account's rows and every publicly shared profile's rows.\n" +
    "Add .eq(\"user_id\", user.id). See CLAUDE.md, \"Search, Export, and Home Location\".",
);
process.exit(1);

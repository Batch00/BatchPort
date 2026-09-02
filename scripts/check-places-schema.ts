// Phase 0 verification gate for the places feature.
//
// Run with: npm run check-places-schema
//
// Needs a database and the reference data loaded. Like
// check-expense-attribution, it is NOT part of the pure check scripts: it
// reads the live project with BOTH keys, because the two failures it exists to
// catch are invisible to one of them.
//
//   - Service role bypasses RLS, so a table that is granted but policyless
//     reads fine here and returns zero rows and NO ERROR in the app. The anon
//     key is the only instrument that shows it.
//   - The anon key cannot reach pg_catalog, so whether RLS is even enabled has
//     to come from the service role through batchport.places_rls_report().
//
// Five gates, reported in the order the brief asks for them. Exits non-zero if
// any of the first four fail. Gate 5 is a print, not an assertion: it is there
// to be eyeballed.

import { adminClient, anonClient } from "./places-db";

const DEMO_USER_ID = "703fbe07-db8a-41bd-bdee-928c2fa88107";

const NEW_TABLES = [
  "places",
  "place_visits",
  "occasions",
  "place_catalogs",
  "place_catalog_items",
  "place_catalog_item_memberships",
  "admin1_boundaries",
] as const;

const REFERENCE_TABLES = [
  "occasions",
  "place_catalogs",
  "place_catalog_items",
  "place_catalog_item_memberships",
  "admin1_boundaries",
] as const;

const EXPECTED = { catalogs: 7, items: 672, memberships: 695, boundaries: 51 };

// Venues the CSVs carry in more than one file. Each must be ONE item row with
// several membership rows and a merged tenant list, which is the whole reason
// membership is a join table.
const SHARED_VENUES = [
  { qid: "Q20372160", name: "Fiserv Forum" },
  { qid: "Q186080", name: "Crypto.com Arena" },
  { qid: "Q186125", name: "Madison Square Garden" },
] as const;

let failures = 0;
function ok(line: string) {
  console.log(`  PASS  ${line}`);
}
function bad(line: string) {
  failures++;
  console.log(`  FAIL  ${line}`);
}
function head(n: number, title: string) {
  console.log(`\n${n}. ${title}\n${"-".repeat(66)}`);
}

async function main(): Promise<void> {
  const admin = adminClient();
  const anon = anonClient();

  // --- 1. RLS enabled AND at least one policy, per pg_policies -------------
  head(1, "RLS and policies (pg_policies, via the service role)");
  const { data: rls, error: rlsError } = await admin.rpc("places_rls_report");
  if (rlsError) {
    bad(`places_rls_report() failed: ${rlsError.message}`);
  } else {
    const seen = new Map(
      (rls as { table_name: string; rls_enabled: boolean; policy_count: number }[]).map((r) => [
        r.table_name,
        r,
      ]),
    );
    for (const t of NEW_TABLES) {
      const row = seen.get(t);
      if (!row) bad(`${t}: table not found`);
      else if (!row.rls_enabled) bad(`${t}: RLS NOT enabled`);
      else if (Number(row.policy_count) < 1) {
        bad(`${t}: RLS enabled with ZERO policies (this reads as zero rows, not an error)`);
      } else ok(`${t}: RLS on, ${row.policy_count} polic${Number(row.policy_count) === 1 ? "y" : "ies"}`);
    }
  }

  // --- 2. Reference tables readable as anon --------------------------------
  head(2, "Reference tables return rows to the ANON key");
  for (const t of REFERENCE_TABLES) {
    const { count, error } = await anon.from(t).select("id", { count: "exact", head: true });
    if (error) bad(`${t}: ${error.message}`);
    else if (!count) bad(`${t}: anon read returned ${count ?? 0} rows`);
    else ok(`${t}: anon reads ${count} rows`);
  }

  // --- 3. Catalog counts and the shared venues -----------------------------
  head(3, "Catalog counts and shared venues");
  const counts: Record<string, number | null> = {};
  for (const [key, table] of [
    ["catalogs", "place_catalogs"],
    ["items", "place_catalog_items"],
    ["memberships", "place_catalog_item_memberships"],
  ] as const) {
    const { count, error } = await admin.from(table).select("id", { count: "exact", head: true });
    if (error) bad(`${table}: ${error.message}`);
    counts[key] = count ?? null;
  }
  for (const [key, want] of [
    ["catalogs", EXPECTED.catalogs],
    ["items", EXPECTED.items],
    ["memberships", EXPECTED.memberships],
  ] as const) {
    if (counts[key] === want) ok(`${key}: ${want}`);
    else bad(`${key}: ${counts[key]} (expected ${want})`);
  }

  const { count: nullGeoms, error: nullError } = await admin
    .from("place_catalog_items")
    .select("id", { count: "exact", head: true })
    .is("geom", null);
  if (nullError) bad(`null geom check: ${nullError.message}`);
  else if (nullGeoms === 0) ok("place_catalog_items with a null geom: 0");
  else bad(`place_catalog_items with a null geom: ${nullGeoms}`);

  console.log();
  for (const venue of SHARED_VENUES) {
    const { data, error } = await admin
      .from("place_catalog_items")
      .select("id, name, tenants, place_catalog_item_memberships(catalog_id, place_catalogs(slug))")
      .eq("wikidata_qid", venue.qid);
    if (error) {
      bad(`${venue.name}: ${error.message}`);
      continue;
    }
    if (!data || data.length !== 1) {
      bad(`${venue.name} (${venue.qid}): ${data?.length ?? 0} item rows, expected exactly 1`);
      continue;
    }
    // PostgREST types an embedded relation as an array; a to-one embed still
    // arrives as one element, so both shapes are normalized here rather than
    // asserted into one.
    const item = data[0] as unknown as {
      name: string;
      tenants: string[];
      place_catalog_item_memberships: {
        place_catalogs: { slug: string } | { slug: string }[] | null;
      }[];
    };
    const slugs = item.place_catalog_item_memberships
      .flatMap((m) => {
        const c = m.place_catalogs;
        if (!c) return [];
        return Array.isArray(c) ? c.map((x) => x.slug) : [c.slug];
      })
      .filter(Boolean)
      .sort();
    if (slugs.length < 2) {
      bad(`${item.name}: 1 item row but only ${slugs.length} membership(s)`);
      continue;
    }
    if (item.tenants.length < 2) {
      bad(`${item.name}: tenants did not merge (${item.tenants.join("|") || "empty"})`);
      continue;
    }
    ok(`${item.name}: 1 item, ${slugs.length} memberships [${slugs.join(", ")}]`);
    console.log(`        tenants: ${item.tenants.join(" | ")}`);
  }

  // --- 4. admin1_boundaries ------------------------------------------------
  head(4, "admin1_boundaries");
  const { data: validity, error: validityError } = await admin.rpc("admin1_validity_report");
  if (validityError) {
    bad(`admin1_validity_report() failed: ${validityError.message}`);
  } else {
    const rows = validity as {
      code: string;
      name: string;
      geom_type: string;
      is_valid: boolean;
      invalid_reason: string | null;
      n_points: number;
    }[];
    if (rows.length === EXPECTED.boundaries) ok(`rows: ${rows.length}`);
    else bad(`rows: ${rows.length} (expected ${EXPECTED.boundaries})`);

    const invalid = rows.filter((r) => !r.is_valid);
    if (invalid.length === 0) ok("every geometry is valid (ST_IsValid)");
    else {
      bad(`${invalid.length} invalid geometr${invalid.length === 1 ? "y" : "ies"}`);
      for (const r of invalid) console.log(`        ${r.code} ${r.name}: ${r.invalid_reason}`);
    }
    const points = rows.reduce((n, r) => n + r.n_points, 0);
    console.log(`        total vertices: ${points.toLocaleString("en-US")}`);
    const dc = rows.find((r) => r.code === "DC");
    if (dc) ok("DC present");
    else bad("DC missing");
  }

  // --- 5. v_state_coverage over the real destinations ----------------------
  head(5, "v_state_coverage over existing trip destinations (eyeball this)");
  const { data: owners, error: ownerError } = await admin
    .from("trips")
    .select("user_id")
    .neq("user_id", DEMO_USER_ID)
    .limit(1000);
  if (ownerError) {
    console.log(`  could not resolve a user: ${ownerError.message}`);
  } else {
    const userIds = [...new Set((owners ?? []).map((t) => t.user_id as string))];
    for (const userId of userIds) {
      const { data: cov, error: covError } = await admin
        .from("v_state_coverage")
        .select("state_code, state_name, visited, first_visit_date, point_count, states_visited, states_total, pct")
        .eq("user_id", userId)
        .order("state_name", { ascending: true });
      if (covError) {
        console.log(`  ${userId}: ${covError.message}`);
        continue;
      }
      const rows = (cov ?? []) as {
        state_code: string;
        state_name: string;
        visited: boolean;
        first_visit_date: string | null;
        point_count: number;
        states_visited: number;
        states_total: number;
        pct: number;
      }[];
      const hit = rows.filter((r) => r.visited);
      console.log(`\n  user ${userId}`);
      console.log(
        `  ${hit.length} of ${rows[0]?.states_total ?? 0} states (${rows[0]?.pct ?? 0}%)`,
      );
      for (const r of hit) {
        console.log(
          `    ${r.state_code}  ${r.state_name.padEnd(22)} first ${r.first_visit_date ?? "(no date)"}  points ${r.point_count}`,
        );
      }
      if (!hit.length) console.log("    (no states resolved)");
    }

    // Non-US points resolving to nothing is expected, not an error. Reported as
    // context so the state list above can be read against the whole picture.
    const { count: presence } = await admin
      .from("v_presence_points")
      .select("name", { count: "exact", head: true });
    console.log(`\n  v_presence_points total rows (all users): ${presence ?? "?"}`);
    console.log(
      "  Points outside the US (international destinations, Canadian arenas,\n" +
        "  territory parks) resolve to no state by design and are not flagged.",
    );
  }

  console.log(`\n${"=".repeat(66)}`);
  console.log(failures === 0 ? "GATE PASSED" : `GATE FAILED: ${failures} check(s)`);
  if (failures) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

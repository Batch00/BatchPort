// Does /share/[slug] leak the demo account's expenses?
//
// THIS SCRIPT EXISTS FOR ITS NEGATIVE CASE. A gate exercised only on the route
// that is supposed to pass is not tested at all, so the assertion that must
// fail loudly is the one about /share/demo, not the one about /demo.
//
// WHY THE CASE IS SUBTLE
//
// getUserBySlug resolves a slug when `public_share_enabled = true` OR
// `is_demo = true`. The demo account has the slug "demo". So /share/demo
// renders THE DEMO ACCOUNT through the same SharedProfileView that /demo uses,
// with the same anon client, and batchport.is_demo_account() means RLS will
// happily serve that account's expenses to anon.
//
// In other words this is the one route where every database-level protection
// says yes and only the surface says no. The single thing standing between a
// public URL and a spending ledger is that src/app/share/[slug]/page.tsx calls
// getSharedProfile(userId) without the flag.
//
// This asserts that over HTTP, against the rendered HTML, so it breaks if
// somebody:
//   - flips the default of the `expenses` option,
//   - adds the flag to the share route,
//   - moves the decision into SharedProfileView (which cannot know the route),
//   - or derives it from the user, which is wrong for exactly this account.
//
// It fetches the real pages rather than calling getSharedProfile, because that
// function needs cookies() and cannot run outside a request. The rendered HTML
// is also the thing that actually matters.
//
// THE SIGNED-IN HALF EXISTS BECAUSE THE ANONYMOUS HALF MISSED A REAL BUG.
//
// user_settings_public was scoped to {anon} only, so a signed-in visitor fell
// through to the owner policy and saw "Profile not found" on every share page
// but their own. This script fetched anonymously and so was blind to it for
// two rounds (see KNOWN_ISSUES.md). Fixing it widened who can resolve a slug,
// which handed /share/[slug] a caller class it never had: an AUTHENTICATED
// NON-OWNER. RLS lets that caller read the demo account's expenses exactly as
// it lets anon, so the surface flag is the only thing holding the line for
// them too, and nothing was checking it.
//
// The session has to belong to somebody who is NOT the owner, or the test is
// vacuous: the owner could always read their own settings row, so signing in
// as them would have passed before the fix as well. So this creates a
// throwaway auth user, signs in as it, asserts, and deletes it.
//
// NOTE THAT auth.users IS SHARED ACROSS BATCH APPS. The user is created with a
// reserved address at an unroutable domain, deleted in a finally, and swept on
// entry like the parity fixture. Set GATE_SKIP_SIGNED_IN=1 to skip this half
// entirely if you would rather it never touch that table.
//
// Prerequisites: a dev server on BASE_URL, a seeded demo account
// (npm run seed-demo -- --expenses-only), and .env.local with
// NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY.
//
// Run with: npm run check-share-gate

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { EXPENSES, TRIPS } from "./demo-dataset";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

// The throwaway account the signed-in half runs as. Unroutable domain, so it
// can never receive mail even if something tries to send it some.
const GATE_EMAIL = "parity-gate@batchport.invalid";

function loadEnvLocal(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[trimmed.slice(0, eq).trim()] = value;
    }
  } catch {
    // Fall back to process.env.
  }
  return env;
}

/** The cookie @supabase/ssr writes, rebuilt from a session.
 *
 * Chunked at 3180 characters the way the library does, because a session with
 * a long JWT exceeds one cookie. This mirrors library internals and could drift
 * with a version bump, which is why the caller asserts the session is actually
 * accepted before concluding anything from what the page renders. A broken
 * cookie then fails loudly instead of producing a page with no expenses on it
 * and calling that a pass. */
function sessionCookies(supabaseUrl: string, session: object): string {
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  const value = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  const name = `sb-${ref}-auth-token`;
  if (value.length <= 3180) return `${name}=${value}`;
  const parts: string[] = [];
  for (let i = 0; i * 3180 < value.length; i += 1) {
    parts.push(`${name}.${i}=${value.slice(i * 3180, (i + 1) * 3180)}`);
  }
  return parts.join("; ");
}

async function fetchAs(path: string, cookie: string): Promise<string> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { accept: "text/html", cookie },
    redirect: "follow",
  });
  return response.text();
}

// Vendors that appear ONLY in the demo expense ledgers, so finding one in a
// page's HTML means that page rendered spending.
//
// THE LIST IS VERIFIED AGAINST THE DATASET BEFORE IT IS USED, because the
// first draft of this file included "Naschmarkt" and the check failed on its
// first run. Not a leak: Naschmarkt is also a Vienna EXPERIENCE in the demo
// data, so /share/demo renders it legitimately as part of the trip story.
//
// A marker that names anything else on the page is worse than useless in both
// directions. Here it cried leak when there was none; a marker that quietly
// stopped matching would let a real leak pass. So assertMarkersAreExpenseOnly
// checks them against every trip, city, and experience name in the fixture,
// and refuses to run if one collides.
const EXPENSE_MARKERS = [
  "Flying Pig Hostel",
  "Szimpla Kert",
  "Blue Car Rental",
  "Jokulsarlon boat",
];


/**
 * Is this marker safe to search a page for?
 *
 * THE COMPARISON MUST MATCH HOW THE MARKER IS USED. The leak test asks
 * `html.includes(marker)`, so a marker that is a SUBSTRING of anything the
 * page legitimately renders is unusable, not merely a marker that equals it.
 *
 * Both mistakes have now been made here. "Naschmarkt" is a vendor and also a
 * Vienna experience, caught by an equality check. "RheinWeinWelt" is a vendor
 * and also the first word of the experience "RheinWeinWelt Wine Tasting",
 * which sailed straight through that equality check and reported a leak on a
 * page that was behaving perfectly. Containment is checked both ways, since a
 * short legitimate name can equally sit inside a longer vendor.
 */
function isUsableMarker(marker: string, legitimate: Iterable<string>): boolean {
  const needle = marker.toLowerCase();
  for (const other of legitimate) {
    const hay = other.toLowerCase();
    if (hay.includes(needle) || needle.includes(hay)) return false;
  }
  return true;
}

/** Every string the demo renders that is NOT an expense: trip names, city
 * names, experience names. A marker colliding with one of these cannot tell
 * "the page shows spending" from "the page shows a trip". */
function nonExpenseText(): Set<string> {
  const text = new Set<string>();
  for (const trip of TRIPS) {
    text.add(trip.name);
    for (const destination of trip.destinations) {
      text.add(destination.city);
      text.add(destination.country);
      for (const experience of destination.experiences) {
        text.add(experience.name);
      }
    }
  }
  return text;
}

function assertMarkersAreExpenseOnly(): void {
  const others = nonExpenseText();
  const vendors = new Set(
    Object.values(EXPENSES).flatMap((ledger) => ledger.map((e) => e.vendor)),
  );
  const problems: string[] = [];
  for (const marker of EXPENSE_MARKERS) {
    if (!vendors.has(marker)) {
      problems.push(`"${marker}" is not a vendor in scripts/demo-dataset.ts`);
    }
    if (!isUsableMarker(marker, others)) {
      problems.push(
        `"${marker}" appears inside a trip, city, or experience name, so finding it on a page proves nothing`,
      );
    }
  }
  if (problems.length > 0) {
    console.error("\nMarker list is unusable:\n");
    for (const problem of problems) console.error(`  x ${problem}`);
    console.error("");
    process.exit(1);
  }
}

// A figure only the spend line prints. The demo's Interrail ledger totals
// 2158 and Iceland 3177; either formatted total appearing on a page is the
// same evidence as a vendor name.
const TOTAL_MARKERS = ["$2,158", "$3,177"];

let failures = 0;
let passes = 0;

function report(name: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "ok   " : "FAIL "} ${name}`);
  console.log(`         ${detail}`);
  if (ok) passes += 1;
  else failures += 1;
}

async function fetchPage(path: string): Promise<string> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { accept: "text/html" },
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  return response.text();
}

function found(html: string, markers: string[]): string[] {
  return markers.filter((marker) => html.includes(marker));
}

// --- The signed-in half -----------------------------------------------------

/** Distinctive vendor names from the owner's own ledger, for leak markers.
 *
 * Filtered against everything else the page legitimately renders (trip names,
 * stop names, experience names) for the same reason the demo markers are: a
 * marker that names something the page is supposed to show cannot tell a leak
 * from a normal render. That check caught "Naschmarkt" in the demo set. */
function makeSchemaClient(url: string, key: string) {
  return createClient(url, key, {
    db: { schema: "batchport" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function ownerMarkers(
  db: ReturnType<typeof makeSchemaClient>,
  slug: string,
): Promise<string[]> {
  const settings = await db
    .from("user_settings")
    .select("user_id")
    .eq("public_slug", slug)
    .maybeSingle();
  const userId = (settings.data as { user_id?: string } | null)?.user_id;
  if (!userId) return [];

  const [expenses, trips, stops, experiences] = await Promise.all([
    db.from("expenses").select("vendor").eq("user_id", userId),
    db.from("trips").select("name").eq("user_id", userId),
    db.from("destinations").select("name").eq("user_id", userId),
    db.from("experiences").select("name").eq("user_id", userId),
  ]);
  const legitimate = new Set<string>();
  for (const r of (trips.data ?? []) as { name: string }[]) legitimate.add(r.name);
  for (const r of (stops.data ?? []) as { name: string }[]) legitimate.add(r.name);
  for (const r of (experiences.data ?? []) as { name: string }[]) legitimate.add(r.name);

  const seen = new Set<string>();
  for (const r of (expenses.data ?? []) as { vendor: string | null }[]) {
    const v = (r.vendor ?? "").trim();
    // Long enough to be distinctive, and not a substring of anything the page
    // legitimately renders. Substring, not equality: see isUsableMarker.
    if (v.length >= 6 && isUsableMarker(v, legitimate)) seen.add(v);
  }
  return [...seen].slice(0, 12);
}

async function checkSignedIn(): Promise<void> {
  console.log("\n--- SIGNED IN AS A NON-OWNER ------------------------------");

  if (process.env.GATE_SKIP_SIGNED_IN === "1") {
    console.log("  skipped (GATE_SKIP_SIGNED_IN=1). This run did NOT check the");
    console.log("  authenticated caller class, which is the one the share-page");
    console.log("  fix introduced.");
    failures += 1;
    return;
  }

  const env = { ...loadEnvLocal(), ...process.env } as Record<string, string>;
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    console.error("  Missing Supabase env. Cannot run the signed-in half.");
    failures += 1;
    return;
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // Same key, scoped to the schema, for the data reads. The auth admin API
  // lives on the unscoped client, so both are needed.
  const adminDb = makeSchemaClient(url, serviceKey);

  // Sweep any previous run's user before making a new one, matching the
  // parity fixture's on-entry purge.
  const purge = async () => {
    const { data } = await admin.auth.admin.listUsers();
    for (const user of data?.users ?? []) {
      if (user.email === GATE_EMAIL) {
        await admin.auth.admin.deleteUser(user.id);
      }
    }
  };
  await purge();

  const password = `gate-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const created = await admin.auth.admin.createUser({
    email: GATE_EMAIL,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    console.error(`  Could not create the throwaway user: ${created.error?.message}`);
    failures += 1;
    return;
  }

  try {
    const anon = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signIn = await anon.auth.signInWithPassword({
      email: GATE_EMAIL,
      password,
    });
    if (signIn.error || !signIn.data.session) {
      console.error(`  Could not sign in as the throwaway user: ${signIn.error?.message}`);
      failures += 1;
      return;
    }
    const cookie = sessionCookies(url, signIn.data.session);

    // PRECONDITION. If the cookie is not accepted, every page below renders
    // signed-out and every "no expenses" assertion passes for the wrong
    // reason. /dashboard is protected, so reaching it proves the session is
    // live. This is what makes the hand-built cookie safe to rely on.
    const dashboard = await fetchAs("/dashboard", cookie);
    const authed = !dashboard.includes("BatchPort is invite-only");
    report(
      "PRECONDITION: the throwaway session is accepted by the app",
      authed,
      authed
        ? "/dashboard rendered rather than redirecting to the landing page"
        : "the session cookie was not accepted, so nothing below means anything",
    );
    if (!authed) return;

    // The owner's slug, read rather than hardcoded.
    const settings = await adminDb
      .from("user_settings")
      .select("public_slug, is_demo")
      .eq("public_share_enabled", true);
    const ownerSlug = (settings.data ?? [])
      .filter((row: { is_demo: boolean }) => !row.is_demo)
      .map((row: { public_slug: string | null }) => row.public_slug)
      .find(Boolean);
    if (!ownerSlug) {
      report("an owner slug exists to test against", false, "none found");
      return;
    }

    // THE FIX: a signed-in non-owner can now see somebody else's profile.
    const ownerPage = await fetchAs(`/share/${ownerSlug}`, cookie);

    // Slug resolution and CONTENT are separate failures and get separate
    // assertions. The first version of this check tested only for the absence
    // of "Profile not found" and passed against a page that resolved the slug
    // and then rendered "No trips to show yet", which is a shell with the
    // profile's data missing. A gate that reports green on an empty page is
    // worse than no gate.
    const resolved = !ownerPage.includes("Profile not found");
    report(
      `/share/${ownerSlug} resolves the slug for a signed-in non-owner`,
      resolved,
      resolved
        ? "the profile rendered rather than 'Profile not found'"
        : "still 'Profile not found'; user_settings_public may be scoped to anon again",
    );
    const hasContent =
      resolved &&
      !ownerPage.includes("No trips to show yet") &&
      !ownerPage.includes("No travel data yet");
    report(
      `/share/${ownerSlug} actually renders the profile's trips and stats`,
      hasContent,
      hasContent
        ? "trips and stats present"
        : "the page is an empty shell: the slug resolved but trips/destinations/stats " +
          "are unreadable. Check the `roles` column on those tables' public policies.",
    );

    // THE GATE, for the caller class the fix introduced.
    // THE OWNER'S OWN VENDORS, not the demo's. Checking /share/batch00 for
    // "Flying Pig Hostel" proves nothing: that is a demo vendor and could
    // never appear on the owner's page whether the gate held or not. A leak
    // here would spell the OWNER's ledger, so the markers have to come from
    // the owner's rows. Read from the database rather than hardcoded, so the
    // check keeps working as the ledger changes.
    const ownerVendors = await ownerMarkers(adminDb, ownerSlug);
    report(
      `owner-specific leak markers exist to test with (${ownerVendors.length})`,
      ownerVendors.length >= 3,
      ownerVendors.length >= 3
        ? `e.g. ${ownerVendors.slice(0, 3).join(", ")}`
        : "too few distinctive vendors on the owner's ledger to test with",
    );
    const ownerLeak = [
      ...found(ownerPage, ownerVendors),
      ...found(ownerPage, TOTAL_MARKERS),
    ];
    report(
      `/share/${ownerSlug} shows NO spend to a signed-in non-owner`,
      ownerLeak.length === 0,
      ownerLeak.length === 0
        ? `none of ${ownerVendors.length} owner vendors, no totals`
        : `LEAKED: ${ownerLeak.join(", ")}`,
    );

    // And the page really is populated, so the line above is not the empty
    // shell passing again.
    report(
      `/share/${ownerSlug} is populated while showing no spend`,
      hasContent,
      hasContent
        ? "trips and stats rendered, and still no ledger on the page"
        : "empty shell, so the leak result above is vacuous",
    );

    const demoPage = await fetchAs("/share/demo", cookie);
    const demoLeak = [...found(demoPage, EXPENSE_MARKERS), ...found(demoPage, TOTAL_MARKERS)];
    report(
      "/share/demo shows NO spend to a signed-in non-owner",
      demoLeak.length === 0,
      demoLeak.length === 0 ? "no vendors, no totals" : `LEAKED: ${demoLeak.join(", ")}`,
    );

    // Control, so the two "no spend" results above are not vacuous.
    const demoRendered = demoPage.includes("Interrail Summer");
    report(
      "/share/demo renders the demo profile for that session",
      demoRendered,
      demoRendered
        ? "demo trips present"
        : "empty shell: the two 'no spend' results above are therefore vacuous, " +
          "since a page with no trips on it trivially has no spending on it",
    );
  } finally {
    await purge();
  }
}

async function main(): Promise<void> {
  assertMarkersAreExpenseOnly();

  let demoHtml: string;
  let shareHtml: string;
  try {
    demoHtml = await fetchPage("/demo");
    shareHtml = await fetchPage("/share/demo");
  } catch (error) {
    // Not a skip. A gate that cannot be checked is a gate nobody should trust,
    // and reporting "passed" here would be the exact failure this guards.
    console.error(
      `\nCould not reach ${BASE_URL}. Start the dev server and re-run; this ` +
        "check does not pass by default.\n" +
        `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }

  console.log("\n--- /share/demo, THE CASE THAT MATTERS --------------------");
  const leakedVendors = found(shareHtml, EXPENSE_MARKERS);
  const leakedTotals = found(shareHtml, TOTAL_MARKERS);
  report(
    "/share/demo renders NO expense vendor",
    leakedVendors.length === 0,
    leakedVendors.length === 0
      ? `none of ${EXPENSE_MARKERS.length} demo vendors present`
      : `LEAKED: ${leakedVendors.join(", ")}`,
  );
  report(
    "/share/demo renders NO trip spend total",
    leakedTotals.length === 0,
    leakedTotals.length === 0
      ? `none of ${TOTAL_MARKERS.join(" / ")} present`
      : `LEAKED: ${leakedTotals.join(", ")}`,
  );

  console.log("\n--- /demo, the control ------------------------------------");
  // This one is a CONTROL, not the point. If it fails, the negative result
  // above proves nothing: a page that renders no expenses anywhere would pass
  // the leak test trivially.
  const shownTotals = found(demoHtml, TOTAL_MARKERS);
  report(
    "/demo DOES render trip spend (so the leak test is not vacuous)",
    shownTotals.length > 0,
    shownTotals.length > 0
      ? `found ${shownTotals.join(", ")}`
      : "no spend totals on /demo; seed with npm run seed-demo -- --expenses-only",
  );

  // Both pages must have rendered the same profile otherwise, or the
  // comparison is between a page and an error state.
  const bothHaveTrips =
    demoHtml.includes("Interrail Summer") && shareHtml.includes("Interrail Summer");
  report(
    "both routes rendered the demo profile",
    bothHaveTrips,
    bothHaveTrips
      ? "Interrail Summer present on both"
      : "one of the routes did not render the demo trips at all",
  );

  await checkSignedIn();

  console.log("");
  if (failures > 0) {
    console.error(`Share gate: ${failures} check(s) FAILED.\n`);
    process.exit(1);
  }
  console.log(`Share gate: ${passes} checks passed.`);
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

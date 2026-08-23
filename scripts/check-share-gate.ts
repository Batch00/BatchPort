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
// Prerequisites: a dev server on BASE_URL and a seeded demo account
// (npm run seed-demo -- --expenses-only).
//
// Run with: npm run check-share-gate

import { EXPENSES, TRIPS } from "./demo-dataset";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

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
    if (others.has(marker)) {
      problems.push(
        `"${marker}" is also a trip, city, or experience name, so finding it on a page proves nothing`,
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

function report(name: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "ok   " : "FAIL "} ${name}`);
  console.log(`         ${detail}`);
  if (!ok) failures += 1;
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

  console.log("");
  if (failures > 0) {
    console.error(`Share gate: ${failures} check(s) FAILED.\n`);
    process.exit(1);
  }
  console.log("Share gate: 4 checks passed.\n");
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

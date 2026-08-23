// Turn expenses_source.csv into a reviewable fixture.
//
// This is the "fixture over parser" step. A parser that trusted the sheet's
// section headers would file two flights and two ferries as public transport,
// put six supermarket runs in Restaurants, and call ten museums and landmarks
// "Other". So the mapping is made HERE, in a decision list a person can read,
// and the output is a checked-in TS file that gets reviewed before a single
// row reaches the database.
//
// It writes nothing to Supabase. scripts/import-expenses.ts does that, from
// the reviewed fixture.
//
// Run with:
//   npm run build-expense-fixture              write the fixture and report
//   npm run build-expense-fixture -- --report  print the report only
//
// THE ASSERTIONS ARE THE POINT. The script refuses to write a fixture whose
// arithmetic has drifted from the sheet, so nobody has to check the totals by
// hand:
//
//   - 226 rows in, 226 rows out
//   - grand totals still 4492.00 (Europe) and 2957.00 (Scandinavia)
//   - alcohol totals 878.00 and 420.00, over exactly the rows whose section
//     is Alc and no others
//   - every emitted category slug exists in the seeded taxonomy
//
// The four SECTION subtotals deliberately do NOT survive as group totals, and
// that is by design rather than drift: is_alcohol is a cross-cut, so the
// sheet's Alc column is redistributed across Bars and Nightlife and Groceries
// and Markets, and the sheet's "Other" column is mostly Activities.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// --- Source shape -----------------------------------------------------------

interface SourceRow {
  trip: string;
  tab: string;
  section: string;
  subsection: string;
  vendor: string;
  amountUsd: number;
  spentOn: string | null;
  /** 1-based line number in the CSV, for the report. */
  line: number;
}

// --- Output shape -----------------------------------------------------------

/** How confident the mapping is, and therefore what needs reading. */
export type FixtureReview =
  /** The sheet's own section/subsection already said this. Nothing to read. */
  | "agrees"
  /** Same group as the sheet implied, finer category chosen inside it. */
  | "refined"
  /** The sheet's section/subsection pointed at a DIFFERENT group. Read these. */
  | "crossover"
  /** A guess that needs a human. Read these first. */
  | "assumption";

export interface FixtureExpense {
  /** Deterministic uuid v5 over the source row, so the import is re-runnable. */
  id: string;
  tripName: string;
  vendor: string;
  amountUsd: number;
  spentOn: string | null;
  categorySlug: string | null;
  isAlcohol: boolean;
  note: string | null;
  // --- Provenance, kept so the fixture can be re-reviewed later --------------
  sourceSection: string;
  sourceSubsection: string;
  sourceLine: number;
  review: FixtureReview;
  /** Why this category, in one line. Shown in the report. */
  why: string;
}

// --- The seeded taxonomy ----------------------------------------------------
// Mirrors scripts/sql/2026-08-19-expenses.sql. A slug not in this map fails the
// build rather than reaching an insert that would violate the foreign key.

const CATEGORY_GROUP: Record<string, string> = {
  flights: "transport",
  rail: "transport",
  "transit-and-passes": "transport",
  "taxi-and-rideshare": "transport",
  micromobility: "transport",
  ferry: "transport",
  "car-and-fuel": "transport",
  hotel: "lodging",
  hostel: "lodging",
  "short-term-rental": "lodging",
  restaurants: "food-and-drink",
  "cafe-and-bakery": "food-and-drink",
  "groceries-and-markets": "food-and-drink",
  "bars-and-nightlife": "food-and-drink",
  "attractions-and-landmarks": "activities",
  "museums-and-galleries": "activities",
  "tours-and-guides": "activities",
  "outdoors-and-nature": "activities",
  "entertainment-and-events": "activities",
  "wellness-and-spa": "activities",
  "shopping-and-souvenirs": "other",
  "convenience-and-sundries": "other",
  "fees-and-admin": "other",
  connectivity: "other",
  "health-and-pharmacy": "other",
  misc: "other",
};

// --- What the sheet itself implies ------------------------------------------
//
// Two levels, because "crossover" and "refined" are different things to read.
// The GROUP is what the sheet's column meant; the CATEGORY is the most
// specific thing that column could have meant. A row that changes group is a
// row the sheet would have got wrong. A row that only changes category is a
// second level the sheet never had.

interface SheetIntent {
  group: string;
  category: string;
}

function sheetIntent(row: SourceRow): SheetIntent {
  const key = `${row.section}|${row.subsection}`;
  switch (key) {
    case "Alc|":
      return { group: "food-and-drink", category: "bars-and-nightlife" };
    case "Food|":
      return { group: "food-and-drink", category: "restaurants" };
    case "Flight/travel|":
      return { group: "transport", category: "flights" };
    case "Flight/travel|Flights":
      return { group: "transport", category: "flights" };
    case "Flight/travel|Eurail Reservation":
      return { group: "transport", category: "rail" };
    case "Flight/travel|E-vehicle":
      return { group: "transport", category: "micromobility" };
    case "Flight/travel|Public Transport":
      return { group: "transport", category: "transit-and-passes" };
    case "Flight/travel|Lodging":
      return { group: "lodging", category: "hostel" };
    case "Other|":
      return { group: "other", category: "misc" };
    default:
      throw new Error(`Unmapped section/subsection: ${key}`);
  }
}

// --- The decision list ------------------------------------------------------
//
// Read top to bottom, first match wins, scoped by section so a vendor name
// that means two things in two columns (Fauno is a restaurant in Food and a
// bar in Alc) resolves correctly in both.
//
// Vendor matching is exact and case-insensitive on the trimmed name, never a
// substring, so "Bar Costello" cannot be caught by a rule about "Bar".

interface Rule {
  section?: string;
  subsection?: string;
  trip?: string;
  vendors: string[];
  category: string | null;
  why: string;
  note?: string;
}

const RULES: Rule[] = [
  // --- Alcohol that was bought in a shop, not a bar -------------------------
  // The whole reason is_alcohol is a boolean and not a category: these still
  // count toward the drinking total, they just are not nightlife.
  {
    section: "Alc",
    vendors: ["Tesco", "Convenient store beer"],
    category: "groceries-and-markets",
    why: "store-bought, not a bar; still alcohol",
  },

  // --- Food that was a shop or a market ------------------------------------
  {
    section: "Food",
    vendors: [
      "Basel station Market",
      "Borough Market",
      "COOP",
      "Dirk super market",
      "Louvre Super Market",
      "Station fruit",
      "7 eleven",
    ],
    category: "groceries-and-markets",
    why: "supermarket or market stall, not a meal out",
  },
  {
    section: "Food",
    vendors: ["Vending machine"],
    category: "groceries-and-markets",
    why: "the smallest possible shop; kept in Food rather than Sundries",
  },

  // --- Food that was coffee, pastry, or gelato ------------------------------
  {
    section: "Food",
    vendors: [
      "Bar Costello",
      "Bara Thierry",
      "Candy shop",
      "Cream",
      "Dolcemente Salato",
      "Dunkin",
      "Lil bakery",
      "Pantheon Cream",
      "Pret a Manger",
      "Starbucks",
      "Street coffee",
      "Brunch cafe",
      "Espresso house",
      "Social Brew",
    ],
    category: "cafe-and-bakery",
    why: "counter service coffee, bakery, or gelato",
  },

  // --- The undated pair, which the sheet filed under one blank subsection ---
  {
    section: "Flight/travel",
    subsection: "",
    vendors: ["EUrail Pass"],
    category: "rail",
    why: "a rail pass, filed beside a flight under one blank subheader",
  },
  {
    section: "Flight/travel",
    subsection: "",
    vendors: ["London round-trip"],
    category: "flights",
    why: "the round-trip flight, and its offset",
  },

  // --- Flights and ferries the sheet filed as public transport --------------
  {
    section: "Flight/travel",
    subsection: "Public Transport",
    vendors: ["Flight to Barcelona", "Flight to Paris"],
    category: "flights",
    why: "an intra-Europe flight, not a metro ticket",
  },
  {
    section: "Flight/travel",
    subsection: "Public Transport",
    vendors: ["Sorrento Ferry", "Naples Ferry"],
    category: "ferry",
    why: "a ferry crossing",
  },
  {
    section: "Flight/travel",
    subsection: "Public Transport",
    vendors: ["Paris Uber"],
    category: "taxi-and-rideshare",
    why: "a rideshare",
  },
  {
    section: "Flight/travel",
    subsection: "Public Transport",
    vendors: ["Arlanda Express", "Airport train"],
    category: "rail",
    why: "a named airport rail service, matching the Arlanda call",
  },

  // --- The one flight that was a mistake, kept because it was real money ----
  {
    section: "Flight/travel",
    subsection: "Flights",
    vendors: ["Oops Stockholm-Oslo"],
    category: "flights",
    why: "kept as real spend, with the circumstance in a note",
    note:
      "Booked in error and not flown. Kept because the money was spent. The " +
      "flight actually taken that day is the 52 Stockholm to Oslo.",
  },

  // --- Two rows that would otherwise fall through to a section default ------
  // Both are recorded here as DECIDED rather than left to a default, because
  // a default that happens to be right is indistinguishable from one that is
  // wrong until somebody re-reads the sheet.
  {
    section: "Alc",
    vendors: ["Public Drug Store"],
    category: "bars-and-nightlife",
    why: "Publicis Drugstore on the Champs-Elysees, a brasserie and bar; the date puts the trip in Paris",
  },
  {
    section: "Food",
    vendors: ["Presbryian"],
    category: "restaurants",
    why: "a 9 lunch in Oslo",
  },

  // --- The sheet's "Other" column, which was mostly Activities --------------
  {
    section: "Other",
    vendors: [
      "Basílica Sagrada Familia",
      "Colosseum",
      "DOGE Palace",
      "Duomo",
      "Pantheon",
      "Church of out savior",
      "Round Tower",
    ],
    category: "attractions-and-landmarks",
    why: "paid admission to a landmark",
  },
  {
    section: "Other",
    vendors: ["The Louvre", "Vatican Museum", "Vasa Museum", "Fram Museum"],
    category: "museums-and-galleries",
    why: "museum admission",
  },
  {
    section: "Other",
    vendors: ["Amsterdam Cruise", "Seine Boat Cruise"],
    category: "tours-and-guides",
    why: "a sightseeing cruise, which is an activity rather than transport",
  },
  {
    section: "Other",
    vendors: ["Harder Kulm Trip"],
    category: "outdoors-and-nature",
    why: "a mountain excursion",
  },
  {
    section: "Other",
    vendors: ["Tivola garden"],
    category: "entertainment-and-events",
    why: "an amusement park",
  },
  {
    section: "Other",
    vendors: ["CentralBadet Spa", "Floating Sauna", "Gym"],
    category: "wellness-and-spa",
    why: "spa, sauna, gym",
  },
  {
    section: "Other",
    vendors: ["Day locker"],
    category: "fees-and-admin",
    why: "luggage storage, which is a fee rather than a thing bought",
  },
  {
    section: "Other",
    vendors: ["Snus"],
    category: "convenience-and-sundries",
    why: "a shop-bought sundry",
  },
];

// --- Europe's lodging rows --------------------------------------------------
//
// Scandinavia's lodging rows say "Hostel" outright. Europe's give only a city,
// which made these look like the one guess in the import. They are not: they
// are multi-night totals paid at check-in, and the implied per-night rates are
// hostel rates throughout. Nights derived from the gap to the next lodging
// payment, the last one bounded by the trip end:
//
//   Paris      65 / 3n = 22      Amsterdam  90 / 3n = 30
//   Rudesheim  36 / 1n = 36      Interlaken 150 / 2n = 75
//   Milano    143 / 3n = 48      Venice      77 / 2n = 38
//   Rome      204 / 3n = 68      Sorrento   187 / 4n = 47
//   Barcelona 219 / 3n = 73      London ret. 47 / 2n = 24
//
// Median 47 a night across 26 nights for 1301. Rome and Barcelona only read as
// hotels as lump sums; both are three nights at ordinary hostel prices, and
// Interlaken's 75 is the highest because Interlaken is the most expensive stop
// on the route. Nothing on this trip is a hotel.
//
// The first London row (83) has no following gap to derive from, since it was
// paid the same day as the Paris payment. It takes hostel with the rest.
const EUROPE_LODGING = "hostel";

// --- Classification ---------------------------------------------------------

interface Decision {
  category: string | null;
  why: string;
  note: string | null;
}

function classify(row: SourceRow): Decision {
  const vendor = row.vendor.trim().toLowerCase();

  for (const rule of RULES) {
    if (rule.section !== undefined && rule.section !== row.section) continue;
    if (rule.subsection !== undefined && rule.subsection !== row.subsection) {
      continue;
    }
    if (rule.trip !== undefined && rule.trip !== row.trip) continue;
    if (!rule.vendors.some((name) => name.trim().toLowerCase() === vendor)) {
      continue;
    }
    return {
      category: rule.category,
      why: rule.why,
      note: rule.note ?? null,
    };
  }

  if (row.section === "Flight/travel" && row.subsection === "Lodging") {
    if (/hostel/i.test(row.vendor)) {
      return { category: "hostel", why: "the sheet says hostel", note: null };
    }
    return {
      category: EUROPE_LODGING,
      why: "multi-night total at hostel rates, see the derivation above",
      note: null,
    };
  }

  // Everything else takes the sheet's own most specific meaning.
  const intent = sheetIntent(row);
  return {
    category: intent.category,
    why: "the sheet's own section",
    note: null,
  };
}

function reviewOf(row: SourceRow, decision: Decision): FixtureReview {
  // A row with no category is the only thing left that needs a human.
  if (decision.category === null) return "assumption";
  const intent = sheetIntent(row);
  const group = CATEGORY_GROUP[decision.category];
  if (group !== intent.group) return "crossover";
  if (decision.category !== intent.category) return "refined";
  return "agrees";
}

// --- Deterministic ids ------------------------------------------------------
//
// uuid v5 (sha1, name-based) over a stable key, so re-running the import
// updates the same rows instead of duplicating them. Implemented here rather
// than pulling in a uuid dependency for one function.
//
// The key includes an occurrence index, because two genuinely identical
// transactions are possible (two 7.00 Tesco runs) and must both survive.

const NAMESPACE = "6f5a1d3e-2b47-4f8c-9a1e-7c0d5b3e9a24";

function uuidV5(name: string): string {
  const namespaceBytes = Buffer.from(NAMESPACE.replace(/-/g, ""), "hex");
  const hash = createHash("sha1")
    .update(namespaceBytes)
    .update(Buffer.from(name, "utf8"))
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

// --- CSV --------------------------------------------------------------------

function parseCsv(text: string): SourceRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const header = lines[0].split(",").map((cell) => cell.trim());
  const expected = [
    "trip",
    "tab",
    "section",
    "subsection",
    "vendor",
    "amount_usd",
    "spent_on",
  ];
  if (header.join(",") !== expected.join(",")) {
    throw new Error(
      `Unexpected CSV header.\n  expected: ${expected.join(",")}\n  got:      ${header.join(",")}`,
    );
  }

  const rows: SourceRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i].split(",");
    if (cells.length !== 7) {
      throw new Error(
        `Line ${i + 1} has ${cells.length} fields, expected 7. A vendor name ` +
          `containing a comma would need real CSV quoting: ${lines[i]}`,
      );
    }
    const [trip, tab, section, subsection, vendor, amount, spentOn] = cells.map(
      (cell) => cell.trim(),
    );
    const amountUsd = Number(amount);
    if (!Number.isFinite(amountUsd)) {
      throw new Error(`Line ${i + 1}: amount "${amount}" is not a number.`);
    }
    if (amountUsd === 0) {
      throw new Error(`Line ${i + 1}: amount is zero, which is not a spend.`);
    }
    if (spentOn !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(spentOn)) {
      throw new Error(`Line ${i + 1}: "${spentOn}" is not a YYYY-MM-DD date.`);
    }
    rows.push({
      trip,
      tab,
      section,
      subsection,
      vendor,
      amountUsd: Math.round(amountUsd * 100) / 100,
      spentOn: spentOn === "" ? null : spentOn,
      line: i + 1,
    });
  }
  return rows;
}

// --- Build ------------------------------------------------------------------

function money(value: number): string {
  return value.toFixed(2);
}

function build(rows: SourceRow[]): FixtureExpense[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const decision = classify(row);
    const baseKey = [
      row.trip,
      row.tab,
      row.section,
      row.subsection,
      row.vendor,
      money(row.amountUsd),
      row.spentOn ?? "undated",
    ].join("|");
    const occurrence = (seen.get(baseKey) ?? 0) + 1;
    seen.set(baseKey, occurrence);

    return {
      id: uuidV5(`${baseKey}|${occurrence}`),
      tripName: row.trip,
      vendor: row.vendor,
      amountUsd: row.amountUsd,
      spentOn: row.spentOn,
      categorySlug: decision.category,
      // Exactly the sheet's Alc column, no more and no less. Asserted below.
      isAlcohol: row.section === "Alc",
      note: decision.note,
      sourceSection: row.section,
      sourceSubsection: row.subsection,
      sourceLine: row.line,
      review: reviewOf(row, decision),
      why: decision.why,
    };
  });
}

// --- Assertions -------------------------------------------------------------

const EXPECTED_TOTALS: Record<string, number> = {
  "Post Grad Trip": 4492,
  "Pre Job Trip": 2957,
};
const EXPECTED_ALCOHOL: Record<string, number> = {
  "Post Grad Trip": 878,
  "Pre Job Trip": 420,
};
const EXPECTED_ROWS = 226;

function sum(values: number[]): number {
  // Cents, so a fixture is never rejected over floating point dust.
  return Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;
}

function assertFixture(source: SourceRow[], fixture: FixtureExpense[]): void {
  const problems: string[] = [];

  if (fixture.length !== EXPECTED_ROWS) {
    problems.push(`row count is ${fixture.length}, expected ${EXPECTED_ROWS}`);
  }
  if (fixture.length !== source.length) {
    problems.push(
      `fixture has ${fixture.length} rows for ${source.length} source rows`,
    );
  }

  const ids = new Set(fixture.map((row) => row.id));
  if (ids.size !== fixture.length) {
    problems.push(
      `${fixture.length - ids.size} duplicate id(s): the occurrence key is not unique`,
    );
  }

  for (const [trip, expected] of Object.entries(EXPECTED_TOTALS)) {
    const actual = sum(
      fixture.filter((r) => r.tripName === trip).map((r) => r.amountUsd),
    );
    if (actual !== expected) {
      problems.push(`${trip} total is ${money(actual)}, expected ${money(expected)}`);
    }
  }

  for (const [trip, expected] of Object.entries(EXPECTED_ALCOHOL)) {
    const actual = sum(
      fixture
        .filter((r) => r.tripName === trip && r.isAlcohol)
        .map((r) => r.amountUsd),
    );
    if (actual !== expected) {
      problems.push(
        `${trip} alcohol total is ${money(actual)}, expected ${money(expected)}`,
      );
    }
  }

  // The alcohol flag must be exactly the Alc section, in both directions.
  const flaggedNotAlc = fixture.filter(
    (r) => r.isAlcohol && r.sourceSection !== "Alc",
  );
  const alcNotFlagged = fixture.filter(
    (r) => !r.isAlcohol && r.sourceSection === "Alc",
  );
  if (flaggedNotAlc.length > 0 || alcNotFlagged.length > 0) {
    problems.push(
      `is_alcohol is not exactly the Alc section (${flaggedNotAlc.length} extra, ${alcNotFlagged.length} missing)`,
    );
  }

  for (const row of fixture) {
    if (row.categorySlug !== null && !(row.categorySlug in CATEGORY_GROUP)) {
      problems.push(
        `line ${row.sourceLine}: "${row.categorySlug}" is not a seeded category`,
      );
    }
  }

  if (problems.length > 0) {
    console.error("\nFixture REJECTED. Nothing was written.\n");
    for (const problem of problems) console.error(`  x ${problem}`);
    console.error("");
    process.exit(1);
  }
}

// --- Report -----------------------------------------------------------------

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : " ".repeat(width - value.length) + value;
}

function report(fixture: FixtureExpense[]): void {
  const line = (row: FixtureExpense): string =>
    `  ${pad(row.tripName === "Post Grad Trip" ? "Europe" : "Scand.", 7)}` +
    `${pad(`${row.sourceSection}${row.sourceSubsection ? " / " + row.sourceSubsection : ""}`, 34)}` +
    `${pad(row.vendor, 26)}` +
    `${padLeft(money(row.amountUsd), 9)}  ` +
    `${pad(row.spentOn ?? "undated", 11)}` +
    `-> ${pad(row.categorySlug ?? "UNCATEGORIZED", 26)}${row.why}`;

  const byReview = (kind: FixtureReview) =>
    fixture.filter((row) => row.review === kind);

  const assumptions = byReview("assumption");
  const crossovers = byReview("crossover");
  const refined = byReview("refined");
  const agrees = byReview("agrees");

  console.log("\n=== READ FIRST: rows with no category, needing a human ===\n");
  if (assumptions.length === 0) {
    console.log("  none: every row has a decided category");
  }
  for (const row of assumptions) console.log(line(row));

  console.log(
    "\n=== CROSSOVERS: the sheet's column pointed at a different group ===\n",
  );
  for (const row of crossovers) console.log(line(row));
  console.log(
    `\n  ${crossovers.length} rows, ${money(sum(crossovers.map((r) => r.amountUsd)))} total`,
  );

  console.log(
    "\n=== REFINED: same group as the sheet, finer category inside it ===\n",
  );
  for (const row of refined) console.log(line(row));
  console.log(
    `\n  ${refined.length} rows, ${money(sum(refined.map((r) => r.amountUsd)))} total`,
  );

  console.log(`\n=== AGREES WITH THE SHEET: ${agrees.length} rows (not listed) ===`);

  // Notes are rare and each one is a deliberate act.
  const noted = fixture.filter((row) => row.note !== null);
  if (noted.length > 0) {
    console.log("\n=== NOTES WRITTEN ONTO ROWS ===\n");
    for (const row of noted) {
      console.log(`  ${row.vendor} ${money(row.amountUsd)} (${row.spentOn ?? "undated"})`);
      console.log(`    ${row.note}`);
    }
  }

  // What the sheet said versus what the fixture says, side by side.
  console.log("\n=== SECTION TOTALS THEN, GROUP TOTALS NOW ===\n");
  for (const trip of Object.keys(EXPECTED_TOTALS)) {
    const rows = fixture.filter((row) => row.tripName === trip);
    console.log(`  ${trip}`);
    const sections = new Map<string, number>();
    for (const row of rows) {
      sections.set(
        row.sourceSection,
        (sections.get(row.sourceSection) ?? 0) + row.amountUsd,
      );
    }
    const groups = new Map<string, number>();
    for (const row of rows) {
      const group = row.categorySlug ? CATEGORY_GROUP[row.categorySlug] : "UNCATEGORIZED";
      groups.set(group, (groups.get(group) ?? 0) + row.amountUsd);
    }
    console.log("    sheet sections:");
    for (const [name, value] of [...sections].sort()) {
      console.log(`      ${pad(name, 22)}${padLeft(money(value), 10)}`);
    }
    console.log("    fixture groups:");
    for (const [name, value] of [...groups].sort()) {
      console.log(`      ${pad(name, 22)}${padLeft(money(value), 10)}`);
    }
    const alcohol = sum(rows.filter((r) => r.isAlcohol).map((r) => r.amountUsd));
    console.log(
      `    of which alcohol (a cross-cut, not a group): ${money(alcohol)}`,
    );
    console.log(
      `    total: ${money(sum(rows.map((r) => r.amountUsd)))}\n`,
    );
  }
}

// --- Emit -------------------------------------------------------------------

function emit(fixture: FixtureExpense[]): string {
  const rows = fixture
    .map((row) => {
      const fields = [
        `    id: ${JSON.stringify(row.id)},`,
        `    tripName: ${JSON.stringify(row.tripName)},`,
        `    vendor: ${JSON.stringify(row.vendor)},`,
        `    amountUsd: ${row.amountUsd},`,
        `    spentOn: ${JSON.stringify(row.spentOn)},`,
        `    categorySlug: ${JSON.stringify(row.categorySlug)},`,
        `    isAlcohol: ${row.isAlcohol},`,
        `    note: ${JSON.stringify(row.note)},`,
        `    sourceSection: ${JSON.stringify(row.sourceSection)},`,
        `    sourceSubsection: ${JSON.stringify(row.sourceSubsection)},`,
        `    sourceLine: ${row.sourceLine},`,
        `    review: ${JSON.stringify(row.review)},`,
        `    why: ${JSON.stringify(row.why)},`,
      ].join("\n");
      return `  {\n${fields}\n  },`;
    })
    .join("\n");

  return `// GENERATED by scripts/build-expense-fixture.ts from expenses_source.csv.
// Do not hand-edit the arithmetic. To change a CATEGORY, change the decision
// list in the generator and re-run it, so the reasoning stays with the rule
// rather than being lost in a diff.
//
// Reviewed before import: every row whose \`review\` is "assumption" or
// "crossover" is a decision a person signed off on. See the generator's report.
//
//   npm run build-expense-fixture -- --report
//
// ${fixture.length} rows. Totals are asserted by the generator, not by hand.

export interface FixtureExpense {
  id: string;
  tripName: string;
  vendor: string;
  amountUsd: number;
  spentOn: string | null;
  categorySlug: string | null;
  isAlcohol: boolean;
  note: string | null;
  sourceSection: string;
  sourceSubsection: string;
  sourceLine: number;
  review: "agrees" | "refined" | "crossover" | "assumption";
  why: string;
}

export const EXPENSE_FIXTURE: FixtureExpense[] = [
${rows}
];
`;
}

// --- Main -------------------------------------------------------------------

function main(): void {
  const reportOnly = process.argv.includes("--report");
  // Run from the repo root through npm, matching the other scripts.
  const root = process.cwd();
  const source = parseCsv(
    readFileSync(join(root, "expenses_source.csv"), "utf8"),
  );
  const fixture = build(source);

  assertFixture(source, fixture);
  report(fixture);

  if (reportOnly) {
    console.log("Report only, nothing written.\n");
    return;
  }

  const target = join(root, "scripts", "expense-fixture.ts");
  writeFileSync(target, emit(fixture), "utf8");
  console.log(`Wrote ${fixture.length} rows to scripts/expense-fixture.ts\n`);
}

main();

// Does the expense CSV round-trip?
//
// The escape hatch this feature offers is "you can get your ledger back out as
// a spreadsheet". That promise is only real if what comes out can go back in
// unchanged, so this asserts export -> parse -> identical, over the shapes
// that actually break naive CSV code.
//
// Pure: no database, no dev server. Run with: npm run check-expense-csv

import {
  buildExpenseCsv,
  parseExpenseCsv,
  CSV_COLUMNS,
  type ExpenseCsvRow,
} from "../src/lib/expenses-csv";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(detail ? `${name}\n    ${detail}` : name);
}

function equal<T>(name: string, actual: T, expected: T): void {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  check(
    name,
    same,
    same
      ? undefined
      : `expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`,
  );
}

const row = (over: Partial<ExpenseCsvRow>): ExpenseCsvRow => ({
  id: "11111111-2222-3333-4444-555555555555",
  tripName: "Post Grad Trip",
  spentOn: "2025-05-13",
  vendor: "The Round House",
  amountUsd: 19,
  categorySlug: "bars-and-nightlife",
  isAlcohol: true,
  note: "",
  ...over,
});

// --- The shapes that break naive CSV code -----------------------------------

const CASES: [string, ExpenseCsvRow][] = [
  ["an ordinary row", row({})],
  [
    "a REFUND, which must survive as a negative rather than an absolute",
    row({ vendor: "London round-trip", amountUsd: -700, categorySlug: "flights", isAlcohol: false }),
  ],
  [
    "an UNDATED prepaid row",
    row({ vendor: "EUrail Pass", spentOn: "", amountUsd: 382, categorySlug: "rail", isAlcohol: false }),
  ],
  [
    "an UNCATEGORIZED row, which is a first-class state",
    row({ categorySlug: "", isAlcohol: false }),
  ],
  [
    "a vendor containing a COMMA",
    row({ vendor: "Bar Anchor, Oslo" }),
  ],
  [
    "a vendor containing a DOUBLE QUOTE",
    row({ vendor: 'The "Old" Tavern' }),
  ],
  [
    "a note containing a comma, a quote AND a newline",
    row({ note: 'Split with Ana, who said "next one is mine"\nand then paid' }),
  ],
  [
    "a row with no vendor at all",
    row({ vendor: "" }),
  ],
  [
    "cents, which must not be rounded away",
    row({ amountUsd: 12.34 }),
  ],
  [
    "a trip name containing a comma",
    row({ tripName: "Berlin, then Prague" }),
  ],
  [
    "a hand-written row with no id",
    row({ id: "" }),
  ],
];

for (const [label, original] of CASES) {
  const csv = buildExpenseCsv([original]);
  const result = parseExpenseCsv(csv);
  check(`${label}: parses without error`, result.errors.length === 0, result.errors.join("; "));
  equal(`${label}: round-trips identically`, result.rows[0], original);
}

// --- The whole set at once, which is how it is actually used ----------------

{
  const all = CASES.map(([, r]) => r);
  const result = parseExpenseCsv(buildExpenseCsv(all));
  check("the full set parses without error", result.errors.length === 0, result.errors.join("; "));
  equal("the full set round-trips identically", result.rows, all);
}

// --- Re-exporting an unchanged ledger is byte-identical ---------------------
//
// Not cosmetic: it means a diff of two exports shows only what actually
// changed, which is most of the value of having the file at all.

{
  const all = CASES.map(([, r]) => r);
  const once = buildExpenseCsv(all);
  const twice = buildExpenseCsv(parseExpenseCsv(once).rows);
  equal("export is stable across a round trip", twice, once);
}

// --- The format guards itself ------------------------------------------------

{
  const header = buildExpenseCsv([]).trim();
  equal("an empty ledger still emits the header", header, CSV_COLUMNS.join(","));

  const wrongHeader = parseExpenseCsv("trip,amount\nx,1\n");
  check(
    "a file with the wrong header is refused, not guessed at",
    wrongHeader.errors.length === 1 && wrongHeader.rows.length === 0,
    JSON.stringify(wrongHeader),
  );

  const zero = parseExpenseCsv(
    `${CSV_COLUMNS.join(",")}\n,Trip,2025-01-01,V,0.00,,false,\n`,
  );
  check(
    "a zero amount is refused (zero is not a transaction)",
    zero.rows.length === 0 && zero.errors.length === 1,
    JSON.stringify(zero),
  );

  const badDate = parseExpenseCsv(
    `${CSV_COLUMNS.join(",")}\n,Trip,13/05/2025,V,10.00,,false,\n`,
  );
  check(
    "a non-ISO date is refused rather than reinterpreted",
    badDate.rows.length === 0 && badDate.errors.length === 1,
    JSON.stringify(badDate),
  );

  // Every error carries a line number, or a 200-row file is unfixable.
  const multi = parseExpenseCsv(
    `${CSV_COLUMNS.join(",")}\n,Trip,2025-01-01,A,0,,false,\n,Trip,nope,B,5,,false,\n`,
  );
  check(
    "every bad row is reported, each with its line number",
    multi.errors.length === 2 && multi.errors.every((e) => /^Line \d+:/.test(e)),
    JSON.stringify(multi.errors),
  );
}

// --- Report -----------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\nExpense CSV: ${failures.length} check(s) failed.\n`);
  for (const failure of failures) console.error(`  x ${failure}`);
  console.error("");
  process.exit(1);
}
console.log(`Expense CSV: ${passed} checks passed.`);

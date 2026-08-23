// The expense CSV format, defined ONCE for both directions.
//
// This module is the whole reason the CSV escape hatch is real rather than
// decorative: the exporter and the importer read the same column list, the
// same quoting rules, and the same field parsing out of this file. A writer
// and a reader that merely agree by convention drift the first time somebody
// adds a column, and then the export is a file you can open and not a file you
// can put back.
//
// Pure and dependency-free, so the API route, the import script, and the
// round-trip check all run the identical code.
//
// THE ID COLUMN IS WHAT MAKES THE ROUND TRIP EXACT. An exported row carries
// its own id, so re-importing updates that row rather than creating a copy;
// two identical 4.50 coffees on the same day stay two rows, which no
// content-based duplicate check could manage. A row typed in by hand leaves
// the id blank and the importer mints a deterministic one from the content, so
// a spreadsheet edit that adds lines still imports cleanly.

export const CSV_COLUMNS = [
  "id",
  "trip",
  "spent_on",
  "vendor",
  "amount_usd",
  "category_slug",
  "is_alcohol",
  "note",
] as const;

export interface ExpenseCsvRow {
  /** Empty for a hand-written row; the importer assigns one. */
  id: string;
  tripName: string;
  /** YYYY-MM-DD, or empty for an undated (prepaid) row. */
  spentOn: string;
  vendor: string;
  /** Signed. Negative is a refund, and survives the round trip as one. */
  amountUsd: number;
  /** Slug from batchport.expense_categories, or empty for uncategorized. */
  categorySlug: string;
  isAlcohol: boolean;
  note: string;
}

// --- Writing ----------------------------------------------------------------

/** RFC 4180: quote when the value contains a comma, a quote, or a newline,
 * and double any embedded quotes. A vendor called `Bar "The Anchor", Oslo` has
 * to survive, and a note can contain anything at all. */
function escape(value: string): string {
  if (value === "") return "";
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function cell(row: ExpenseCsvRow, column: (typeof CSV_COLUMNS)[number]): string {
  switch (column) {
    case "id":
      return escape(row.id);
    case "trip":
      return escape(row.tripName);
    case "spent_on":
      return escape(row.spentOn);
    case "vendor":
      return escape(row.vendor);
    case "amount_usd":
      // Two decimals always, matching numeric(12,2). A bare "12" and a "12.00"
      // both parse back to the same number, but a stable spelling means a
      // re-export of an unchanged ledger is byte-identical.
      return row.amountUsd.toFixed(2);
    case "category_slug":
      return escape(row.categorySlug);
    case "is_alcohol":
      return row.isAlcohol ? "true" : "false";
    case "note":
      return escape(row.note);
  }
}

export function buildExpenseCsv(rows: ExpenseCsvRow[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((column) => cell(row, column)).join(","));
  }
  // Trailing newline: POSIX text files end with one, and it keeps a diff of
  // two exports from showing a spurious last-line change.
  return `${lines.join("\n")}\n`;
}

// --- Reading ----------------------------------------------------------------

/** A real CSV tokenizer rather than split(","), because vendors and notes are
 * free text and the writer above will quote them. Handles quoted fields,
 * escaped quotes, and newlines inside quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    // A trailing newline produces one empty trailing row; drop it.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (char === "\r") {
      i += 1;
      continue;
    }
    if (char === "\n") {
      pushRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  if (field !== "" || row.length > 0) pushRow();
  return rows;
}

export interface CsvParseResult {
  rows: ExpenseCsvRow[];
  errors: string[];
}

/**
 * Read a CSV back into rows, applying the same rules the fixture import used:
 * a signed amount, an optional date, an optional category slug, and a boolean
 * alcohol flag. Refuses rows it cannot read rather than guessing, and reports
 * every problem with its line number instead of stopping at the first.
 */
export function parseExpenseCsv(text: string): CsvParseResult {
  const table = parseCsv(text);
  const errors: string[] = [];
  if (table.length === 0) {
    return { rows: [], errors: ["The file is empty."] };
  }

  const header = table[0].map((h) => h.trim());
  const expected = CSV_COLUMNS.join(",");
  if (header.join(",") !== expected) {
    return {
      rows: [],
      errors: [
        `Unexpected header.\n  expected: ${expected}\n  got:      ${header.join(",")}`,
      ],
    };
  }

  const rows: ExpenseCsvRow[] = [];
  for (let i = 1; i < table.length; i += 1) {
    const line = i + 1;
    const cells = table[i];
    if (cells.length !== CSV_COLUMNS.length) {
      errors.push(`Line ${line}: ${cells.length} fields, expected ${CSV_COLUMNS.length}.`);
      continue;
    }
    const [id, tripName, spentOn, vendor, amount, categorySlug, alcohol, note] =
      cells;

    if (tripName.trim() === "") {
      errors.push(`Line ${line}: trip is required.`);
      continue;
    }
    const amountUsd = Number(amount.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(amountUsd) || amountUsd === 0) {
      errors.push(
        `Line ${line}: amount "${amount}" is not a usable number (zero is not a transaction).`,
      );
      continue;
    }
    if (spentOn.trim() !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(spentOn.trim())) {
      errors.push(`Line ${line}: "${spentOn}" is not a YYYY-MM-DD date.`);
      continue;
    }
    const flag = alcohol.trim().toLowerCase();
    if (flag !== "" && flag !== "true" && flag !== "false") {
      errors.push(`Line ${line}: is_alcohol must be true or false, got "${alcohol}".`);
      continue;
    }

    rows.push({
      id: id.trim(),
      tripName: tripName.trim(),
      spentOn: spentOn.trim(),
      vendor: vendor.trim(),
      amountUsd: Math.round(amountUsd * 100) / 100,
      categorySlug: categorySlug.trim(),
      isAlcohol: flag === "true",
      note,
    });
  }
  return { rows, errors };
}

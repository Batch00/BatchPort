// Shared plumbing for the places seed and load scripts.
//
// These are reference-data scripts, not application code. They talk to
// Supabase directly with the service-role key and do NOT need the dev server.
//
// Prerequisites:
//   - .env.local holds NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
//   - The four scripts/sql/2026-08-31-places-*.sql migrations have been run.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

// Parse .env.local by hand so the script stays free of extra dependencies.
export function loadEnvLocal(): Record<string, string> {
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

export type PlacesClient = ReturnType<typeof makeClient>;

export function adminClient(): PlacesClient {
  const env = { ...loadEnvLocal(), ...process.env };
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
  }
  return makeClient(url, key);
}

export function anonClient(): PlacesClient {
  const env = { ...loadEnvLocal(), ...process.env };
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }
  return makeClient(url, key);
}

export const DATA_DIR = join(process.cwd(), "scripts", "data");

// RFC 4180 enough for the prepared files: quoted fields, doubled quotes inside
// them, and commas and newlines within quotes. Returns rows of raw strings; a
// trailing newline does not produce an empty row.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

// Read a CSV whose first line is a header into objects keyed by column name.
// Throws if the header is not exactly what the caller expects, rather than
// guessing at a reordered or renamed column.
export function readCsvObjects(
  path: string,
  expectedHeader: readonly string[],
): Record<string, string>[] {
  const rows = parseCsv(readFileSync(path, "utf8"));
  if (!rows.length) throw new Error(`${path}: empty`);
  const header = rows[0];
  if (header.join(",") !== expectedHeader.join(",")) {
    throw new Error(
      `${path}: unexpected header\n  got:      ${header.join(",")}\n  expected: ${expectedHeader.join(",")}`,
    );
  }
  return rows.slice(1).map((r, i) => {
    if (r.length !== header.length) {
      throw new Error(`${path}: line ${i + 2} has ${r.length} fields, expected ${header.length}`);
    }
    return Object.fromEntries(header.map((h, j) => [h, r[j]]));
  });
}

// The app writes geography points as EWKT and never as latitude/longitude
// columns; see the generated-column rule in CLAUDE.md.
export function ewktPoint(lng: number, lat: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}

export async function chunked<T>(
  rows: T[],
  size: number,
  fn: (chunk: T[]) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await fn(rows.slice(i, i + size));
  }
}

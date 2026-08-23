// Print v_destination_expense for one trip, straight out of the view.
//
// This exists to be read before any UI is built on top of the view. The Post
// Grad Trip is the hardest case the boundary rule will ever see in this
// project: eleven stops, two of them London, and a transfer day between almost
// every pair, so a rule that quietly double-counts shared days shows up here as
// per-stop days summing to more than the trip's length.
//
// It reads the view and does no arithmetic of its own beyond totalling the
// columns, so what is printed is what the database says. The one derived line
// is the reconciliation at the bottom, which is the check worth doing by eye.
//
// Prerequisites: scripts/sql/2026-08-22-expense-metrics.sql applied, and
// .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
//
// Run with:
//   npm run read-destination-expense                     Post Grad Trip
//   npm run read-destination-expense -- "Pre Job Trip"

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

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
    // No .env.local: fall back to process.env.
  }
  return env;
}

const n = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const money = (value: unknown): string => n(value).toFixed(2);
const pad = (value: string, width: number): string =>
  value.length >= width ? value : value + " ".repeat(width - value.length);
const padLeft = (value: string, width: number): string =>
  value.length >= width ? value : " ".repeat(width - value.length) + value;

interface Row {
  destination_id: string;
  destination_name: string;
  country_code: string | null;
  order_index: number;
  arrival_date: string | null;
  departure_date: string | null;
  days_owned: number | string;
  total_usd: number | string;
  on_ground_usd: number | string;
  txn_count: number | string;
  usd_per_day: number | string | null;
  on_ground_usd_per_day: number | string | null;
}

async function main(): Promise<void> {
  const tripName = process.argv[2] ?? "Post Grad Trip";
  const env = { ...loadEnvLocal(), ...process.env } as Record<string, string>;
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("\nMissing Supabase env in .env.local.\n");
    process.exit(1);
  }

  const db = createClient(url, key, {
    db: { schema: "batchport" },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: trip, error: tripError } = await db
    .from("trips")
    .select("id, name")
    .eq("name", tripName)
    .maybeSingle();
  if (tripError || !trip) {
    console.error(`\nNo trip named "${tripName}".\n`);
    process.exit(1);
  }
  const tripId = (trip as { id: string }).id;

  const { data, error } = await db
    .from("v_destination_expense")
    .select(
      "destination_id, destination_name, country_code, order_index, arrival_date, departure_date, days_owned, total_usd, on_ground_usd, txn_count, usd_per_day, on_ground_usd_per_day",
    )
    .eq("trip_id", tripId)
    .order("order_index", { ascending: true });
  if (error) {
    console.error(
      `\nCould not read v_destination_expense: ${error.message}\n` +
        "Has scripts/sql/2026-08-22-expense-metrics.sql been applied?\n",
    );
    process.exit(1);
  }
  const rows = (data ?? []) as unknown as Row[];

  const { data: summary } = await db
    .from("v_trip_expense_summary")
    .select("trip_days, total_usd, txn_count, usd_per_day, unattributed_usd, undated_usd")
    .eq("trip_id", tripId)
    .maybeSingle();

  console.log(`\n${tripName}, straight out of v_destination_expense\n`);
  console.log(
    `  ${pad("#", 3)}${pad("stop", 13)}${pad("stay", 24)}` +
      `${padLeft("days", 5)}${padLeft("txns", 6)}` +
      `${padLeft("total", 10)}${padLeft("/day", 9)}` +
      `${padLeft("onground", 10)}${padLeft("/day", 9)}`,
  );
  console.log(`  ${"-".repeat(86)}`);

  for (const row of rows) {
    const stay = `${row.arrival_date ?? "?"} to ${row.departure_date ?? "?"}`;
    console.log(
      `  ${pad(String(row.order_index), 3)}` +
        `${pad(row.destination_name, 13)}` +
        `${pad(stay, 24)}` +
        `${padLeft(String(n(row.days_owned)), 5)}` +
        `${padLeft(String(n(row.txn_count)), 6)}` +
        `${padLeft(money(row.total_usd), 10)}` +
        `${padLeft(row.usd_per_day === null ? "-" : money(row.usd_per_day), 9)}` +
        `${padLeft(money(row.on_ground_usd), 10)}` +
        `${padLeft(
          row.on_ground_usd_per_day === null ? "-" : money(row.on_ground_usd_per_day),
          9,
        )}`,
    );
  }

  const sumDays = rows.reduce((a, r) => a + n(r.days_owned), 0);
  const sumTotal = rows.reduce((a, r) => a + n(r.total_usd), 0);
  const sumGround = rows.reduce((a, r) => a + n(r.on_ground_usd), 0);
  const sumTxns = rows.reduce((a, r) => a + n(r.txn_count), 0);

  console.log(`  ${"-".repeat(86)}`);
  console.log(
    `  ${pad("", 3)}${pad(`${rows.length} stops`, 13)}${pad("", 24)}` +
      `${padLeft(String(sumDays), 5)}${padLeft(String(sumTxns), 6)}` +
      `${padLeft(money(sumTotal), 10)}${padLeft("", 9)}` +
      `${padLeft(money(sumGround), 10)}`,
  );

  // The reconciliation. Per-stop days summing to the trip's own length is the
  // whole claim the boundary rule makes; containment would exceed it by one
  // per transfer day.
  const tripDays = n(summary?.trip_days);
  const tripTotal = n(summary?.total_usd);
  const unattributed = n(summary?.unattributed_usd);
  console.log("\n  reconciliation");
  console.log(
    `    days:  ${sumDays} owned across stops vs ${tripDays} in the trip` +
      `   ${sumDays === tripDays ? "MATCH" : "MISMATCH"}`,
  );
  console.log(
    `    money: ${money(sumTotal)} on stops + ${money(unattributed)} unattributed` +
      ` = ${money(sumTotal + unattributed)} vs ${money(tripTotal)} trip total` +
      `   ${Math.round((sumTotal + unattributed) * 100) === Math.round(tripTotal * 100) ? "MATCH" : "MISMATCH"}`,
  );
  console.log(
    `    txns:  ${sumTxns} on stops vs ${n(summary?.txn_count)} in the trip\n`,
  );

  // Two stops sharing a name is the case the whole model exists for, so say so
  // explicitly rather than leaving it to be noticed in the table.
  const byName = new Map<string, Row[]>();
  for (const row of rows) {
    byName.set(row.destination_name, [
      ...(byName.get(row.destination_name) ?? []),
      row,
    ]);
  }
  const repeats = [...byName.entries()].filter(([, list]) => list.length > 1);
  if (repeats.length > 0) {
    console.log("  revisits, kept apart as separate stays");
    for (const [name, list] of repeats) {
      for (const row of list) {
        console.log(
          `    ${pad(name, 12)} stop ${row.order_index}  ` +
            `${row.arrival_date} to ${row.departure_date}  ` +
            `${padLeft(String(n(row.days_owned)), 2)} days  ` +
            `${padLeft(money(row.total_usd), 8)}`,
        );
      }
    }
    console.log("");
  }
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

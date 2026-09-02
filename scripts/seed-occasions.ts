// Seed batchport.occasions: why you were somewhere.
//
// Reference data, not application code. Talks to Supabase with the
// service-role key and does NOT need the dev server.
//
// Run with: npm run seed-occasions
//
// Idempotent: upserts on the slug unique key, so re-running updates labels,
// icons, colors, and ordering in place and never duplicates a row.
//
// The list is FIXED and lives here rather than in a CSV, because unlike the
// venue catalogs it was not pulled from anywhere: it is a product decision
// about the buckets a visit falls into. Adding one is an edit to this file
// and a re-run.
//
// Colors are the existing dark palette, the Tailwind 400 family that
// batchport.expense_groups already seeds (#60a5fa, #a78bfa, #fbbf24, #34d399,
// #94a3b8). Nothing here is a light-theme value. Icons are lucide-react names
// as exported by the installed version, so "TreePalm" rather than the
// deprecated "Palmtree" alias.
//
// sort_order is the order a picker should offer them, which is roughly by how
// often a visit is one of them, with "other" pinned last.

import { adminClient } from "./places-db";

interface OccasionSeed {
  slug: string;
  label: string;
  icon: string;
  color: string;
  sort_order: number;
}

const OCCASIONS: OccasionSeed[] = [
  { slug: "game", label: "Game", icon: "Ticket", color: "#34d399", sort_order: 1 },
  { slug: "concert", label: "Concert", icon: "Music", color: "#a78bfa", sort_order: 2 },
  { slug: "vacation", label: "Vacation", icon: "TreePalm", color: "#2dd4bf", sort_order: 3 },
  { slug: "weekend", label: "Weekend", icon: "CalendarDays", color: "#38bdf8", sort_order: 4 },
  { slug: "road-trip", label: "Road trip", icon: "Car", color: "#60a5fa", sort_order: 5 },
  { slug: "wedding", label: "Wedding", icon: "Heart", color: "#f472b6", sort_order: 6 },
  { slug: "family", label: "Family", icon: "Users", color: "#fbbf24", sort_order: 7 },
  { slug: "work", label: "Work", icon: "Briefcase", color: "#94a3b8", sort_order: 8 },
  { slug: "tournament", label: "Tournament", icon: "Trophy", color: "#fb923c", sort_order: 9 },
  { slug: "bachelor-party", label: "Bachelor party", icon: "PartyPopper", color: "#c084fc", sort_order: 10 },
  { slug: "other", label: "Other", icon: "MapPin", color: "#64748b", sort_order: 99 },
];

async function main(): Promise<void> {
  const supabase = adminClient();

  const { error } = await supabase
    .from("occasions")
    .upsert(OCCASIONS, { onConflict: "slug" });
  if (error) {
    throw new Error(`occasions upsert failed: ${error.message}`);
  }

  const { data, error: readError } = await supabase
    .from("occasions")
    .select("slug, label, icon, color, sort_order")
    .order("sort_order", { ascending: true });
  if (readError) throw new Error(`occasions read back failed: ${readError.message}`);

  console.log(`occasions: ${data?.length ?? 0} rows`);
  for (const row of data ?? []) {
    console.log(
      `  ${String(row.sort_order).padStart(2)}  ${row.slug.padEnd(16)} ${String(row.label).padEnd(16)} ${row.icon}  ${row.color}`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

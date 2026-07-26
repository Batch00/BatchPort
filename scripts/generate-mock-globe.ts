// Regenerate src/lib/mock-travel-data.ts, the landing hero's static fallback.
//
// The hero renders the live demo account through the anon read path. When that
// read is unavailable (an unseeded demo account on a fresh deploy, a Supabase
// outage, missing env), it falls back to the module this script writes: the
// same world, baked in at build time, so the hero is never an empty globe.
//
// The data is derived from scripts/demo-dataset.ts, the fixture the seeder
// writes, so the fallback cannot drift from what /demo actually contains.
// Planned trips are excluded, matching what the hero shows.
//
// Category colours are read from batchport.categories so the pin tints match
// the live globe exactly. That is the only reason this script touches the
// database; it needs no dev server.
//
// Prerequisites:
//   - .env.local holds NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
//
// Run with: npm run generate-mock-globe
// Re-run it whenever the demo fixture changes.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { TRIPS, type SeedDestination, type SeedTrip } from "./demo-dataset";

const OUTPUT_PATH = join("src", "lib", "mock-travel-data.ts");

// Parse .env.local by hand so the script stays free of extra dependencies.
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
    // No .env.local: fall back to whatever is already in process.env.
  }
  return env;
}

// The pin colour: the category of the highest-rated done experience that has
// one. Mirrors primaryCategory() in src/lib/map-data.ts, so a destination gets
// the same tint whether it came from the fallback or the live read.
function primaryCategorySlug(dest: SeedDestination): string | null {
  const rated = dest.experiences
    .filter((exp) => (exp.status ?? "done") === "done")
    .slice()
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  return rated[0]?.slug ?? null;
}

// Stable, readable ids. The live read uses database UUIDs; the fallback uses
// slugs, which also makes it obvious at a glance which one a page is showing.
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface MockDestination {
  id: string;
  tripId: string;
  tripName: string;
  name: string;
  countryCode: string;
  lat: number;
  lng: number;
  categoryColor: string | null;
}

interface MockArc {
  sourcePosition: [number, number];
  targetPosition: [number, number];
  tripName: string;
  sourceCity: string;
  targetCity: string;
}

function build(
  trips: SeedTrip[],
  colorBySlug: Map<string, string | null>,
): { destinations: MockDestination[]; arcs: MockArc[]; countries: string[] } {
  const destinations: MockDestination[] = [];
  const arcs: MockArc[] = [];

  for (const trip of trips) {
    const tripId = `trip-${slugify(trip.name)}`;
    const stops = trip.destinations.map((dest) => {
      const slug = primaryCategorySlug(dest);
      return {
        id: `dest-${slugify(trip.name)}-${slugify(dest.city)}`,
        tripId,
        tripName: trip.name,
        name: dest.city,
        countryCode: dest.code,
        lat: dest.lat,
        lng: dest.lng,
        categoryColor: (slug ? colorBySlug.get(slug) : null) ?? null,
      };
    });
    destinations.push(...stops);

    // Arcs join consecutive stops in fixture order, which is the same order
    // the seeder writes into order_index.
    for (let i = 0; i < stops.length - 1; i += 1) {
      arcs.push({
        sourcePosition: [stops[i].lng, stops[i].lat],
        targetPosition: [stops[i + 1].lng, stops[i + 1].lat],
        tripName: trip.name,
        sourceCity: stops[i].name,
        targetCity: stops[i + 1].name,
      });
    }
  }

  const countries = Array.from(
    new Set(destinations.map((dest) => dest.countryCode)),
  ).sort();

  return { destinations, arcs, countries };
}

function render(
  trips: SeedTrip[],
  destinations: MockDestination[],
  arcs: MockArc[],
  countries: string[],
): string {
  const json = (value: unknown) => JSON.stringify(value);

  const destinationLines = destinations
    .map(
      (dest) =>
        `  {\n` +
        `    id: ${json(dest.id)},\n` +
        `    tripId: ${json(dest.tripId)},\n` +
        `    tripName: ${json(dest.tripName)},\n` +
        `    name: ${json(dest.name)},\n` +
        `    countryCode: ${json(dest.countryCode)},\n` +
        `    lat: ${dest.lat},\n` +
        `    lng: ${dest.lng},\n` +
        `    categoryColor: ${json(dest.categoryColor)},\n` +
        `  },`,
    )
    .join("\n");

  const arcLines = arcs
    .map(
      (arc) =>
        `  {\n` +
        `    sourcePosition: [${arc.sourcePosition[0]}, ${arc.sourcePosition[1]}],\n` +
        `    targetPosition: [${arc.targetPosition[0]}, ${arc.targetPosition[1]}],\n` +
        `    tripName: ${json(arc.tripName)},\n` +
        `    sourceCity: ${json(arc.sourceCity)},\n` +
        `    targetCity: ${json(arc.targetCity)},\n` +
        `  },`,
    )
    .join("\n");

  const roster = trips
    .map((trip) => `//   ${trip.start.slice(0, 4)}  ${trip.name}`)
    .join("\n");

  return `// GENERATED FILE. Do not edit by hand.
// Run "npm run generate-mock-globe" to rebuild it from scripts/demo-dataset.ts.
//
// The landing hero's static fallback: a snapshot of the public demo account's
// completed and ongoing trips, rendered when the live anon read of that account
// is unavailable. Planned trips are excluded, matching the live hero. Every
// coordinate here is a real place, carried over from the seed fixture.
//
// Trips in this snapshot:
${roster}

import type { GlobeArc, GlobeDestination } from "@/components/map/globe-types";

/** ISO 3166-1 alpha-2 codes, matched against ISO_A2_EH in countries.geojson. */
const visitedCountryCodes: string[] = ${json(countries)};

const destinations: GlobeDestination[] = [
${destinationLines}
].map((destination) => ({
  ...destination,
  arrivalDate: null,
  departureDate: null,
}));

const arcs: GlobeArc[] = [
${arcLines}
];

/**
 * The fallback globe payload, in the same shape the live landing read returns.
 */
export function buildMockGlobeProps(): {
  visitedCountryCodes: string[];
  destinations: GlobeDestination[];
  arcs: GlobeArc[];
} {
  return { visitedCountryCodes, destinations, arcs };
}
`;
}

async function main() {
  const env = loadEnvLocal();
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    db: { schema: "batchport" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase
    .from("categories")
    .select("slug, color");
  if (error) throw error;
  const colorBySlug = new Map<string, string | null>(
    ((data ?? []) as { slug: string; color: string | null }[]).map((row) => [
      row.slug,
      row.color,
    ]),
  );
  console.log(`Loaded ${colorBySlug.size} category colours.`);

  // The hero shows where the traveller has actually been. Planned trips carry
  // hollow pins and dashed arcs that need a legend to make sense, so they stay
  // on /demo and off the landing page.
  const trips = TRIPS.filter((trip) => trip.status !== "planned");
  const { destinations, arcs, countries } = build(trips, colorBySlug);

  writeFileSync(
    OUTPUT_PATH,
    render(trips, destinations, arcs, countries),
    "utf8",
  );

  console.log(
    `Wrote ${OUTPUT_PATH}: ${trips.length} trips, ${destinations.length} destinations, ${arcs.length} arcs, ${countries.length} countries.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

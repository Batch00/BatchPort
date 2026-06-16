// One-time import of Carson's real travel history into BatchPort.
//
// This is a seed script, not application code. It talks to Supabase with the
// service-role key (owner data, bypasses RLS) and to the running dev server for
// geocoding and Wikimedia photo lookups.
//
// Prerequisites:
//   - The dev server is running at http://localhost:3000 (npm run dev).
//   - .env.local holds NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
//   - SEED_USER_ID is set (env var or .env.local), otherwise the script prompts.
//
// Run with: npm run seed

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import { createClient } from "@supabase/supabase-js";

const BASE_URL = "http://localhost:3000";

// --- Types -----------------------------------------------------------------

type TripStatus = "completed" | "ongoing" | "planned";

interface SeedExperience {
  name: string;
  slug: string;
  notes?: string;
}

interface SeedDestination {
  city: string;
  country: string;
  arrival: string;
  departure: string;
  experiences: SeedExperience[];
}

interface SeedTrip {
  name: string;
  start: string;
  end: string;
  status: TripStatus;
  destinations: SeedDestination[];
}

interface GeoResult {
  name: string;
  country: string | null;
  country_code: string | null;
  admin_region: string | null;
  lat: number;
  lng: number;
}

interface WikimediaResult {
  url: string | null;
  attribution: string | null;
  license: string | null;
}

// --- Environment -----------------------------------------------------------

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

async function resolveUserId(env: Record<string, string>): Promise<string> {
  const fromEnv = process.env.SEED_USER_ID ?? env.SEED_USER_ID;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Enter SEED_USER_ID (your auth user UUID): ");
  rl.close();
  return answer.trim();
}

// --- Helpers ---------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Mirror of the app's formatWikimediaAttribution so stored credit reads the same.
function formatAttribution(
  attribution: string | null,
  license: string | null,
): string {
  const credit = attribution ?? "Unknown author";
  const tail = license ? `${credit} (${license})` : credit;
  return `${tail} via Wikimedia Commons`;
}

async function geocode(
  city: string,
  country: string,
): Promise<GeoResult | null> {
  const q = encodeURIComponent(`${city},${country}`);
  try {
    const res = await fetch(`${BASE_URL}/api/geocode/search?q=${q}`);
    if (!res.ok) return null;
    const results = (await res.json()) as GeoResult[];
    return Array.isArray(results) && results.length > 0 ? results[0] : null;
  } catch {
    return null;
  }
}

// Query by city name only. Wikidata entity search does not match
// comma-separated "city,country" strings, so passing the country breaks it.
async function wikimedia(city: string): Promise<WikimediaResult | null> {
  const q = encodeURIComponent(city);
  try {
    const res = await fetch(`${BASE_URL}/api/photos/wikimedia?q=${q}`);
    if (!res.ok) return null;
    return (await res.json()) as WikimediaResult;
  } catch {
    return null;
  }
}

// Approximate coordinates and ISO-2 country codes used when geocoding fails.
const FALLBACKS: Record<string, { lat: number; lng: number; code: string }> = {
  London: { lat: 51.5074, lng: -0.1278, code: "GB" },
  Paris: { lat: 48.8566, lng: 2.3522, code: "FR" },
  Amsterdam: { lat: 52.3676, lng: 4.9041, code: "NL" },
  Rudesheim: { lat: 49.9847, lng: 7.9247, code: "DE" },
  Interlaken: { lat: 46.6863, lng: 7.8632, code: "CH" },
  Milan: { lat: 45.4642, lng: 9.19, code: "IT" },
  Venice: { lat: 45.4408, lng: 12.3155, code: "IT" },
  Rome: { lat: 41.9028, lng: 12.4964, code: "IT" },
  Sorrento: { lat: 40.6263, lng: 14.3758, code: "IT" },
  Barcelona: { lat: 41.3874, lng: 2.1686, code: "ES" },
  Copenhagen: { lat: 55.6761, lng: 12.5683, code: "DK" },
  Stockholm: { lat: 59.3293, lng: 18.0686, code: "SE" },
  Oslo: { lat: 59.9139, lng: 10.7522, code: "NO" },
};

// --- Trip data -------------------------------------------------------------

const TRIPS: SeedTrip[] = [
  {
    name: "Post Grad Trip",
    start: "2025-05-12",
    end: "2025-06-10",
    status: "completed",
    destinations: [
      {
        city: "London",
        country: "United Kingdom",
        arrival: "2025-05-12",
        departure: "2025-05-16",
        experiences: [
          { name: "Buckingham Palace", slug: "attraction" },
          { name: "Big Ben", slug: "attraction" },
          {
            name: "British Museum",
            slug: "museum",
            notes: "Home of the Rosetta Stone",
          },
          {
            name: "British Library",
            slug: "museum",
            notes: "Codex Sinaiticus, Magna Carta",
          },
          { name: "St Pauls Cathedral", slug: "attraction" },
          { name: "London Bridge", slug: "attraction" },
          { name: "Borough Market", slug: "restaurant" },
          { name: "Harry Potter Platform 9 3/4", slug: "attraction" },
        ],
      },
      {
        city: "Paris",
        country: "France",
        arrival: "2025-05-16",
        departure: "2025-05-18",
        experiences: [
          { name: "Eiffel Tower", slug: "attraction" },
          { name: "The Louvre Museum", slug: "museum" },
          { name: "Notre Dame Cathedral", slug: "attraction" },
          { name: "Arc De Triomphe", slug: "attraction" },
          { name: "Seine River Cruise", slug: "activity" },
          { name: "Chamas Tacos", slug: "restaurant" },
        ],
      },
      {
        city: "Amsterdam",
        country: "Netherlands",
        arrival: "2025-05-18",
        departure: "2025-05-21",
        experiences: [
          { name: "Cheese Museum", slug: "museum" },
          { name: "Sex Museum", slug: "museum" },
          { name: "Saint Nicholas Basilica Mass", slug: "attraction" },
          { name: "Booze Cruise", slug: "activity" },
          { name: "Red Light District", slug: "nightlife" },
        ],
      },
      {
        city: "Rudesheim",
        country: "Germany",
        arrival: "2025-05-21",
        departure: "2025-05-22",
        experiences: [
          { name: "RheinWeinWelt Wine Tasting", slug: "activity" },
        ],
      },
      {
        city: "Interlaken",
        country: "Switzerland",
        arrival: "2025-05-22",
        departure: "2025-05-24",
        experiences: [
          { name: "Lauterbrunnen Waterfalls", slug: "nature" },
          { name: "Iseltwald", slug: "nature" },
          { name: "Giessbach Waterfalls", slug: "nature" },
          { name: "Harder Kulm", slug: "viewpoint" },
          { name: "Street Food Festival", slug: "restaurant" },
        ],
      },
      {
        city: "Milan",
        country: "Italy",
        arrival: "2025-05-24",
        departure: "2025-05-27",
        experiences: [
          { name: "Duomo", slug: "attraction" },
          { name: "Castello Sforzesco", slug: "museum" },
        ],
      },
      {
        city: "Venice",
        country: "Italy",
        arrival: "2025-05-27",
        departure: "2025-05-29",
        experiences: [
          { name: "Doge Palace", slug: "attraction" },
          { name: "Bridge of Sighs", slug: "attraction" },
          { name: "Basilica of Saint Mark", slug: "attraction" },
          { name: "Saint Marks Square", slug: "attraction" },
          { name: "Rialto Bridge", slug: "attraction" },
          { name: "Other Basilicas", slug: "attraction" },
        ],
      },
      {
        city: "Rome",
        country: "Italy",
        arrival: "2025-05-29",
        departure: "2025-06-01",
        experiences: [
          { name: "Colosseum", slug: "attraction" },
          { name: "Roman Forum", slug: "attraction" },
          { name: "Pantheon", slug: "attraction" },
          { name: "Piazza Navona", slug: "attraction" },
          { name: "Trevi Fountain", slug: "attraction" },
          { name: "Spanish Steps", slug: "attraction" },
          { name: "Vatican Museum", slug: "museum" },
          { name: "Sistine Chapel", slug: "attraction" },
          { name: "Saint Peters Basilica", slug: "attraction" },
        ],
      },
      {
        city: "Sorrento",
        country: "Italy",
        arrival: "2025-06-01",
        departure: "2025-06-06",
        experiences: [
          { name: "Bagni della Regina Giovanna", slug: "beach" },
          { name: "Beaches", slug: "beach" },
        ],
      },
      {
        city: "Barcelona",
        country: "Spain",
        arrival: "2025-06-06",
        departure: "2025-06-08",
        experiences: [
          { name: "La Sagrada Familia Basilica", slug: "attraction" },
          { name: "Arc De Triompf", slug: "attraction" },
        ],
      },
    ],
  },
  {
    name: "Pre Job Trip",
    start: "2025-09-27",
    end: "2025-10-07",
    status: "completed",
    destinations: [
      {
        city: "Copenhagen",
        country: "Denmark",
        arrival: "2025-09-28",
        departure: "2025-10-01",
        experiences: [
          { name: "Tivoli Gardens", slug: "activity" },
          { name: "Christiania", slug: "activity" },
          { name: "Botanical Garden", slug: "nature" },
          { name: "Rundetaarn", slug: "attraction" },
          { name: "Church of our Savior", slug: "attraction" },
          { name: "Nyhavn", slug: "attraction" },
          { name: "The Little Mermaid", slug: "attraction" },
          { name: "Amalienborg Royal Palace", slug: "attraction" },
        ],
      },
      {
        city: "Stockholm",
        country: "Sweden",
        arrival: "2025-10-01",
        departure: "2025-10-04",
        experiences: [
          { name: "Vasa Museum", slug: "museum" },
          { name: "Royal Palace", slug: "attraction" },
          { name: "Gamla Stan", slug: "attraction" },
          { name: "CentralBadet Spa", slug: "activity" },
        ],
      },
      {
        city: "Oslo",
        country: "Norway",
        arrival: "2025-10-04",
        departure: "2025-10-07",
        experiences: [
          { name: "Fram Museum", slug: "museum" },
          { name: "Royal Palace", slug: "attraction" },
          { name: "Opera House", slug: "attraction" },
          { name: "Floating Sauna", slug: "activity" },
          { name: "Tryvannstua Sportsstue", slug: "activity" },
        ],
      },
    ],
  },
];

// --- Main ------------------------------------------------------------------

async function main() {
  const env = loadEnvLocal();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
  }

  const userId = await resolveUserId(env);
  if (!userId) {
    throw new Error("A SEED_USER_ID is required.");
  }

  // Service-role client scoped to the batchport schema, so every query targets
  // the app's tables without an explicit .schema() call. Bypasses RLS.
  const supabase = createClient(supabaseUrl, serviceKey, {
    db: { schema: "batchport" },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Confirm the dev server is reachable before doing any work.
  try {
    const ping = await fetch(`${BASE_URL}/api/geocode/search?q=test`);
    if (!ping.ok) throw new Error(`status ${ping.status}`);
  } catch (error) {
    throw new Error(
      `Dev server is not reachable at ${BASE_URL}. Start it with "npm run dev" first. (${String(error)})`,
    );
  }

  // Build a slug -> category id map from the existing categories.
  const { data: categories, error: catError } = await supabase
    .from("categories")
    .select("id, slug");
  if (catError) throw catError;
  const categoryMap = new Map<string, string>(
    (categories ?? []).map((c: { id: string; slug: string }) => [c.slug, c.id]),
  );
  console.log(`Loaded ${categoryMap.size} categories.`);

  for (const trip of TRIPS) {
    console.log(`\n=== ${trip.name} ===`);

    // Idempotency: skip if a trip with this name already exists for the user.
    const { data: existing, error: existingError } = await supabase
      .from("trips")
      .select("id")
      .eq("user_id", userId)
      .eq("name", trip.name)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      console.warn(`Trip "${trip.name}" already exists. Skipping.`);
      continue;
    }

    const { data: tripRow, error: tripError } = await supabase
      .from("trips")
      .insert({
        user_id: userId,
        name: trip.name,
        start_date: trip.start,
        end_date: trip.end,
        status: trip.status,
        notes: null,
      })
      .select("id")
      .single();
    if (tripError || !tripRow) {
      console.error(`Failed to insert trip "${trip.name}":`, tripError);
      continue;
    }
    const tripId = tripRow.id as string;

    let destCount = 0;
    let expCount = 0;
    let photoCount = 0;

    for (let i = 0; i < trip.destinations.length; i++) {
      const dest = trip.destinations[i];
      const orderIndex = i + 1;

      // a. Geocode, falling back to hardcoded coordinates when needed.
      const geo = await geocode(dest.city, dest.country);
      const fallback = FALLBACKS[dest.city];
      let lat: number;
      let lng: number;
      let countryCode: string | null;
      let adminRegion: string | null = null;
      if (geo) {
        lat = geo.lat;
        lng = geo.lng;
        countryCode = geo.country_code ?? fallback?.code ?? null;
        adminRegion = geo.admin_region;
      } else {
        console.warn(
          `  Geocoding failed for ${dest.city}, using fallback coordinates.`,
        );
        lat = fallback?.lat ?? 0;
        lng = fallback?.lng ?? 0;
        countryCode = fallback?.code ?? null;
      }

      // b. Insert the destination. latitude/longitude are generated from geom.
      const { data: destRow, error: destError } = await supabase
        .from("destinations")
        .insert({
          trip_id: tripId,
          user_id: userId,
          name: dest.city,
          country_code: countryCode,
          admin_region: adminRegion,
          arrival_date: dest.arrival,
          departure_date: dest.departure,
          order_index: orderIndex,
          geom: `SRID=4326;POINT(${lng} ${lat})`,
          notes: null,
        })
        .select("id")
        .single();
      if (destError || !destRow) {
        console.error(`  Failed to insert ${dest.city}:`, destError);
        continue;
      }
      const destId = destRow.id as string;
      destCount++;

      // c. Wikimedia cover photo. Insert the record and point the cover at it.
      const photo = await wikimedia(dest.city);
      if (photo?.url) {
        const { data: photoRow, error: photoError } = await supabase
          .from("photos")
          .insert({
            user_id: userId,
            owner_type: "destination",
            owner_id: destId,
            source: "wikimedia",
            external_url: photo.url,
            attribution: formatAttribution(photo.attribution, photo.license),
            order_index: 0,
          })
          .select("id")
          .single();
        if (!photoError && photoRow) {
          await supabase
            .from("destinations")
            .update({ cover_photo_id: photoRow.id })
            .eq("id", destId);
          photoCount++;
        } else {
          console.error(`  Failed to insert photo for ${dest.city}:`, photoError);
        }
      } else {
        console.warn(`  No Wikimedia photo found for ${dest.city}.`);
      }

      // d. Experiences, each visited on the destination's arrival date.
      for (const exp of dest.experiences) {
        const categoryId = categoryMap.get(exp.slug) ?? null;
        if (!categoryId) {
          console.warn(
            `  No category for slug "${exp.slug}" (${exp.name}). Inserting without one.`,
          );
        }
        const { error: expError } = await supabase.from("experiences").insert({
          destination_id: destId,
          user_id: userId,
          name: exp.name,
          category_id: categoryId,
          rating: null,
          visited_date: dest.arrival,
          notes: exp.notes ?? null,
        });
        if (expError) {
          console.error(`  Failed to insert experience "${exp.name}":`, expError);
          continue;
        }
        expCount++;
      }

      console.log(
        `  ${orderIndex}. ${dest.city} (${dest.experiences.length} experiences)`,
      );

      // Be a courteous client to the geocoding and Wikimedia providers.
      await sleep(400);
    }

    console.log(
      `Done: ${trip.name} -> ${destCount} destinations, ${expCount} experiences, ${photoCount} photos.`,
    );
  }

  console.log("\nSeed complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

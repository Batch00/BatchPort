// Reset and reseed the public demo account with a fictional showcase dataset.
//
// The /demo page is the shop window: it renders one hardcoded account's data
// sessionlessly. This script wipes that account and rebuilds it from the
// fixture in demo-dataset.ts, which is designed to exercise every surface
// (multi-continent globe fills, a multi-year replay, the full category and
// rating spread, an ongoing trip with a live Today state, planned trips with
// day plans and countdowns, and a partly completed bucket list).
//
// This is a seed script, not application code. It talks to Supabase with the
// service-role key (bypasses RLS) and to the running dev server for geocoding
// and Wikimedia photo lookups.
//
// Safety:
//   - It refuses to run against any user id other than the demo account.
//   - It refuses to run without the --reset flag, because it deletes first.
//   - It leaves user_settings alone (is_demo, public_slug, projection).
//   - It counts every non-demo row before and after and reports the delta, so
//     an accidental blast radius is visible immediately.
//
// Prerequisites:
//   - The dev server is running at http://localhost:3000 (npm run dev).
//   - .env.local holds NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
//
// Run with: npm run seed-demo -- --reset

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import {
  BUCKET_ITEMS,
  TRANSPORT_LEGS,
  TRIPS,
  type ExperienceStatus,
  type SeedDestination,
} from "./demo-dataset";

const BASE_URL = "http://localhost:3000";
const PHOTO_BUCKET = "batchport";
const THUMB_SUFFIX = "_thumb";

// The only user id this script is ever allowed to touch. Mirrors
// src/lib/constants.ts DEMO_USER_ID; duplicated rather than imported so the
// guard cannot be widened by an app-side edit.
const DEMO_USER_ID = "703fbe07-db8a-41bd-bdee-928c2fa88107";

// --- Types -----------------------------------------------------------------

// The trip and bucket fixtures live in scripts/demo-dataset.ts, so the mock
// globe generator can derive the landing fallback from exactly what this
// script writes.

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

// --- Helpers ---------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
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

// Query by place name only. Wikidata entity search does not match
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

// Build the service-role client. Wrapped in a factory so its inferred type
// (scoped to the batchport schema) can be reused for helper parameters.
function makeSupabase(url: string, serviceKey: string) {
  return createClient(url, serviceKey, {
    db: { schema: "batchport" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
type SeedClient = ReturnType<typeof makeSupabase>;


// --- Guards ----------------------------------------------------------------

// Resolve the target user and refuse anything that is not the demo account.
// The demo id is the only value this script accepts; --user and SEED_USER_ID
// exist purely so an explicit mistake fails loudly instead of silently
// targeting the wrong account.
function resolveTargetUser(argv: string[], env: Record<string, string>): string {
  const flagIndex = argv.indexOf("--user");
  const requested =
    (flagIndex !== -1 ? argv[flagIndex + 1] : undefined) ??
    process.env.SEED_USER_ID ??
    env.SEED_USER_ID ??
    DEMO_USER_ID;

  const userId = requested.trim();
  if (userId !== DEMO_USER_ID) {
    throw new Error(
      `Refusing to run: this script only ever touches the demo account (${DEMO_USER_ID}). Got "${userId}".`,
    );
  }
  return userId;
}

// A second, independent check against the database itself: the target row must
// be flagged is_demo. If someone ever repoints the constant, this still stops.
async function assertIsDemoAccount(
  supabase: SeedClient,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("user_id, is_demo, public_slug")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.is_demo !== true) {
    throw new Error(
      "Refusing to run: the target user has no user_settings row flagged is_demo.",
    );
  }
  console.log(
    `Target confirmed: demo account, slug "${data.public_slug ?? "(none)"}".`,
  );
}

const COUNTED_TABLES = [
  "trips",
  "destinations",
  "experiences",
  "photos",
  "bucket_list",
] as const;

type TableCounts = Record<string, number>;

// Row counts for every user except the demo account. Compared before and
// after the run so any collateral damage is impossible to miss.
async function countOtherUsers(
  supabase: SeedClient,
  userId: string,
): Promise<TableCounts> {
  const counts: TableCounts = {};
  for (const table of COUNTED_TABLES) {
    const { count, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .neq("user_id", userId);
    if (error) throw error;
    counts[table] = count ?? 0;
  }
  return counts;
}

function reportOtherUserDelta(before: TableCounts, after: TableCounts): boolean {
  let clean = true;
  for (const table of COUNTED_TABLES) {
    const delta = after[table] - before[table];
    const flag = delta === 0 ? "unchanged" : `CHANGED BY ${delta}`;
    if (delta !== 0) clean = false;
    console.log(`  other users, ${table}: ${before[table]} -> ${after[table]} (${flag})`);
  }
  return clean;
}

// --- Reset -----------------------------------------------------------------

// Wipe every piece of demo travel data. user_settings is deliberately left
// alone: it carries is_demo and the public slug that /demo resolves through.
async function resetDemoData(
  supabase: SeedClient,
  userId: string,
): Promise<void> {
  // 1. Photos first, following the app's cleanup ordering: clear cover
  //    pointers, delete the rows, then best-effort Storage removal. Only
  //    upload-sourced objects are removed; wikimedia rows reference a shared
  //    cache path that other users' rows may still point at.
  const { data: photoRows, error: photoReadError } = await supabase
    .from("photos")
    .select("id, source, storage_path")
    .eq("user_id", userId);
  if (photoReadError) throw photoReadError;
  const photos = (photoRows ?? []) as {
    id: string;
    source: string;
    storage_path: string | null;
  }[];

  const clearTrips = await supabase
    .from("trips")
    .update({ cover_photo_id: null })
    .eq("user_id", userId)
    .not("cover_photo_id", "is", null);
  if (clearTrips.error) throw clearTrips.error;

  const clearDests = await supabase
    .from("destinations")
    .update({ cover_photo_id: null })
    .eq("user_id", userId)
    .not("cover_photo_id", "is", null);
  if (clearDests.error) throw clearDests.error;

  const deletePhotos = await supabase
    .from("photos")
    .delete()
    .eq("user_id", userId);
  if (deletePhotos.error) throw deletePhotos.error;

  const removablePaths = photos
    .filter((photo) => photo.source === "upload" && photo.storage_path)
    .flatMap((photo) => [
      photo.storage_path as string,
      `${photo.storage_path}${THUMB_SUFFIX}`,
    ]);
  if (removablePaths.length > 0) {
    try {
      await supabase.storage.from(PHOTO_BUCKET).remove(removablePaths);
    } catch {
      // Orphaned Storage objects are acceptable; the rows are already gone.
    }
  }
  console.log(
    `  photos: ${photos.length} row(s) deleted, ${removablePaths.length} storage object(s) attempted.`,
  );

  // 2. Bucket list, before trips: fulfilled items reference a trip id.
  const deleteBucket = await supabase
    .from("bucket_list")
    .delete()
    .eq("user_id", userId);
  if (deleteBucket.error) throw deleteBucket.error;
  console.log("  bucket_list: cleared.");

  // 3. Trips, which cascade to destinations and their experiences.
  const deleteTrips = await supabase.from("trips").delete().eq("user_id", userId);
  if (deleteTrips.error) throw deleteTrips.error;
  console.log("  trips: cleared (destinations and experiences cascade).");

  // 4. Belt and braces: anything left that did not hang off a trip.
  await supabase.from("experiences").delete().eq("user_id", userId);
  await supabase.from("destinations").delete().eq("user_id", userId);

  for (const table of COUNTED_TABLES) {
    const { count } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if ((count ?? 0) !== 0) {
      throw new Error(`Reset left ${count} row(s) in ${table}.`);
    }
  }
  console.log("  verified: no demo rows remain in any travel table.");
}

// --- Seed ------------------------------------------------------------------

// Spread done experiences across the stay instead of stacking every one on the
// arrival date, which makes the replay and the trip timeline read naturally.
function visitedDateFor(
  dest: SeedDestination,
  index: number,
  total: number,
): string {
  const stay = Math.max(1, daysBetween(dest.arrival, dest.departure));
  if (total <= 1) return dest.arrival;
  const offset = Math.min(stay - 1, Math.floor((index * stay) / total));
  return addDays(dest.arrival, Math.max(0, offset));
}

interface SeedTotals {
  trips: number;
  destinations: number;
  experiences: number;
  photos: number;
  covers: number;
  transport: number;
}

async function seedTrips(
  supabase: SeedClient,
  userId: string,
  categoryMap: Map<string, string>,
): Promise<{ totals: SeedTotals; tripIds: Map<string, string> }> {
  const totals: SeedTotals = {
    trips: 0,
    destinations: 0,
    experiences: 0,
    photos: 0,
    covers: 0,
    transport: 0,
  };
  const tripIds = new Map<string, string>();

  for (const trip of TRIPS) {
    console.log(`\n=== ${trip.name} (${trip.status}) ===`);

    const { data: tripRow, error: tripError } = await supabase
      .from("trips")
      .insert({
        user_id: userId,
        name: trip.name,
        start_date: trip.start,
        end_date: trip.end,
        status: trip.status,
        notes: trip.notes ?? null,
      })
      .select("id")
      .single();
    if (tripError || !tripRow) {
      console.error(`Failed to insert trip "${trip.name}":`, tripError);
      continue;
    }
    const tripId = tripRow.id as string;
    tripIds.set(trip.name, tripId);
    totals.trips += 1;

    let tripCoverPhotoId: string | null = null;
    // Featuring is a rank scoped to the trip (see lib/curation.ts), so the
    // counters reset per trip and count up in the order the fixture lists
    // them. Experiences and photos rank independently.
    let featuredExperienceRank = 0;
    let featuredPhotoRank = 0;

    for (let i = 0; i < trip.destinations.length; i++) {
      const dest = trip.destinations[i];

      // Authored coordinates are the source of truth. The geocoder is used to
      // enrich admin_region and to sanity-check placement; a result more than
      // 250 km away is a different place with the same name and is ignored.
      const geo = await geocode(dest.city, dest.country);
      let adminRegion: string | null = null;
      if (geo) {
        const driftKm = haversineKm(dest.lat, dest.lng, geo.lat, geo.lng);
        if (driftKm <= 250) {
          adminRegion = geo.admin_region;
        } else {
          console.warn(
            `  Geocoder returned a ${Math.round(driftKm)} km drift for ${dest.city}; keeping authored coordinates.`,
          );
        }
      }

      // latitude and longitude are generated from geom; never write them.
      const { data: destRow, error: destError } = await supabase
        .from("destinations")
        .insert({
          trip_id: tripId,
          user_id: userId,
          name: dest.city,
          country_code: dest.code,
          admin_region: adminRegion,
          arrival_date: dest.arrival,
          departure_date: dest.departure,
          order_index: i + 1,
          geom: `SRID=4326;POINT(${dest.lng} ${dest.lat})`,
          notes: dest.notes ?? null,
        })
        .select("id")
        .single();
      if (destError || !destRow) {
        console.error(`  Failed to insert ${dest.city}:`, destError);
        continue;
      }
      const destId = destRow.id as string;
      totals.destinations += 1;

      // Wikimedia cover photo for the destination, and the first one that
      // resolves also becomes the trip cover.
      const photo = await wikimedia(dest.photoQuery ?? dest.city);
      if (photo?.url) {
        const photoInsert = {
          user_id: userId,
          owner_type: "destination",
          owner_id: destId,
          source: "wikimedia",
          external_url: photo.url,
          attribution: formatAttribution(photo.attribution, photo.license),
          order_index: 0,
        };
        let { data: photoRow, error: photoError } = await supabase
          .from("photos")
          .insert({
            ...photoInsert,
            featured_rank: dest.featuredPhoto ? ++featuredPhotoRank : null,
          })
          .select("id")
          .single();
        // A database without the curation migration still seeds a complete
        // demo account; it just has nothing featured.
        if (photoError) {
          ({ data: photoRow, error: photoError } = await supabase
            .from("photos")
            .insert(photoInsert)
            .select("id")
            .single());
        }
        if (!photoError && photoRow) {
          await supabase
            .from("destinations")
            .update({ cover_photo_id: photoRow.id })
            .eq("id", destId);
          totals.photos += 1;
          if (!tripCoverPhotoId) tripCoverPhotoId = photoRow.id as string;
        } else {
          console.error(`  Failed to insert photo for ${dest.city}:`, photoError);
        }
      } else {
        console.warn(`  No Wikimedia photo found for ${dest.city}.`);
      }

      // Experiences. Planned ideas carry no rating and no visited date; done
      // ones are spread across the stay.
      const doneExperiences = dest.experiences.filter(
        (exp) => (exp.status ?? "done") === "done",
      );
      let doneIndex = 0;
      for (const exp of dest.experiences) {
        const status: ExperienceStatus = exp.status ?? "done";
        const categoryId = categoryMap.get(exp.slug) ?? null;
        if (!categoryId) {
          console.warn(
            `  No category for slug "${exp.slug}" (${exp.name}). Inserting without one.`,
          );
        }
        const visitedDate =
          status === "done"
            ? visitedDateFor(dest, doneIndex++, doneExperiences.length)
            : null;
        const expInsert = {
          destination_id: destId,
          user_id: userId,
          name: exp.name,
          category_id: categoryId,
          rating: status === "done" ? (exp.rating ?? null) : null,
          visited_date: visitedDate,
          notes: exp.notes ?? null,
          status,
          planned_day: exp.day ?? null,
          geom:
            exp.lat !== undefined && exp.lng !== undefined
              ? `SRID=4326;POINT(${exp.lng} ${exp.lat})`
              : null,
        };
        let { error: expError } = await supabase.from("experiences").insert({
          ...expInsert,
          // Planned ideas never reach the story, so featuring one would be a
          // rank nothing honours.
          featured_rank:
            exp.featured && status === "done" ? ++featuredExperienceRank : null,
        });
        if (expError) {
          ({ error: expError } = await supabase
            .from("experiences")
            .insert(expInsert));
        }
        if (expError) {
          console.error(`  Failed to insert experience "${exp.name}":`, expError);
          continue;
        }
        totals.experiences += 1;
      }

      // How the traveller reached this stop. Best effort: a database without
      // the transport_legs table still seeds a complete demo account, it just
      // has no legs on the trip pages and default-styled arcs on the globe.
      const leg = TRANSPORT_LEGS[trip.name]?.[dest.city];
      if (leg) {
        const { error: legError } = await supabase
          .from("transport_legs")
          .insert({
            user_id: userId,
            trip_id: tripId,
            destination_id: destId,
            mode: leg.mode,
            carrier: leg.carrier ?? null,
            duration_minutes: leg.durationMinutes ?? null,
            notes: leg.notes ?? null,
          });
        if (legError) {
          console.warn(
            `  Could not record the ${leg.mode} into ${dest.city}: ${legError.message}`,
          );
        } else {
          totals.transport += 1;
        }
      }

      console.log(
        `  ${i + 1}. ${dest.city} (${dest.experiences.length} experiences)`,
      );

      // Be a courteous client to the geocoding and Wikimedia providers.
      await sleep(400);
    }

    if (tripCoverPhotoId) {
      const { error: coverError } = await supabase
        .from("trips")
        .update({ cover_photo_id: tripCoverPhotoId })
        .eq("id", tripId);
      if (coverError) {
        console.error(`  Failed to set the trip cover:`, coverError);
      } else {
        totals.covers += 1;
      }
    }
  }

  return { totals, tripIds };
}

async function seedBucketList(
  supabase: SeedClient,
  userId: string,
  tripIds: Map<string, string>,
): Promise<{ total: number; fulfilled: number }> {
  let total = 0;
  let fulfilled = 0;

  for (const item of BUCKET_ITEMS) {
    const fulfilledTripId = item.fulfilled_by
      ? (tripIds.get(item.fulfilled_by) ?? null)
      : null;
    if (item.fulfilled_by && !fulfilledTripId) {
      console.warn(
        `  Bucket item "${item.place_name ?? item.country_code}" names a trip that was not seeded ("${item.fulfilled_by}"); leaving it unfulfilled.`,
      );
    }

    const { error } = await supabase.from("bucket_list").insert({
      user_id: userId,
      type: item.type,
      country_code: item.country_code,
      place_name: item.place_name ?? null,
      geom:
        item.lat !== undefined && item.lng !== undefined
          ? `SRID=4326;POINT(${item.lng} ${item.lat})`
          : null,
      priority: item.priority,
      target_date: item.target_date ?? null,
      notes: item.notes ?? null,
      fulfilled_trip_id: fulfilledTripId,
      fulfilled_at: fulfilledTripId
        ? `${item.fulfilled_at ?? item.target_date ?? "2024-01-01"}T12:00:00Z`
        : null,
    });
    if (error) {
      console.error(
        `  Failed to add bucket item "${item.place_name ?? item.country_code}":`,
        error,
      );
      continue;
    }
    total += 1;
    if (fulfilledTripId) fulfilled += 1;
  }

  return { total, fulfilled };
}

// --- Stats report ----------------------------------------------------------

async function reportStats(
  supabase: SeedClient,
  userId: string,
): Promise<void> {
  const [summary, categories, yearly, bucket, extremes, distance] =
    await Promise.all([
      supabase
        .from("v_user_travel_summary")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase.from("v_experiences_by_category").select("*").eq("user_id", userId),
      supabase
        .from("v_yearly_breakdown")
        .select("*")
        .eq("user_id", userId)
        .order("year"),
      supabase
        .from("v_bucket_completion")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("v_travel_extremes")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase.rpc("f_distance_traveled", { p_user_id: userId }),
    ]);

  console.log("\n--- Stats views ---");
  console.log("summary:", JSON.stringify(summary.data ?? summary.error));
  console.log("distance_km:", JSON.stringify(distance.data ?? distance.error));
  console.log("bucket:", JSON.stringify(bucket.data ?? bucket.error));
  console.log("extremes:", JSON.stringify(extremes.data ?? extremes.error));
  console.log("yearly:");
  for (const row of (yearly.data ?? []) as Record<string, unknown>[]) {
    console.log(
      `  ${row.year}: ${row.trips} trip(s), ${row.countries} country/ies, ${row.new_countries} new`,
    );
  }
  console.log("categories:");
  for (const row of (categories.data ?? []) as Record<string, unknown>[]) {
    console.log(
      `  ${row.label}: ${row.experience_count} experience(s), avg ${row.avg_rating_stars ?? "n/a"} stars`,
    );
  }
}

// --- Main ------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.includes("--reset")) {
    throw new Error(
      "Refusing to run without --reset. This script DELETES all demo travel data before reseeding it. Run: npm run seed-demo -- --reset",
    );
  }

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

  const userId = resolveTargetUser(argv, env);
  const supabase = makeSupabase(supabaseUrl, serviceKey);
  await assertIsDemoAccount(supabase, userId);

  // Confirm the dev server is reachable before doing any work: without it
  // there is no geocoding and no Wikimedia imagery.
  try {
    const ping = await fetch(`${BASE_URL}/api/geocode/search?q=test`);
    if (!ping.ok) throw new Error(`status ${ping.status}`);
  } catch (error) {
    throw new Error(
      `Dev server is not reachable at ${BASE_URL}. Start it with "npm run dev" first. (${String(error)})`,
    );
  }

  const before = await countOtherUsers(supabase, userId);

  const { data: categories, error: catError } = await supabase
    .from("categories")
    .select("id, slug");
  if (catError) throw catError;
  const categoryMap = new Map<string, string>(
    (categories ?? []).map((c: { id: string; slug: string }) => [c.slug, c.id]),
  );
  console.log(`Loaded ${categoryMap.size} categories.`);

  console.log("\n=== Reset ===");
  await resetDemoData(supabase, userId);

  const { totals, tripIds } = await seedTrips(supabase, userId, categoryMap);

  console.log("\n=== Bucket list ===");
  const bucket = await seedBucketList(supabase, userId, tripIds);
  console.log(`  ${bucket.total} item(s), ${bucket.fulfilled} fulfilled.`);

  console.log("\n=== Seeded ===");
  console.log(
    `  ${totals.trips} trips, ${totals.destinations} destinations, ${totals.experiences} experiences, ${totals.photos} photos, ${totals.covers} trip covers, ${totals.transport} transport legs.`,
  );

  console.log("\n=== Blast radius check ===");
  const after = await countOtherUsers(supabase, userId);
  const clean = reportOtherUserDelta(before, after);
  if (!clean) {
    throw new Error(
      "Non-demo row counts changed. Investigate before trusting this run.",
    );
  }

  await reportStats(supabase, userId);

  console.log("\nDemo reset complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

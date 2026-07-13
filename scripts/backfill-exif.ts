// Backfill EXIF metadata (date taken and GPS coordinates) for uploaded photos
// that were saved before the app extracted EXIF at upload time.
//
// This is a maintenance script, not application code. It talks to Supabase with
// the service-role key (owner data, bypasses RLS), downloads each original from
// Storage, and parses EXIF locally with exifreader.
//
// GPS storage requires two extra columns (run once in the Supabase SQL editor):
//   ALTER TABLE batchport.photos ADD COLUMN IF NOT EXISTS gps_lat double precision;
//   ALTER TABLE batchport.photos ADD COLUMN IF NOT EXISTS gps_lng double precision;
// If the columns are missing, the script still backfills date_taken and logs
// GPS findings without persisting them.
//
// Idempotent: photos that already have date_taken (and GPS, when the columns
// exist) are skipped, so re-running only touches unprocessed rows.
//
// Prerequisites:
//   - .env.local holds NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
//
// Run with: npm run backfill-exif

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import {
  extractExifFromBuffer,
  findNearestDestination,
} from "../src/lib/utils/exif";

const PHOTO_BUCKET = "batchport";

// Service-role client scoped to the batchport schema. Bypasses RLS.
function createBatchportClient(url: string, serviceKey: string) {
  return createClient(url, serviceKey, {
    db: { schema: "batchport" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
type BatchportClient = ReturnType<typeof createBatchportClient>;

interface PhotoRow {
  id: string;
  user_id: string;
  storage_path: string | null;
  date_taken: string | null;
  gps_lat?: number | null;
  gps_lng?: number | null;
}

interface DestinationRow {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
}

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

// Fetch all upload photos, tolerating databases without the GPS columns.
// Returns the rows plus whether gps_lat/gps_lng are available for writes.
async function fetchUploadPhotos(
  supabase: BatchportClient,
): Promise<{ photos: PhotoRow[]; hasGpsColumns: boolean }> {
  const withGps = await supabase
    .from("photos")
    .select("id, user_id, storage_path, date_taken, gps_lat, gps_lng")
    .eq("source", "upload")
    .order("created_at", { ascending: true });
  if (!withGps.error) {
    return { photos: (withGps.data ?? []) as PhotoRow[], hasGpsColumns: true };
  }

  const withoutGps = await supabase
    .from("photos")
    .select("id, user_id, storage_path, date_taken")
    .eq("source", "upload")
    .order("created_at", { ascending: true });
  if (withoutGps.error) throw withoutGps.error;
  console.warn(
    "photos.gps_lat / photos.gps_lng do not exist; GPS will be logged but not saved.",
  );
  console.warn(
    "Add them with: ALTER TABLE batchport.photos ADD COLUMN IF NOT EXISTS gps_lat double precision, ADD COLUMN IF NOT EXISTS gps_lng double precision;",
  );
  return { photos: (withoutGps.data ?? []) as PhotoRow[], hasGpsColumns: false };
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

  const supabase = createBatchportClient(supabaseUrl, serviceKey);

  const { photos, hasGpsColumns } = await fetchUploadPhotos(supabase);

  // Idempotency: only process photos still missing something we can fill.
  const pending = photos.filter((photo) => {
    if (!photo.storage_path) return false;
    if (photo.date_taken === null) return true;
    if (hasGpsColumns && photo.gps_lat == null) return true;
    return false;
  });
  console.log(
    `${photos.length} uploaded photo(s) found, ${pending.length} need EXIF backfill.`,
  );
  if (pending.length === 0) return;

  // Destinations per user, for nearest-destination GPS suggestions.
  const userIds = Array.from(new Set(pending.map((photo) => photo.user_id)));
  const { data: destRows, error: destError } = await supabase
    .from("destinations")
    .select("id, name, latitude, longitude, user_id")
    .in("user_id", userIds);
  if (destError) throw destError;
  const destinationsByUser = new Map<string, DestinationRow[]>();
  for (const row of (destRows ?? []) as (DestinationRow & { user_id: string })[]) {
    const list = destinationsByUser.get(row.user_id) ?? [];
    list.push(row);
    destinationsByUser.set(row.user_id, list);
  }

  let updated = 0;
  let skippedNoExif = 0;
  let failed = 0;

  for (const photo of pending) {
    const path = photo.storage_path as string;
    const { data: file, error: downloadError } = await supabase.storage
      .from(PHOTO_BUCKET)
      .download(path);
    if (downloadError || !file) {
      console.error(`  Could not download ${path}:`, downloadError?.message);
      failed++;
      continue;
    }

    const exif = await extractExifFromBuffer(await file.arrayBuffer());
    const hasGps = exif.gpsLat !== null && exif.gpsLng !== null;
    if (!exif.dateTaken && !hasGps) {
      skippedNoExif++;
      continue;
    }

    const patch: Record<string, unknown> = {};
    if (exif.dateTaken && photo.date_taken === null) {
      patch.date_taken = exif.dateTaken;
    }
    if (hasGps && hasGpsColumns && photo.gps_lat == null) {
      patch.gps_lat = exif.gpsLat;
      patch.gps_lng = exif.gpsLng;
    }

    if (Object.keys(patch).length > 0) {
      const { error: updateError } = await supabase
        .from("photos")
        .update(patch)
        .eq("id", photo.id);
      if (updateError) {
        console.error(`  Could not update photo ${photo.id}:`, updateError.message);
        failed++;
        continue;
      }
      updated++;
    }

    const parts: string[] = [];
    if (patch.date_taken) parts.push(`date_taken=${exif.dateTaken}`);
    if (hasGps) {
      parts.push(`gps=${exif.gpsLat!.toFixed(5)},${exif.gpsLng!.toFixed(5)}`);
    }
    console.log(`  ${path}: ${parts.join(" ") || "already up to date"}`);

    // Suggest (but never apply) a nearest-destination match for GPS photos.
    if (hasGps) {
      const nearest = findNearestDestination(
        exif.gpsLat!,
        exif.gpsLng!,
        destinationsByUser.get(photo.user_id)?.map((dest) => ({
          id: dest.id,
          name: dest.name,
          lat: dest.latitude,
          lng: dest.longitude,
        })) ?? [],
      );
      if (nearest) {
        console.log(
          `    Suggestion: this photo was taken near destination "${nearest.name}" (${nearest.id}).`,
        );
      }
    }
  }

  console.log(
    `\nBackfill complete. ${updated} updated, ${skippedNoExif} with no usable EXIF, ${failed} failed, ${pending.length} processed.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

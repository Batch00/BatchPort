// Find and remove orphaned photo rows: photos whose owner entity no longer
// exists.
//
// The photos table is polymorphic (owner_type + owner_id, no foreign key), so
// Postgres cascades never touch it. Before the delete actions cleaned up after
// themselves, every deleted trip, destination, and experience left its photos
// behind as invisible rows: they still counted toward the photo map's totals
// and still held Storage objects. This script cleans up what those historical
// deletes left behind.
//
// Usage:
//   npm run cleanup-orphan-photos -- --dry-run   # report only, changes nothing
//   npm run cleanup-orphan-photos                # delete rows + upload objects
//
// The real run:
//   - clears any trips.cover_photo_id / destinations.cover_photo_id pointing
//     at an orphan (the pointer would otherwise block the delete),
//   - deletes the orphan rows,
//   - removes the Storage objects for upload-sourced orphans and their
//     "{path}_thumb" thumbnails. Wikimedia cache files live at a shared
//     wikimedia/{hash} path that other photo rows may still reference, so they
//     are always kept.
//
// Idempotent: a second run finds nothing to do.
//
// Prerequisites:
//   - .env.local holds NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

const PHOTO_BUCKET = "batchport";
const THUMB_SUFFIX = "_thumb";
// PostgREST caps a single response; ids are paged through in these blocks, and
// `in` filters are chunked to the same size to keep query strings short.
const PAGE_SIZE = 1000;
const CHUNK_SIZE = 100;

// Service-role client scoped to the batchport schema. Bypasses RLS: this
// script sweeps every user's orphans, not one session's.
function createBatchportClient(url: string, serviceKey: string) {
  return createClient(url, serviceKey, {
    db: { schema: "batchport" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
type BatchportClient = ReturnType<typeof createBatchportClient>;

type OwnerType = "trip" | "destination" | "experience";

interface PhotoRow {
  id: string;
  user_id: string;
  owner_type: string;
  owner_id: string;
  source: string;
  storage_path: string | null;
  created_at: string;
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

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Every id in a table, paged so tables larger than one PostgREST page are
 * still read in full (a short read would look like mass orphaning). */
async function fetchAllIds(
  supabase: BatchportClient,
  table: string,
): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select("id")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new Error(`Could not read ${table}: ${error.message}`);
    }
    const rows = (data ?? []) as { id: string }[];
    for (const row of rows) ids.add(row.id);
    if (rows.length < PAGE_SIZE) break;
  }
  return ids;
}

async function fetchAllPhotos(supabase: BatchportClient): Promise<PhotoRow[]> {
  const photos: PhotoRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("photos")
      .select("id, user_id, owner_type, owner_id, source, storage_path, created_at")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new Error(`Could not read photos: ${error.message}`);
    }
    const rows = (data ?? []) as PhotoRow[];
    photos.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return photos;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

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

  const supabase: BatchportClient = createBatchportClient(
    supabaseUrl,
    serviceKey,
  );

  console.log(
    dryRun
      ? "Dry run: reporting orphaned photos, changing nothing.\n"
      : "Cleaning up orphaned photos.\n",
  );

  const [photos, tripIds, destinationIds, experienceIds] = await Promise.all([
    fetchAllPhotos(supabase),
    fetchAllIds(supabase, "trips"),
    fetchAllIds(supabase, "destinations"),
    fetchAllIds(supabase, "experiences"),
  ]);

  const owners: Record<OwnerType, Set<string>> = {
    trip: tripIds,
    destination: destinationIds,
    experience: experienceIds,
  };

  console.log(
    `${photos.length} photo row(s); ${tripIds.size} trip(s), ${destinationIds.size} destination(s), ${experienceIds.size} experience(s).`,
  );

  const orphans: PhotoRow[] = [];
  const unknownOwnerTypes = new Map<string, number>();
  for (const photo of photos) {
    const known = owners[photo.owner_type as OwnerType];
    if (!known) {
      // An owner_type the app does not write. Left alone rather than guessed at.
      unknownOwnerTypes.set(
        photo.owner_type,
        (unknownOwnerTypes.get(photo.owner_type) ?? 0) + 1,
      );
      continue;
    }
    if (!known.has(photo.owner_id)) orphans.push(photo);
  }

  for (const [type, count] of unknownOwnerTypes) {
    console.warn(`  Skipping ${count} photo(s) with unknown owner_type "${type}".`);
  }

  if (orphans.length === 0) {
    console.log("\nNo orphaned photos found.");
    return;
  }

  // Report: counts by owner type and source, plus a sample.
  const byOwnerType = new Map<string, number>();
  const bySource = new Map<string, number>();
  const byUser = new Map<string, number>();
  for (const photo of orphans) {
    byOwnerType.set(
      photo.owner_type,
      (byOwnerType.get(photo.owner_type) ?? 0) + 1,
    );
    bySource.set(photo.source, (bySource.get(photo.source) ?? 0) + 1);
    byUser.set(photo.user_id, (byUser.get(photo.user_id) ?? 0) + 1);
  }

  console.log(`\n${orphans.length} orphaned photo(s) found:`);
  for (const [type, count] of byOwnerType) {
    console.log(`  owner_type ${type}: ${count}`);
  }
  for (const [source, count] of bySource) {
    console.log(`  source ${source}: ${count}`);
  }
  for (const [user, count] of byUser) {
    console.log(`  user ${user}: ${count}`);
  }
  console.log("\n  Sample:");
  for (const photo of orphans.slice(0, 10)) {
    console.log(
      `    ${photo.id} ${photo.owner_type}/${photo.owner_id} (${photo.source}, ${photo.created_at.slice(0, 10)})`,
    );
  }
  if (orphans.length > 10) {
    console.log(`    ... and ${orphans.length - 10} more`);
  }

  if (dryRun) {
    console.log("\nDry run: nothing was changed. Re-run without --dry-run to clean up.");
    return;
  }

  const orphanIds = orphans.map((photo) => photo.id);

  // Clear cover pointers first: a surviving trip or destination can still
  // point at an orphan (a trip cover chosen from a since-deleted destination's
  // photo), and the pointer would block the row delete.
  let coversCleared = 0;
  for (const batch of chunk(orphanIds, CHUNK_SIZE)) {
    for (const table of ["trips", "destinations"] as const) {
      const { data, error } = await supabase
        .from(table)
        .update({ cover_photo_id: null })
        .in("cover_photo_id", batch)
        .select("id");
      if (error) {
        console.error(`  Could not clear ${table} covers:`, error.message);
        process.exit(1);
      }
      coversCleared += (data ?? []).length;
    }
  }
  if (coversCleared > 0) {
    console.log(`\nCleared ${coversCleared} cover pointer(s) referencing orphans.`);
  }

  // Delete the rows. The rows are the source of truth, so any failure here
  // stops the run before Storage is touched.
  let deleted = 0;
  for (const batch of chunk(orphanIds, CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("photos")
      .delete()
      .in("id", batch)
      .select("id");
    if (error) {
      console.error("  Could not delete photo rows:", error.message);
      process.exit(1);
    }
    deleted += (data ?? []).length;
  }
  console.log(`Deleted ${deleted} orphaned photo row(s).`);

  // Best-effort Storage cleanup for upload-sourced orphans and their derived
  // thumbnails. Removing a nonexistent object is a no-op.
  const removablePaths = orphans
    .filter((photo) => photo.source === "upload" && photo.storage_path)
    .flatMap((photo) => [
      photo.storage_path as string,
      `${photo.storage_path}${THUMB_SUFFIX}`,
    ]);
  let removed = 0;
  for (const batch of chunk(removablePaths, CHUNK_SIZE)) {
    const { data, error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .remove(batch);
    if (error) {
      console.warn("  Storage cleanup partially failed:", error.message);
      continue;
    }
    removed += (data ?? []).length;
  }
  console.log(
    `Removed ${removed} Storage object(s) (of ${removablePaths.length} candidate path(s); missing objects are expected).`,
  );

  console.log("\nCleanup complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

// Find and remove orphaned upload files: Storage objects under a user's upload
// prefix that no photos row references.
//
// This is the mirror image of cleanup-orphan-photos.ts, which removes ROWS
// whose owner is gone. Here the row never existed: the client uploads the file
// (and its "_thumb") before insertPhotoRecord writes the row, so every insert
// that failed left both objects behind. insertPhotoRecord now discards the
// upload when its insert fails, but files from before that fix (and from a
// session that lost its connection mid-save) are still there.
//
// Usage:
//   npm run cleanup-orphan-uploads             # report only, changes nothing
//   npm run cleanup-orphan-uploads -- --apply  # delete the orphaned objects
//   npm run cleanup-orphan-uploads -- --min-age=10  # lower the age floor
//
// What counts as referenced: every photos.storage_path, every
// photos.thumb_path, and "{storage_path}_thumb" for each row (a thumb can
// exist without thumb_path when the row was saved on a database that predates
// the column). An object is an orphan when it matches none of them.
//
// What is never touched:
//   - the wikimedia/ prefix (shared cache files, not user uploads), and any
//     other top-level folder that is not a user id,
//   - objects younger than the age floor (MIN_AGE_MINUTES by default), so an upload whose row is being
//     written right now is not swept out from under it.
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
const PAGE_SIZE = 1000;
const REMOVE_CHUNK = 100;
const MIN_AGE_MINUTES = 60;
// Only top-level folders shaped like a user id are upload prefixes.
const USER_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Service-role client scoped to the batchport schema. Bypasses RLS: this
// script sweeps every user's uploads, not one session's.
function createBatchportClient(url: string, serviceKey: string) {
  return createClient(url, serviceKey, {
    db: { schema: "batchport" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
type BatchportClient = ReturnType<typeof createBatchportClient>;

interface StorageObject {
  path: string;
  size: number;
  createdAt: string | null;
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

/** Every object under a prefix. Storage lists one level at a time, and a
 * folder is an entry with a null id, so this walks down into each one. */
async function listRecursive(
  supabase: BatchportClient,
  prefix: string,
): Promise<StorageObject[]> {
  const objects: StorageObject[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .list(prefix, { limit: PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) {
      throw new Error(`Could not list ${prefix || "(root)"}: ${error.message}`);
    }
    const entries = data ?? [];
    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        objects.push(...(await listRecursive(supabase, path)));
      } else {
        const size = (entry.metadata as { size?: number } | null)?.size ?? 0;
        objects.push({ path, size, createdAt: entry.created_at ?? null });
      }
    }
    if (entries.length < PAGE_SIZE) break;
  }
  return objects;
}

/** Every path a photos row references, paged so a short read can never make
 * live files look orphaned. */
async function fetchReferencedPaths(
  supabase: BatchportClient,
): Promise<Set<string>> {
  const referenced = new Set<string>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("photos")
      .select("id, storage_path, thumb_path")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new Error(`Could not read photos: ${error.message}`);
    }
    const rows = (data ?? []) as {
      id: string;
      storage_path: string | null;
      thumb_path: string | null;
    }[];
    for (const row of rows) {
      if (row.storage_path) {
        referenced.add(row.storage_path);
        referenced.add(`${row.storage_path}${THUMB_SUFFIX}`);
      }
      if (row.thumb_path) referenced.add(row.thumb_path);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return referenced;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const minAgeArg = process.argv.find((arg) => arg.startsWith("--min-age="));
  const minAgeMinutes = minAgeArg
    ? Number(minAgeArg.slice("--min-age=".length))
    : MIN_AGE_MINUTES;
  if (!Number.isFinite(minAgeMinutes) || minAgeMinutes < 0) {
    throw new Error("--min-age takes a number of minutes, 0 or more.");
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
  const supabase = createBatchportClient(supabaseUrl, serviceKey);

  console.log(
    apply
      ? "Removing orphaned upload files.\n"
      : "Dry run: reporting orphaned upload files, changing nothing.\n",
  );

  // Read the rows first: an object uploaded after this read could look
  // orphaned, which is what the age floor below guards against.
  const referenced = await fetchReferencedPaths(supabase);

  const { data: top, error: topError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .list("", { limit: PAGE_SIZE });
  if (topError) throw new Error(`Could not list bucket: ${topError.message}`);
  const userPrefixes = (top ?? [])
    .filter((entry) => entry.id === null && USER_PREFIX.test(entry.name))
    .map((entry) => entry.name);
  const skipped = (top ?? [])
    .filter((entry) => !USER_PREFIX.test(entry.name))
    .map((entry) => entry.name);
  if (skipped.length > 0) {
    console.log(`Skipping non-user prefixes: ${skipped.join(", ")}`);
  }

  const cutoff = Date.now() - minAgeMinutes * 60 * 1000;
  const orphans: StorageObject[] = [];
  let scanned = 0;
  let tooRecent = 0;
  for (const prefix of userPrefixes) {
    const objects = await listRecursive(supabase, prefix);
    scanned += objects.length;
    for (const object of objects) {
      if (referenced.has(object.path)) continue;
      if (object.createdAt && Date.parse(object.createdAt) > cutoff) {
        tooRecent += 1;
        continue;
      }
      orphans.push(object);
    }
  }

  console.log(
    `${referenced.size} referenced path(s); ${scanned} object(s) under ${userPrefixes.length} user prefix(es).`,
  );
  if (tooRecent > 0) {
    console.log(
      `Left ${tooRecent} unreferenced object(s) younger than ${minAgeMinutes} minutes alone.`,
    );
  }
  if (orphans.length === 0) {
    console.log("\nNo orphaned upload files found.");
    return;
  }

  const thumbs = orphans.filter((o) => o.path.endsWith(THUMB_SUFFIX)).length;
  const bytes = orphans.reduce((sum, o) => sum + o.size, 0);
  console.log(
    `\n${orphans.length} orphaned object(s) (${orphans.length - thumbs} full, ${thumbs} thumb), ${formatBytes(bytes)}:`,
  );
  for (const object of orphans) {
    console.log(
      `  ${object.path} (${formatBytes(object.size)}, ${object.createdAt?.slice(0, 16) ?? "?"})`,
    );
  }

  if (!apply) {
    console.log("\nDry run: nothing was changed. Re-run with --apply to delete.");
    return;
  }

  let removed = 0;
  for (const batch of chunk(orphans.map((o) => o.path), REMOVE_CHUNK)) {
    const { data, error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .remove(batch);
    if (error) {
      console.error("  Could not remove a batch:", error.message);
      process.exit(1);
    }
    removed += (data ?? []).length;
  }
  console.log(`\nRemoved ${removed} of ${orphans.length} orphaned object(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

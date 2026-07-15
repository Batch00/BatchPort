// Backfill gallery thumbnails for photos uploaded before thumbnails existed.
//
// This is a maintenance script, not application code. It talks to Supabase
// with the service-role key (bypasses RLS), downloads each stored image,
// generates a small thumbnail locally with sharp (which ships with Next.js),
// uploads it next to the original as "{storage_path}_thumb", and sets
// photos.thumb_path.
//
// Requires the thumb_path column (run once in the Supabase SQL editor):
//   ALTER TABLE batchport.photos ADD COLUMN IF NOT EXISTS thumb_path text;
//
// Covers every photo with a storage_path: user uploads AND Wikimedia images
// the proxy has cached into Storage. Wikimedia rows can share one cached file
// (the path is a hash of the source URL), so work is deduplicated by
// storage_path and the thumb_path update is applied to all rows sharing it.
//
// Idempotent: rows that already have thumb_path are skipped, and the thumb
// upload uses upsert, so re-running only touches unprocessed photos.
//
// Prerequisites:
//   - .env.local holds NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
//
// Run with: npm run backfill-thumbnails

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const PHOTO_BUCKET = "batchport";
const THUMB_SUFFIX = "_thumb";
const THUMB_MAX_DIM = 400;
const THUMB_QUALITY = 75;

// Formats sharp can safely re-encode for a photo thumbnail. Anything else
// (svg, gif) is skipped; those photos keep falling back to the full image.
const THUMBABLE_FORMATS = new Set(["jpeg", "png", "webp"]);

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
  source: string;
  storage_path: string | null;
  thumb_path: string | null;
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

async function generateThumb(
  input: Buffer,
): Promise<{ data: Buffer; contentType: string } | null> {
  // rotate() applies any EXIF orientation; a no-op for images without one
  // (client-resized uploads already have orientation baked in).
  const image = sharp(input).rotate();
  const metadata = await image.metadata();
  const format = metadata.format ?? "";
  if (!THUMBABLE_FORMATS.has(format)) return null;

  const resized = image.resize({
    width: THUMB_MAX_DIM,
    height: THUMB_MAX_DIM,
    fit: "inside",
    withoutEnlargement: true,
  });
  if (format === "png") {
    return { data: await resized.png().toBuffer(), contentType: "image/png" };
  }
  if (format === "webp") {
    return {
      data: await resized.webp({ quality: THUMB_QUALITY }).toBuffer(),
      contentType: "image/webp",
    };
  }
  return {
    data: await resized.jpeg({ quality: THUMB_QUALITY }).toBuffer(),
    contentType: "image/jpeg",
  };
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

  const supabase: BatchportClient = createBatchportClient(
    supabaseUrl,
    serviceKey,
  );

  const { data, error } = await supabase
    .from("photos")
    .select("id, source, storage_path, thumb_path")
    .not("storage_path", "is", null)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("Could not read photos:", error.message);
    console.error(
      "If the error mentions thumb_path, run this first in the Supabase SQL editor:",
    );
    console.error(
      "  ALTER TABLE batchport.photos ADD COLUMN IF NOT EXISTS thumb_path text;",
    );
    process.exit(1);
  }
  const photos = (data ?? []) as PhotoRow[];

  // Group by storage_path: Wikimedia rows can share one cached file, so each
  // file is processed once and every row pointing at it gets the thumb_path.
  const rowsByPath = new Map<string, PhotoRow[]>();
  for (const photo of photos) {
    if (!photo.storage_path) continue;
    const list = rowsByPath.get(photo.storage_path) ?? [];
    list.push(photo);
    rowsByPath.set(photo.storage_path, list);
  }
  const pendingPaths = Array.from(rowsByPath.entries()).filter(([, rows]) =>
    rows.some((row) => row.thumb_path === null),
  );
  console.log(
    `${photos.length} stored photo(s) across ${rowsByPath.size} file(s); ${pendingPaths.length} file(s) need thumbnails.`,
  );
  if (pendingPaths.length === 0) return;

  let done = 0;
  let skipped = 0;
  let failed = 0;

  for (const [path, rows] of pendingPaths) {
    const { data: file, error: downloadError } = await supabase.storage
      .from(PHOTO_BUCKET)
      .download(path);
    if (downloadError || !file) {
      console.error(`  Could not download ${path}:`, downloadError?.message);
      failed++;
      continue;
    }

    let thumb: { data: Buffer; contentType: string } | null = null;
    try {
      thumb = await generateThumb(Buffer.from(await file.arrayBuffer()));
    } catch (err) {
      console.error(`  Could not process ${path}:`, (err as Error).message);
      failed++;
      continue;
    }
    if (!thumb) {
      console.log(`  ${path}: unsupported format, skipped.`);
      skipped++;
      continue;
    }

    const thumbPath = `${path}${THUMB_SUFFIX}`;
    const { error: uploadError } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(thumbPath, thumb.data, {
        contentType: thumb.contentType,
        upsert: true,
        cacheControl: "31536000",
      });
    if (uploadError) {
      console.error(`  Could not upload ${thumbPath}:`, uploadError.message);
      failed++;
      continue;
    }

    // One update covers every row sharing this file (shared Wikimedia cache).
    const { error: updateError } = await supabase
      .from("photos")
      .update({ thumb_path: thumbPath })
      .eq("storage_path", path);
    if (updateError) {
      console.error(
        `  Could not set thumb_path for ${path}:`,
        updateError.message,
      );
      failed++;
      continue;
    }

    console.log(
      `  ${path} -> ${thumbPath} (${Math.round(thumb.data.length / 1024)} KB, ${rows.length} row(s))`,
    );
    done++;
  }

  console.log(
    `\nBackfill complete. ${done} thumbnail(s) created, ${skipped} skipped, ${failed} failed.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

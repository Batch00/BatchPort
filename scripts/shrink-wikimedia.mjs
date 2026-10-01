// Shrinks the full-resolution Wikimedia Commons originals cached under
// wikimedia/ in the batchport Storage bucket. Before the proxy learned to fetch
// a scaled rendition it stored whatever Commons served, up to 46 MB a file,
// which is what pushed the shared project past its Storage quota.
//
// For every wikimedia/ object over 1 MB: download it, fit it inside 1600x1600
// (never enlarging), re-encode as JPEG q80 (mozjpeg), and upload it back to
// the SAME path with upsert. The path is the cache key (a hash of the original
// Commons url, see storagePathForUrl in the proxy route) and photos rows point
// at it by storage_path, so nothing in the database changes. The derived
// "{path}_thumb" objects are already small and are never touched.
//
// An image whose alpha channel is actually used (some pixel not fully opaque)
// becomes WebP, which keeps the transparency; everything else becomes JPEG.
// An alpha channel that is opaque everywhere carries nothing, so those files
// take the JPEG path too. SVG and GIF are skipped (vector, and possibly
// animated). A file whose re-encode is
// not smaller than the original is left alone.
//
// Dry run by default: lists, downloads, and resizes in memory, reports the
// sizes, and uploads nothing. Write with:
//   DRY_RUN=false node scripts/shrink-wikimedia.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const PHOTO_BUCKET = "batchport";
const PREFIX = "wikimedia";
const MIN_BYTES = 1024 * 1024;
const MAX_DIM = 1600;
const QUALITY = 80;
const PAGE = 1000;

const DRY_RUN = process.env.DRY_RUN !== "false";

// Parse .env.local by hand so the script stays free of extra dependencies.
function loadEnvLocal() {
  const env = {};
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // Fall through to process.env.
  }
  return env;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

async function listAll(storage) {
  const objects = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await storage.list(PREFIX, {
      limit: PAGE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`Could not list ${PREFIX}/: ${error.message}`);
    objects.push(...data);
    if (data.length < PAGE) return objects;
  }
}

async function main() {
  const env = { ...loadEnvLocal(), ...process.env };
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
  }
  const storage = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  }).storage.from(PHOTO_BUCKET);

  console.log(DRY_RUN ? "DRY RUN: nothing will be uploaded.\n" : "WRITING.\n");

  const all = await listAll(storage);
  const targets = all.filter(
    (object) =>
      object.id && // folders have no id
      !object.name.endsWith("_thumb") &&
      (object.metadata?.size ?? 0) > MIN_BYTES,
  );
  const listedTotal = all.reduce((sum, o) => sum + (o.metadata?.size ?? 0), 0);
  console.log(
    `${all.length} object(s) under ${PREFIX}/ (${mb(listedTotal)}); ${targets.length} over ${mb(MIN_BYTES)}.\n`,
  );

  let before = 0;
  let after = 0;
  let shrunk = 0;
  let skipped = 0;
  let failed = 0;

  for (const [index, object] of targets.entries()) {
    const path = `${PREFIX}/${object.name}`;
    const size = object.metadata.size;
    const tag = `[${index + 1}/${targets.length}] ${path}`;
    before += size;

    try {
      const { data: file, error } = await storage.download(path);
      if (error || !file) throw new Error(error?.message ?? "empty download");
      const input = Buffer.from(await file.arrayBuffer());

      const meta = await sharp(input, { limitInputPixels: false }).metadata();
      if (meta.format === "svg" || meta.format === "gif") {
        console.log(`${tag}  ${mb(size)}  skipped (${meta.format})`);
        after += size;
        skipped++;
        continue;
      }

      const transparent =
        meta.hasAlpha &&
        !(await sharp(input, { limitInputPixels: false }).stats()).isOpaque;
      const pipeline = sharp(input, { limitInputPixels: false })
        .rotate() // honour EXIF orientation before it is stripped
        .resize(MAX_DIM, MAX_DIM, { fit: "inside", withoutEnlargement: true });
      const output = transparent
        ? await pipeline.webp({ quality: QUALITY }).toBuffer()
        : await pipeline
            .flatten({ background: "#ffffff" })
            .jpeg({ quality: QUALITY, mozjpeg: true })
            .toBuffer();
      const contentType = transparent ? "image/webp" : "image/jpeg";

      if (output.length >= size) {
        console.log(`${tag}  ${mb(size)}  skipped (re-encode not smaller)`);
        after += size;
        skipped++;
        continue;
      }

      if (!DRY_RUN) {
        const { error: uploadError } = await storage.upload(path, output, {
          contentType,
          upsert: true,
          cacheControl: "31536000",
        });
        if (uploadError) throw new Error(uploadError.message);
      }

      after += output.length;
      shrunk++;
      console.log(
        `${tag}  ${mb(size)} -> ${mb(output.length)}  (${meta.width}x${meta.height} ${meta.format} -> ${transparent ? "webp" : "jpeg"})`,
      );
    } catch (err) {
      after += size;
      failed++;
      console.error(`${tag}  ${mb(size)}  FAILED: ${err.message ?? err}`);
    }
  }

  console.log(
    `\n${DRY_RUN ? "Dry run" : "Done"}: ${shrunk} shrunk, ${skipped} skipped, ${failed} failed.`,
  );
  console.log(`Targeted files: ${mb(before)} -> ${mb(after)} (saves ${mb(before - after)}).`);
  console.log(
    `${PREFIX}/ total: ${mb(listedTotal)} -> ${mb(listedTotal - (before - after))}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

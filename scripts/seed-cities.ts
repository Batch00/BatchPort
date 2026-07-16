// Seed batchport.cities from the GeoNames cities15000 dataset (every city with
// a population of 15,000 or more, roughly 30,000 rows worldwide).
//
// The Discovery panel's "Top cities" section reads this table; without it the
// panel shows country info only. This is reference data, not application code:
// it talks to Supabase directly with the service-role key and does NOT need
// the dev server.
//
// Prerequisites:
//   - .env.local holds NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
//
// Run with: npm run seed-cities
//
// Idempotent: upserts on the id primary key (the GeoNames geonameid), so
// re-running updates rows in place. Safe to run repeatedly.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

import { createClient } from "@supabase/supabase-js";

const DATASET_URL = "http://download.geonames.org/export/dump/cities15000.zip";
const DATASET_FILENAME = "cities15000.txt";
const UPSERT_CHUNK_SIZE = 500;

interface CityRow {
  id: number;
  name: string;
  ascii_name: string;
  country_code: string;
  admin1: string | null;
  geom: string;
  population: number;
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

// Extract one file from a zip archive without external dependencies. Walks the
// End of Central Directory record to find the entry, then inflates it. Only
// handles stored (0) and deflated (8) entries, which covers GeoNames archives.
function extractFromZip(zip: Buffer, filename: string): Buffer {
  // Find the End of Central Directory signature (0x06054b50), scanning back
  // from the end of the archive (it is followed by a variable-length comment).
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i -= 1) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("Not a zip archive: EOCD record not found.");

  const entryCount = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16); // central directory offset

  for (let entry = 0; entry < entryCount; entry += 1) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Corrupt zip: bad central directory entry signature.");
    }
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localHeaderOffset = zip.readUInt32LE(offset + 42);
    const name = zip
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");

    if (name === filename) {
      // Sizes in the local header can live in a trailing data descriptor, so
      // reuse the reliable central-directory sizes and only read the local
      // header's name/extra lengths to locate the data.
      const localNameLength = zip.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = zip.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const data = zip.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new Error(`Unsupported zip compression method: ${method}`);
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`${filename} not found in the archive.`);
}

// GeoNames "geoname" table layout (tab-separated):
// 0 geonameid, 1 name, 2 asciiname, 3 alternatenames, 4 latitude, 5 longitude,
// 6 feature class, 7 feature code, 8 country code, 9 cc2, 10 admin1 code,
// 11-13 admin2-4, 14 population, ...
function parseCities(tsv: string): CityRow[] {
  const rows: CityRow[] = [];
  for (const line of tsv.split("\n")) {
    if (!line.trim()) continue;
    const fields = line.split("\t");
    if (fields.length < 15) continue;

    const id = Number.parseInt(fields[0], 10);
    const name = fields[1]?.trim();
    const lat = Number.parseFloat(fields[4]);
    const lng = Number.parseFloat(fields[5]);
    const countryCode = fields[8]?.trim().toUpperCase();
    const population = Number.parseInt(fields[14], 10);

    if (!Number.isInteger(id) || !name) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) continue;

    rows.push({
      id,
      name,
      ascii_name: fields[2]?.trim() || name,
      country_code: countryCode,
      admin1: fields[10]?.trim() || null,
      // Write only geom (EWKT); never latitude/longitude columns.
      geom: `SRID=4326;POINT(${lng} ${lat})`,
      population: Number.isFinite(population) ? population : 0,
    });
  }
  return rows;
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

  // Service-role client scoped to the batchport schema. Bypasses RLS.
  const supabase = createClient(supabaseUrl, serviceKey, {
    db: { schema: "batchport" },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Downloading ${DATASET_URL} ...`);
  const response = await fetch(DATASET_URL);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }
  const zip = Buffer.from(await response.arrayBuffer());
  console.log(`Downloaded ${(zip.length / 1024 / 1024).toFixed(1)} MB.`);

  const tsv = extractFromZip(zip, DATASET_FILENAME).toString("utf8");
  const rows = parseCities(tsv);
  console.log(`Parsed ${rows.length} cities. Upserting in chunks of ${UPSERT_CHUNK_SIZE}...`);

  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK_SIZE);
    const { error } = await supabase
      .from("cities")
      .upsert(chunk, { onConflict: "id" });
    if (error) {
      throw new Error(
        `Upsert failed at rows ${i}-${i + chunk.length}: ${error.message}`,
      );
    }
    upserted += chunk.length;
    if (upserted % 5000 < UPSERT_CHUNK_SIZE) {
      console.log(`  ${upserted}/${rows.length}`);
    }
  }

  console.log(`Done. Upserted ${upserted} cities.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

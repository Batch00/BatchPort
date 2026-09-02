// Load scripts/data/us-admin1.geojson into batchport.admin1_boundaries.
//
// Reference data, not application code. Talks to Supabase with the
// service-role key and does NOT need the dev server.
//
// Run with: npm run load-admin1
//
// The file is the US Census cartographic boundary file cb_2023_us_state_500k
// (1:500,000), 50 states plus DC, geometry unsimplified. It replaced Natural
// Earth 10m, which put five riverfront venues on the wrong side of a river and
// left four coastal points outside every polygon.
//
// Geometry is parsed by PostGIS, not by this script: each feature's geometry
// object is posted as jsonb to batchport.upsert_admin1_boundary, which calls
// ST_GeomFromGeoJSON. That function exists because PostgREST cannot call a
// PostGIS constructor in an insert, and the alternative was shipping multi
// megabyte WKT strings that nobody can eyeball. Nothing simplifies, snaps, or
// repairs the geometry on either side.
//
// Idempotent: the function upserts on (country_code, code).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR, adminClient } from "./places-db";

const EXPECTED_FEATURES = 51; // 50 states + DC

interface Admin1Feature {
  type: string;
  properties: { name?: string; postal?: string; type_en?: string };
  geometry: { type: string; coordinates: unknown } | null;
}

async function main(): Promise<void> {
  const supabase = adminClient();
  const path = join(DATA_DIR, "us-admin1.geojson");
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    features: Admin1Feature[];
    source?: string;
  };

  const features = parsed.features ?? [];
  console.log(`source: ${parsed.source ?? "(none recorded)"}`);
  console.log(`features in file: ${features.length}`);
  if (features.length !== EXPECTED_FEATURES) {
    // A warning, not a throw: the count is a statement about this file, and a
    // second country would legitimately change it.
    console.warn(`  warning: expected ${EXPECTED_FEATURES}`);
  }

  let written = 0;
  for (const f of features) {
    const name = f.properties?.name;
    const code = f.properties?.postal;
    if (!name || !code) {
      throw new Error(`feature is missing name or postal: ${JSON.stringify(f.properties)}`);
    }
    if (!f.geometry) throw new Error(`${name}: no geometry`);
    if (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon") {
      throw new Error(`${name}: geometry is ${f.geometry.type}, expected Polygon or MultiPolygon`);
    }

    const { error } = await supabase.rpc("upsert_admin1_boundary", {
      p_country_code: "US",
      p_code: code,
      p_name: name,
      p_geojson: f.geometry,
    });
    if (error) throw new Error(`${name}: ${error.message}`);
    written++;
    if (written % 10 === 0) console.log(`  ${written}/${features.length}`);
  }

  const { data, error } = await supabase
    .from("admin1_boundaries")
    .select("country_code, code, name")
    .order("name", { ascending: true });
  if (error) throw new Error(`read back failed: ${error.message}`);

  console.log();
  console.log(`admin1_boundaries: ${data?.length ?? 0} rows (this load wrote ${written})`);
  console.log(`  ${(data ?? []).map((r) => r.code).join(" ")}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

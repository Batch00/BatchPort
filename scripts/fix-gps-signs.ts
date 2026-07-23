// Corrective backfill for photo GPS hemisphere signs.
//
// A bug in the EXIF extractor compared GPSLatitudeRef/GPSLongitudeRef
// descriptions against "South"/"West", but exifreader reports them as
// "South latitude"/"West longitude". The negation never fired, so every
// stored gps_lat/gps_lng is positive: western and southern hemisphere photos
// were mirrored east/north (a Chicago photo at lng -87.9 landed in Xinjiang
// at lng +87.9). The extractor is fixed; this script repairs stored rows.
//
// Repair strategy, per photo with stored GPS:
// 1. Re-parse EXIF from the Storage original with the fixed extractor. If the
//    file still carries GPS (older uploads before client-side resize stripped
//    it), that value is authoritative.
// 2. Otherwise pick, among the four sign variants of the stored coordinate,
//    the one nearest the photo's owner location (experience geom, else the
//    destination, else the trip's first destination), falling back to the
//    nearest of ANY of the user's destinations (layover photos are often
//    tagged to a destination far from where they were taken). Apply only when
//    the stored variant is clearly wrong (over 500 km from every reference)
//    and the best variant is clearly right (under 500 km), so plausible
//    coordinates are never touched.
//
// Run with:  npx tsx scripts/fix-gps-signs.ts --dry-run   (report only)
//            npx tsx scripts/fix-gps-signs.ts             (apply)

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { extractExifFromBuffer } from "../src/lib/utils/exif";
import { haversineKm, parseEwkbPoint } from "../src/lib/geo";

const PHOTO_BUCKET = "batchport";
const NEAR_KM = 500;

const dryRun = process.argv.includes("--dry-run");

function loadEnvLocal(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[trimmed.slice(0, eq).trim()] = value;
    }
  } catch {
    // No .env.local: fall back to process.env.
  }
  return env;
}

interface PhotoRow {
  id: string;
  user_id: string;
  owner_type: "trip" | "destination" | "experience";
  owner_id: string;
  source: string;
  storage_path: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
}

interface DestRow {
  id: string;
  user_id: string;
  trip_id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  order_index: number;
}

interface ExpRow {
  id: string;
  destination_id: string;
  geom: string | null;
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

  const [photosResult, destsResult, expsResult] = await Promise.all([
    supabase
      .from("photos")
      .select(
        "id, user_id, owner_type, owner_id, source, storage_path, gps_lat, gps_lng",
      )
      .not("gps_lat", "is", null)
      .not("gps_lng", "is", null),
    supabase
      .from("destinations")
      .select("id, user_id, trip_id, name, latitude, longitude, order_index"),
    supabase.from("experiences").select("id, destination_id, geom"),
  ]);
  if (photosResult.error) throw photosResult.error;
  if (destsResult.error) throw destsResult.error;
  if (expsResult.error) throw expsResult.error;

  const photos = (photosResult.data ?? []) as PhotoRow[];
  const dests = (destsResult.data ?? []) as DestRow[];
  const exps = (expsResult.data ?? []) as ExpRow[];

  const destById = new Map(dests.map((d) => [d.id, d]));
  const expById = new Map(exps.map((e) => [e.id, e]));
  const firstDestByTrip = new Map<string, DestRow>();
  for (const d of [...dests].sort((a, b) => a.order_index - b.order_index)) {
    if (d.latitude === null || d.longitude === null) continue;
    if (!firstDestByTrip.has(d.trip_id)) firstDestByTrip.set(d.trip_id, d);
  }

  function ownerPoint(photo: PhotoRow): { lat: number; lng: number } | null {
    if (photo.owner_type === "experience") {
      const exp = expById.get(photo.owner_id);
      if (!exp) return null;
      const point = exp.geom ? parseEwkbPoint(exp.geom) : null;
      if (point) return point;
      const dest = destById.get(exp.destination_id);
      if (dest && dest.latitude !== null && dest.longitude !== null) {
        return { lat: dest.latitude, lng: dest.longitude };
      }
      return null;
    }
    if (photo.owner_type === "destination") {
      const dest = destById.get(photo.owner_id);
      if (dest && dest.latitude !== null && dest.longitude !== null) {
        return { lat: dest.latitude, lng: dest.longitude };
      }
      return null;
    }
    const dest = firstDestByTrip.get(photo.owner_id);
    if (dest && dest.latitude !== null && dest.longitude !== null) {
      return { lat: dest.latitude, lng: dest.longitude };
    }
    return null;
  }

  console.log(
    `${photos.length} photo(s) with stored GPS.${dryRun ? " (dry run)" : ""}`,
  );

  let fixedFromExif = 0;
  let fixedFromHeuristic = 0;
  let unchanged = 0;
  let unresolvable = 0;

  for (const photo of photos) {
    const storedLat = photo.gps_lat as number;
    const storedLng = photo.gps_lng as number;

    // 1. Authoritative: EXIF still present in the stored file.
    let corrected: { lat: number; lng: number; via: string } | null = null;
    if (photo.source === "upload" && photo.storage_path) {
      const { data: file } = await supabase.storage
        .from(PHOTO_BUCKET)
        .download(photo.storage_path);
      if (file) {
        const exif = await extractExifFromBuffer(await file.arrayBuffer());
        if (exif.gpsLat !== null && exif.gpsLng !== null) {
          corrected = { lat: exif.gpsLat, lng: exif.gpsLng, via: "exif" };
        }
      }
    }

    // 2. Heuristic: nearest sign variant to the owner location, then to any
    // of the user's destinations.
    if (!corrected) {
      const owner = ownerPoint(photo);
      const userDests = dests.filter(
        (d) =>
          d.user_id === photo.user_id &&
          d.latitude !== null &&
          d.longitude !== null,
      );
      const references: Array<{ lat: number; lng: number; via: string }> = [];
      if (owner) references.push({ ...owner, via: "owner-proximity" });
      if (userDests.length > 0) {
        references.push(
          ...userDests.map((d) => ({
            lat: d.latitude as number,
            lng: d.longitude as number,
            via: "destination-proximity",
          })),
        );
      }
      if (references.length === 0) {
        unresolvable++;
        continue;
      }
      const absLat = Math.abs(storedLat);
      const absLng = Math.abs(storedLng);
      const variants: Array<{ lat: number; lng: number }> = [
        { lat: absLat, lng: absLng },
        { lat: absLat, lng: -absLng },
        { lat: -absLat, lng: absLng },
        { lat: -absLat, lng: -absLng },
      ];
      // Minimum distance to any reference, per variant; a variant "wins" only
      // when the stored one is far from everything and it is near something.
      function minDist(v: { lat: number; lng: number }): {
        dist: number;
        via: string;
      } {
        let out = { dist: Infinity, via: "owner-proximity" };
        for (const ref of references) {
          const dist = haversineKm(v.lat, v.lng, ref.lat, ref.lng);
          if (dist < out.dist) out = { dist, via: ref.via };
        }
        return out;
      }
      let best = variants[0];
      let bestResult = minDist(best);
      for (const v of variants.slice(1)) {
        const result = minDist(v);
        if (result.dist < bestResult.dist) {
          bestResult = result;
          best = v;
        }
      }
      const storedDist = minDist({ lat: storedLat, lng: storedLng }).dist;
      if (storedDist > NEAR_KM && bestResult.dist <= NEAR_KM) {
        corrected = { lat: best.lat, lng: best.lng, via: bestResult.via };
      }
    }

    if (
      !corrected ||
      (corrected.lat === storedLat && corrected.lng === storedLng)
    ) {
      unchanged++;
      continue;
    }

    console.log(
      `  photo ${photo.id}: (${storedLat}, ${storedLng}) -> (${corrected.lat}, ${corrected.lng}) via ${corrected.via}`,
    );
    if (!dryRun) {
      const { error } = await supabase
        .from("photos")
        .update({ gps_lat: corrected.lat, gps_lng: corrected.lng })
        .eq("id", photo.id);
      if (error) {
        console.error(`  Could not update photo ${photo.id}: ${error.message}`);
        continue;
      }
    }
    if (corrected.via === "exif") fixedFromExif++;
    else fixedFromHeuristic++;
  }

  console.log(
    `\nDone. ${fixedFromExif} corrected from EXIF, ${fixedFromHeuristic} from owner proximity, ${unchanged} unchanged, ${unresolvable} with no owner coordinate to check against.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

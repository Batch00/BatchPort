// Load the seven prepared venue catalogs into batchport.
//
// Reference data, not application code. Talks to Supabase with the
// service-role key and does NOT need the dev server.
//
// Run with: npm run seed-place-catalogs
//
// Reads scripts/data/*.csv, applies scripts/data/catalog-overrides.csv, and
// writes place_catalogs, place_catalog_items, and
// place_catalog_item_memberships. See scripts/data/README.md for the shape of
// those files and for the override apply semantics this script implements.
//
// Three things it will not do:
//
//   * It never inserts a row with no coordinate. A venue whose Wikidata item
//     had no P625 is in scripts/data/missing-coords.csv, deliberately not in a
//     catalog file, and if one ever appears in a catalog file this script
//     throws with the row named rather than writing a null island.
//
//   * It never deletes. A catalog item or membership present in the database
//     and absent from the CSVs is REPORTED, not removed: a stale membership is
//     harmless and recoverable, while deleting a catalog item silently unlinks
//     it from whatever user places point at it (the FK is on delete set null,
//     so it would not even error).
//
//   * It never duplicates a venue. 695 CSV rows collapse to 672 buildings
//     keyed on wikidata_qid, and the duplication the files carry becomes 695
//     membership rows.

import { join } from "node:path";

import { DATA_DIR, adminClient, chunked, ewktPoint, readCsvObjects } from "./places-db";

const CATALOG_HEADER = [
  "wikidata_qid", "catalog_slug", "name", "lat", "lng", "city", "state",
  "country_code", "tenants", "leagues",
] as const;
const OVERRIDE_HEADER = [
  "wikidata_qid", "catalog_slug", "field", "value", "reason",
] as const;

const UPSERT_CHUNK_SIZE = 500;

// denominator_note is prose, not a number, because the honest denominator is
// not always the obvious one. Each note says what "all of them" means for this
// catalog and where the loaded count differs from the real-world count.
interface CatalogSeed {
  slug: string;
  label: string;
  denominator_note: string;
  sort_order: number;
}

const CATALOGS: CatalogSeed[] = [
  {
    slug: "national_parks",
    label: "US National Parks",
    denominator_note:
      "63 designated National Parks, the full NPS list. Includes the two territory parks (American Samoa, Virgin Islands), which have no US state and are expected to fall outside state coverage.",
    sort_order: 1,
  },
  {
    slug: "mlb",
    label: "MLB Ballparks",
    denominator_note: "30 clubs in 30 ballparks. Club count and building count agree.",
    sort_order: 2,
  },
  {
    slug: "nfl",
    label: "NFL Stadiums",
    denominator_note:
      "32 clubs in 30 stadiums: the Giants and Jets share MetLife, the Rams and Chargers share SoFi. Completion is against 30 buildings, not 32 clubs.",
    sort_order: 3,
  },
  {
    slug: "nba",
    label: "NBA Arenas",
    denominator_note:
      "30 clubs in 30 arenas, once the Clippers are corrected from Crypto.com Arena to Intuit Dome (see catalog-overrides.csv). Crypto.com Arena remains in this catalog for the Lakers.",
    sort_order: 4,
  },
  {
    slug: "nhl",
    label: "NHL Arenas",
    denominator_note:
      "32 clubs in 32 arenas. Seven are in Canada and are expected to fall outside US state coverage.",
    sort_order: 5,
  },
  {
    slug: "ncaa_fbs_football",
    label: "NCAA FBS Football Stadiums",
    denominator_note:
      "138 FBS schools as of the 2025 season, per the source list. Two stadiums have no Wikidata match and sit in missing-coords.csv, so the loaded denominator is 136 until they are filled in by hand.",
    sort_order: 6,
  },
  {
    slug: "ncaa_basketball_arenas",
    label: "NCAA Division I Basketball Arenas",
    denominator_note:
      "One building per Division I program's primary home arena; men's and women's programs sharing a venue count once, and a split home schedule takes the campus venue. 382 source rows, of which 8 have no Wikidata match and sit in missing-coords.csv, so the loaded denominator is 374.",
    sort_order: 7,
  },
];

const CATALOG_SLUGS = CATALOGS.map((c) => c.slug);

type Row = Record<string, string>;

// --- Load and patch ---------------------------------------------------------

// Apply catalog-overrides.csv exactly as scripts/data/README.md documents it:
// group by the ORIGINAL wikidata_qid, apply the whole group as one patch, and
// re-key only after the group is applied.
//
// Applying row by row with a re-match between rows is the failure this
// ordering exists to prevent. The Texas Rangers group carries a wikidata_qid
// row; re-matching after it would move the key to Q24284037 and leave the
// group's remaining three rows looking up a Q1634492 that no longer exists, so
// the row would keep Choctaw Stadium's name and coordinates under Globe Life
// Field's QID. No error, just a wrong answer.
function applyOverrides(
  byCatalog: Map<string, Map<string, Row>>,
  overrides: Row[],
): { added: number; retargeted: number; patched: number } {
  const groups = new Map<string, Map<string, Row>>(); // original qid -> catalog -> patch
  for (const o of overrides) {
    if (!CATALOG_SLUGS.includes(o.catalog_slug)) {
      throw new Error(`catalog-overrides.csv: unknown catalog_slug "${o.catalog_slug}"`);
    }
    if (!(CATALOG_HEADER as readonly string[]).includes(o.field)) {
      throw new Error(`catalog-overrides.csv: unknown field "${o.field}"`);
    }
    const group = groups.get(o.wikidata_qid) ?? new Map<string, Row>();
    const patch = group.get(o.catalog_slug) ?? {};
    patch[o.field] = o.value;
    group.set(o.catalog_slug, patch);
    groups.set(o.wikidata_qid, group);
  }

  let added = 0;
  let retargeted = 0;
  let patched = 0;
  for (const [originalQid, perCatalog] of groups) {
    for (const [slug, patch] of perCatalog) {
      const rows = byCatalog.get(slug);
      if (!rows) throw new Error(`catalog-overrides.csv: no catalog file for "${slug}"`);
      let row = rows.get(originalQid);
      if (!row) {
        // A qid absent from the pull is a row to add.
        row = Object.fromEntries(CATALOG_HEADER.map((c) => [c, ""]));
        row.wikidata_qid = originalQid;
        row.catalog_slug = slug;
        rows.set(originalQid, row);
        added++;
      } else {
        patched++;
      }
      Object.assign(row, patch); // the whole group first...
      const next = patch.wikidata_qid;
      if (next && next !== originalQid) {
        // ...and only then the re-key.
        rows.delete(originalQid);
        rows.set(next, row);
        retargeted++;
      }
    }
  }
  return { added, retargeted, patched };
}

interface VenueItem {
  wikidata_qid: string;
  name: string;
  lng: number;
  lat: number;
  city: string | null;
  state: string | null;
  country_code: string;
  tenants: string[];
  catalogs: string[];
}

function collapseToVenues(byCatalog: Map<string, Map<string, Row>>): VenueItem[] {
  const venues = new Map<string, VenueItem>();
  for (const slug of CATALOG_SLUGS) {
    for (const row of byCatalog.get(slug)!.values()) {
      const qid = row.wikidata_qid;
      const label = `${slug}/${row.name || qid}`;
      if (!/^Q\d+$/.test(qid)) throw new Error(`${label}: bad wikidata_qid "${qid}"`);
      if (!row.name) throw new Error(`${label}: empty name`);

      // Fail loudly rather than inserting a null island.
      const lat = Number(row.lat);
      const lng = Number(row.lng);
      if (row.lat === "" || row.lng === "" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error(
          `${label} (${qid}): missing or unparseable coordinate (lat="${row.lat}" lng="${row.lng}"). ` +
            "A venue with no P625 belongs in scripts/data/missing-coords.csv, not in a catalog file.",
        );
      }

      // NOT NULL in the database, and load-bearing: it is the last segment of
      // places.locality_key, so a venue with no country would not group with the
      // same place picked from Photon. A gap is filled through
      // catalog-overrides.csv, never guessed here.
      if (!row.country_code) {
        throw new Error(
          `${label} (${qid}): no country_code. Wikidata P17 did not answer for it; ` +
            "add a country_code override to scripts/data/catalog-overrides.csv with the derivation in its reason.",
        );
      }

      const tenants = row.tenants ? row.tenants.split("|").filter(Boolean) : [];
      const existing = venues.get(qid);
      if (!existing) {
        venues.set(qid, {
          wikidata_qid: qid,
          name: row.name,
          lng,
          lat,
          city: row.city || null,
          state: row.state || null,
          country_code: row.country_code,
          tenants,
          catalogs: [slug],
        });
        continue;
      }

      // scripts/data/README.md makes this an invariant of the files: a venue in
      // two catalogs carries identical values in every column but catalog_slug.
      // Re-asserted here because collapsing on qid is only safe if it holds,
      // and a silent disagreement would mean one file's copy quietly winning.
      const disagreements = (
        [
          ["name", existing.name, row.name],
          ["lat", String(existing.lat), String(lat)],
          ["lng", String(existing.lng), String(lng)],
          ["city", existing.city ?? "", row.city],
          ["state", existing.state ?? "", row.state],
          ["country_code", existing.country_code, row.country_code],
        ] as const
      ).filter(([, a, b]) => a !== b);
      if (disagreements.length) {
        throw new Error(
          `${qid} (${existing.name}) differs between ${existing.catalogs.join("+")} and ${slug}: ` +
            disagreements.map(([f, a, b]) => `${f} "${a}" vs "${b}"`).join(", "),
        );
      }

      for (const t of tenants) if (!existing.tenants.includes(t)) existing.tenants.push(t);
      existing.catalogs.push(slug);
    }
  }
  return [...venues.values()].sort((a, b) => a.wikidata_qid.localeCompare(b.wikidata_qid));
}

// --- Write ------------------------------------------------------------------

async function main(): Promise<void> {
  // --dry-run does every read, the override apply, and the collapse, then
  // stops before the first write. It needs no database, which is what makes it
  // the way to check the counts before running this for real.
  const dryRun = process.argv.includes("--dry-run");

  const byCatalog = new Map<string, Map<string, Row>>();
  for (const slug of CATALOG_SLUGS) {
    const rows = readCsvObjects(join(DATA_DIR, `${slug}.csv`), CATALOG_HEADER);
    const keyed = new Map<string, Row>();
    for (const r of rows) {
      if (r.catalog_slug !== slug) {
        throw new Error(`${slug}.csv: row "${r.name}" says catalog_slug=${r.catalog_slug}`);
      }
      if (keyed.has(r.wikidata_qid)) {
        throw new Error(`${slug}.csv: ${r.wikidata_qid} appears twice`);
      }
      keyed.set(r.wikidata_qid, r);
    }
    byCatalog.set(slug, keyed);
    console.log(`  read ${slug}.csv: ${keyed.size} rows`);
  }

  const overrides = readCsvObjects(join(DATA_DIR, "catalog-overrides.csv"), OVERRIDE_HEADER);
  const applied = applyOverrides(byCatalog, overrides);
  console.log(
    `  applied catalog-overrides.csv: ${overrides.length} rows, ` +
      `${applied.patched} patched, ${applied.added} added, ${applied.retargeted} retargeted`,
  );

  const venues = collapseToVenues(byCatalog);
  const membershipCount = venues.reduce((n, v) => n + v.catalogs.length, 0);
  console.log(`  collapsed to ${venues.length} venues, ${membershipCount} memberships`);

  if (dryRun) {
    const shared = venues.filter((v) => v.catalogs.length > 1);
    console.log(`\n--dry-run: nothing written.`);
    console.log(`place_catalogs:                 ${CATALOGS.length}`);
    console.log(`place_catalog_items:            ${venues.length}`);
    console.log(`place_catalog_item_memberships: ${membershipCount}`);
    console.log(`venues in more than one catalog: ${shared.length}`);
    for (const v of shared) {
      console.log(`  ${v.wikidata_qid.padEnd(11)} ${v.name.padEnd(30)} [${v.catalogs.join(", ")}]`);
      console.log(`  ${" ".repeat(11)} tenants: ${v.tenants.join(" | ")}`);
    }
    return;
  }

  const supabase = adminClient();

  // 1. Catalogs.
  const { error: catalogError } = await supabase
    .from("place_catalogs")
    .upsert(CATALOGS, { onConflict: "slug" });
  if (catalogError) throw new Error(`place_catalogs upsert failed: ${catalogError.message}`);

  const { data: catalogRows, error: catalogReadError } = await supabase
    .from("place_catalogs")
    .select("id, slug");
  if (catalogReadError) throw new Error(`place_catalogs read failed: ${catalogReadError.message}`);
  const catalogId = new Map((catalogRows ?? []).map((c) => [c.slug as string, c.id as string]));
  for (const slug of CATALOG_SLUGS) {
    if (!catalogId.has(slug)) throw new Error(`place_catalogs is missing ${slug} after upsert`);
  }

  // 2. Venues.
  const now = new Date().toISOString();
  await chunked(venues, UPSERT_CHUNK_SIZE, async (chunk) => {
    const { error } = await supabase.from("place_catalog_items").upsert(
      chunk.map((v) => ({
        wikidata_qid: v.wikidata_qid,
        name: v.name,
        geom: ewktPoint(v.lng, v.lat),
        city: v.city,
        state: v.state,
        country_code: v.country_code,
        tenants: v.tenants,
        updated_at: now,
      })),
      { onConflict: "wikidata_qid" },
    );
    if (error) throw new Error(`place_catalog_items upsert failed: ${error.message}`);
  });

  const itemId = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("place_catalog_items")
      .select("id, wikidata_qid")
      .range(from, from + 999);
    if (error) throw new Error(`place_catalog_items read failed: ${error.message}`);
    for (const r of data ?? []) itemId.set(r.wikidata_qid as string, r.id as string);
    if (!data || data.length < 1000) break;
  }

  // 3. Memberships.
  const memberships = venues.flatMap((v) =>
    v.catalogs.map((slug) => {
      const item = itemId.get(v.wikidata_qid);
      if (!item) throw new Error(`no id for ${v.wikidata_qid} after upsert`);
      return { catalog_item_id: item, catalog_id: catalogId.get(slug)! };
    }),
  );
  await chunked(memberships, UPSERT_CHUNK_SIZE, async (chunk) => {
    const { error } = await supabase
      .from("place_catalog_item_memberships")
      .upsert(chunk, { onConflict: "catalog_item_id,catalog_id" });
    if (error) throw new Error(`memberships upsert failed: ${error.message}`);
  });

  // 4. Report, and name anything in the database that this load did not touch.
  const loadedQids = new Set(venues.map((v) => v.wikidata_qid));
  const stale = [...itemId.keys()].filter((q) => !loadedQids.has(q));
  const { count: membershipTotal } = await supabase
    .from("place_catalog_item_memberships")
    .select("id", { count: "exact", head: true });

  console.log();
  console.log(`place_catalogs:                   ${CATALOGS.length}`);
  console.log(`place_catalog_items:              ${itemId.size} (this load wrote ${venues.length})`);
  console.log(`place_catalog_item_memberships:   ${membershipTotal ?? "?"} (this load wrote ${memberships.length})`);
  if (stale.length) {
    console.log(
      `\n${stale.length} catalog item(s) in the database were not in this load and were NOT deleted:`,
    );
    for (const q of stale) console.log(`  ${q}`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

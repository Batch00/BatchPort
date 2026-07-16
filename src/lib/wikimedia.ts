import crypto from "node:crypto";

import { createAdminClient } from "@/utils/supabase/admin";
import { normalizeQuery } from "@/lib/geocode";

// Resolves the lead image (Wikidata P18) for a place name via Wikidata and
// Wikimedia Commons. Results are cached in batchport.geocode_cache under the
// "wikimedia" provider for 90 days. Server only: the cache uses the admin
// client, which bypasses row-level security.

const PROVIDER = "wikimedia";
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// Wikimedia and Wikidata ask for a descriptive User-Agent with a contact. Reuse
// the Nominatim contact string when present, otherwise fall back to a default.
const USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ??
  "BatchPort/1.0 (+https://batchport.batch-apps.com)";

export interface WikimediaPhoto {
  url: string | null;
  attribution: string | null;
  license: string | null;
}

const EMPTY: WikimediaPhoto = { url: null, attribution: null, license: null };

interface CacheRow {
  result: WikimediaPhoto;
  cached_at: string;
}

async function readCache(queryNorm: string): Promise<WikimediaPhoto | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema("batchport")
    .from("geocode_cache")
    .select("result, cached_at")
    .eq("provider", PROVIDER)
    .eq("query_norm", queryNorm)
    .order("cached_at", { ascending: false })
    .limit(1)
    .maybeSingle<CacheRow>();

  if (error || !data) return null;
  const age = Date.now() - new Date(data.cached_at).getTime();
  if (age > CACHE_TTL_MS) return null;
  return data.result;
}

async function writeCache(
  queryNorm: string,
  result: WikimediaPhoto,
): Promise<void> {
  const admin = createAdminClient();
  // Keep a single row per key: clear any prior entry, then insert the fresh one.
  await admin
    .schema("batchport")
    .from("geocode_cache")
    .delete()
    .eq("provider", PROVIDER)
    .eq("query_norm", queryNorm);

  const { error } = await admin
    .schema("batchport")
    .from("geocode_cache")
    .insert({
      provider: PROVIDER,
      query_norm: queryNorm,
      result,
      cached_at: new Date().toISOString(),
    });
  // Non-fatal, but a silently failing cache means every lookup pays the full
  // Wikidata round trip. See scripts/sql/2026-07-15-geocode-cache-providers.sql.
  if (error) {
    console.warn(`geocode_cache write failed for ${PROVIDER}:`, error.message);
  }
}

async function wikiFetch(url: string): Promise<unknown | null> {
  try {
    // Bound each call so a slow upstream never stalls destination creation.
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// Find the top Wikidata entity id (e.g. Q90 for Paris) for a free-text query.
async function findEntityId(query: string): Promise<string | null> {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(
    query,
  )}&language=en&format=json&limit=1`;
  const raw = await wikiFetch(url);
  const search = (raw as { search?: { id?: string }[] } | null)?.search;
  return search?.[0]?.id ?? null;
}

// Read the P18 (image) claim off an entity and return the Commons filename.
async function findImageFilename(entityId: string): Promise<string | null> {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${entityId}&property=P18&format=json`;
  const raw = await wikiFetch(url);
  const claims = (
    raw as {
      claims?: {
        P18?: { mainsnak?: { datavalue?: { value?: unknown } } }[];
      };
    } | null
  )?.claims?.P18;
  const value = claims?.[0]?.mainsnak?.datavalue?.value;
  return typeof value === "string" ? value : null;
}

// Build the canonical upload.wikimedia.org URL for a Commons file. The path is
// derived from the md5 of the underscore-normalized filename: first char, then
// first two chars, then the filename.
function commonsImageUrl(filename: string): string {
  const underscored = filename.replace(/ /g, "_");
  const hash = crypto.createHash("md5").update(underscored).digest("hex");
  return `https://upload.wikimedia.org/wikipedia/commons/${hash[0]}/${hash.slice(
    0,
    2,
  )}/${encodeURIComponent(underscored)}`;
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Pull author and license off the Commons extmetadata for a file.
async function findAttribution(
  filename: string,
): Promise<{ attribution: string | null; license: string | null }> {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(
    filename,
  )}&prop=imageinfo&iiprop=extmetadata&format=json`;
  const raw = await wikiFetch(url);
  const pages = (
    raw as {
      query?: {
        pages?: Record<
          string,
          {
            imageinfo?: {
              extmetadata?: Record<string, { value?: string }>;
            }[];
          }
        >;
      };
    } | null
  )?.query?.pages;
  if (!pages) return { attribution: null, license: null };
  const page = Object.values(pages)[0];
  const meta = page?.imageinfo?.[0]?.extmetadata;
  if (!meta) return { attribution: null, license: null };
  const artist = meta.Artist?.value ? stripHtml(meta.Artist.value) : null;
  const license = meta.LicenseShortName?.value
    ? stripHtml(meta.LicenseShortName.value)
    : null;
  return { attribution: artist || null, license: license || null };
}

export async function getWikimediaPhoto(query: string): Promise<WikimediaPhoto> {
  const trimmed = query.trim();
  if (!trimmed) return EMPTY;
  const queryNorm = normalizeQuery(trimmed);

  const cached = await readCache(queryNorm);
  if (cached) return cached;

  const entityId = await findEntityId(trimmed);
  if (!entityId) {
    await writeCache(queryNorm, EMPTY);
    return EMPTY;
  }

  const filename = await findImageFilename(entityId);
  if (!filename) {
    await writeCache(queryNorm, EMPTY);
    return EMPTY;
  }

  const { attribution, license } = await findAttribution(filename);
  const result: WikimediaPhoto = {
    url: commonsImageUrl(filename),
    attribution,
    license,
  };
  await writeCache(queryNorm, result);
  return result;
}

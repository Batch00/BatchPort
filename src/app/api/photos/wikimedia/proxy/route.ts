import { createHash } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";

// GET /api/photos/wikimedia/proxy?url={wikimedia_url}
// Streams a Wikimedia Commons image back to the browser. This sidesteps CORS
// and hotlinking concerns and lets the rest of the app treat Wikimedia photos
// like any other same-origin image.
//
// On the first request for a given URL the image bytes are uploaded to Supabase
// Storage under wikimedia/{sha256}.{ext} and the photos row is updated with the
// storage_path. Subsequent requests for the same URL are served as a 302
// redirect to the Supabase CDN, skipping the Wikimedia fetch entirely.
//
// The url parameter is the canonical ORIGINAL file and stays the cache key
// (the storage path hash and photos.external_url both name it), but the bytes
// fetched are a Commons-rendered thumbnail fitted inside SCALED_MAX. Originals
// run to 46 MB, and caching those is what overran the Storage quota.

const ALLOWED_PREFIX = "https://upload.wikimedia.org/";
const PHOTO_BUCKET = "batchport";

const SCALED_MAX = 1600;
// Commons serves imageinfo thumburls from its own thumbnail host.
const THUMB_PREFIXES = [ALLOWED_PREFIX, "https://thumb.wikimedia.org/"];

const USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ??
  "BatchPort/1.0 (+https://batchport.batch-apps.com)";

const CACHE_HEADERS = {
  "Cache-Control":
    "public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400",
};

function storagePathForUrl(url: string): string {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 24);
  const ext = url.split(".").pop()?.split("?")[0]?.toLowerCase() ?? "jpg";
  const safeExt = ["jpg", "jpeg", "png", "webp", "gif", "svg"].includes(ext)
    ? ext
    : "jpg";
  return `wikimedia/${hash}.${safeExt}`;
}

// The Commons filename an upload.wikimedia.org url points at, for either an
// original (/wikipedia/commons/a/ab/Name.jpg) or a thumbnail
// (/wikipedia/commons/thumb/a/ab/Name.jpg/960px-Name.jpg). Null for anything
// not on Commons, which then falls back to fetching the url as given.
function commonsFilename(url: string): string | null {
  const match = new URL(url).pathname.match(
    /^\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/,
  );
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

// Ask Commons for a rendition fitted inside SCALED_MAX x SCALED_MAX. Returns
// the original url when the file is already smaller (Commons hands that back
// as the thumburl), and null on any failure so the caller can fall back. SVG
// is left alone: its thumbnail is a PNG, and the original is small anyway.
async function scaledImageUrl(url: string): Promise<string | null> {
  const filename = commonsFilename(url);
  if (!filename || filename.toLowerCase().endsWith(".svg")) return null;
  const api = `https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(
    filename,
  )}&prop=imageinfo&iiprop=url&iiurlwidth=${SCALED_MAX}&iiurlheight=${SCALED_MAX}&format=json`;
  try {
    const response = await fetch(api, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return null;
    const raw = (await response.json()) as {
      query?: {
        pages?: Record<string, { imageinfo?: { thumburl?: string }[] }>;
      };
    };
    const pages = raw.query?.pages;
    const thumb = pages
      ? Object.values(pages)[0]?.imageinfo?.[0]?.thumburl
      : undefined;
    return thumb && THUMB_PREFIXES.some((prefix) => thumb.startsWith(prefix))
      ? thumb
      : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url || !url.startsWith(ALLOWED_PREFIX)) {
    return NextResponse.json(
      { error: "url must be a https://upload.wikimedia.org/ address" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const supabaseBase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

  // Fast path: the Storage path is derived deterministically from the URL, so
  // a cheap existence probe against the public CDN covers every image this
  // route has ever cached, including discover heroes and city photos that have
  // no photos row. On a hit, redirect to the CDN and skip Wikimedia entirely.
  const storagePath = storagePathForUrl(url);
  const cdnUrl = `${supabaseBase}/storage/v1/object/public/${PHOTO_BUCKET}/${storagePath}`;
  try {
    const probe = await fetch(cdnUrl, {
      method: "HEAD",
      signal: AbortSignal.timeout(4000),
    });
    if (probe.ok) {
      return NextResponse.redirect(cdnUrl, {
        status: 302,
        headers: CACHE_HEADERS,
      });
    }
  } catch {
    // Probe failure just means taking the slow path below.
  }

  // Fetch from Wikimedia: the scaled rendition when Commons offers one, the
  // url as given otherwise. Either way the bytes are stored under the
  // storagePath derived from the ORIGINAL url above.
  const fetchUrl = (await scaledImageUrl(url)) ?? url;
  let upstream: Response;
  try {
    upstream = await fetch(fetchUrl, { headers: { "User-Agent": USER_AGENT } });
  } catch {
    return new NextResponse(null, { status: 404 });
  }

  if (!upstream.ok || !upstream.body) {
    return new NextResponse(null, { status: 404 });
  }

  const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
  const bytes = await upstream.arrayBuffer();

  // Best-effort: upload to Storage and update the photo record. Failures are
  // swallowed so we still serve the freshly-fetched bytes. That includes the
  // bucket's file_size_limit refusing an original the scaled lookup could not
  // replace: supabase-js returns that as uploadError rather than throwing, the
  // photos row is left alone, and the image is simply served uncached.
  try {
    const { error: uploadError } = await admin.storage
      .from(PHOTO_BUCKET)
      .upload(storagePath, bytes, {
        contentType,
        upsert: true,
        // Cached Wikimedia images are keyed by content URL hash, so they are
        // immutable and can be cached for a year.
        cacheControl: "31536000",
      });

    if (uploadError) {
      console.warn(
        `wikimedia proxy: not cached (${bytes.byteLength} bytes): ${uploadError.message}`,
      );
    } else {
      await admin
        .schema("batchport")
        .from("photos")
        .update({ storage_path: storagePath })
        .eq("external_url", url)
        .eq("source", "wikimedia")
        .is("storage_path", null);
    }
  } catch {
    // Non-fatal: serve the fetched bytes regardless.
  }

  return new NextResponse(bytes, {
    headers: { "Content-Type": contentType, ...CACHE_HEADERS },
  });
}

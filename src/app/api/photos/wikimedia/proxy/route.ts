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

const ALLOWED_PREFIX = "https://upload.wikimedia.org/";
const PHOTO_BUCKET = "batchport";

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

  // Fast path: if this URL is already cached in Storage, redirect to the CDN.
  const { data: existing } = await admin
    .schema("batchport")
    .from("photos")
    .select("storage_path")
    .eq("external_url", url)
    .eq("source", "wikimedia")
    .not("storage_path", "is", null)
    .maybeSingle();

  if (existing?.storage_path) {
    const cdnUrl = `${supabaseBase}/storage/v1/object/public/${PHOTO_BUCKET}/${existing.storage_path as string}`;
    return NextResponse.redirect(cdnUrl, {
      status: 302,
      headers: CACHE_HEADERS,
    });
  }

  // Fetch from Wikimedia.
  let upstream: Response;
  try {
    upstream = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  } catch {
    return new NextResponse(null, { status: 404 });
  }

  if (!upstream.ok || !upstream.body) {
    return new NextResponse(null, { status: 404 });
  }

  const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
  const bytes = await upstream.arrayBuffer();

  // Best-effort: upload to Storage and update the photo record. Failures are
  // swallowed so we still serve the freshly-fetched bytes.
  try {
    const storagePath = storagePathForUrl(url);
    const { error: uploadError } = await admin.storage
      .from(PHOTO_BUCKET)
      .upload(storagePath, bytes, { contentType, upsert: true });

    if (!uploadError) {
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

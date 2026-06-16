import { NextResponse, type NextRequest } from "next/server";

// GET /api/photos/wikimedia/proxy?url={wikimedia_url}
// Streams a Wikimedia Commons image back to the browser. This sidesteps CORS
// and hotlinking concerns and lets the rest of the app treat Wikimedia photos
// like any other same-origin image.

const ALLOWED_PREFIX = "https://upload.wikimedia.org/";

const USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ??
  "BatchPort/1.0 (+https://batchport.batch-apps.com)";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url || !url.startsWith(ALLOWED_PREFIX)) {
    return NextResponse.json(
      { error: "url must be a https://upload.wikimedia.org/ address" },
      { status: 400 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  } catch {
    return NextResponse.json(
      { error: "Could not reach Wikimedia" },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: "Wikimedia returned an error" },
      { status: 502 },
    );
  }

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

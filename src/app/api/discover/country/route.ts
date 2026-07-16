import { NextResponse, type NextRequest } from "next/server";

import { getDiscoverCountry } from "@/lib/discover";

// GET /api/discover/country?code={ISO_alpha2}
// Aggregate payload for the Discovery panel's country view: reference row,
// Wikipedia summary, and hero photo. Cached in geocode_cache under the
// discover_country provider for 90 days. Public: it serves reference data
// only, no user state.

// Wikimedia-hosted images must be displayed through the app's proxy to avoid
// CORS and hotlinking issues. The raw URL stays in the cache; the proxied form
// is applied at response time.
function proxied(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("https://upload.wikimedia.org/")) {
    return `/api/photos/wikimedia/proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("code") ?? "";
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) {
    return NextResponse.json(
      { error: "code must be a 2-letter ISO country code" },
      { status: 400 },
    );
  }

  const country = await getDiscoverCountry(code);
  if (!country) {
    return NextResponse.json({ error: "Unknown country" }, { status: 404 });
  }

  return NextResponse.json({
    ...country,
    heroImageUrl: proxied(country.heroImageUrl),
  });
}

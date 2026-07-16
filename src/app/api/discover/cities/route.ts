import { NextResponse, type NextRequest } from "next/server";

import { getDiscoverCities } from "@/lib/discover";

// GET /api/discover/cities?code={ISO_alpha2}
// The top cities (by population) for a country, each with a best-effort
// Wikimedia photo. Returns an empty array when the cities table has no rows
// for the country; the panel then shows the country view without city cards.
// Cached in geocode_cache under the discover_cities provider for 90 days.

// Wikimedia-hosted images are rendered through the app's proxy. Raw URLs stay
// in the cache; the proxied form is applied at response time.
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

  const cities = await getDiscoverCities(code);
  return NextResponse.json(
    cities.map((city) => ({ ...city, imageUrl: proxied(city.imageUrl) })),
  );
}

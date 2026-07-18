import { NextResponse, type NextRequest } from "next/server";

import { getDiscoverPoi } from "@/lib/discover";

// GET /api/discover/poi?name={name}&lat={lat}&lng={lng}
// Aggregate payload for the Discovery panel's POI detail view: Wikipedia
// summary (direct title first, coordinate-anchored geosearch fallback), hero
// image, and nearby documented places. Cached in geocode_cache under the
// discover_poi provider for 90 days. Public: reference data only, no user
// state. Coordinates are required; they anchor the article resolution.

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
  const params = request.nextUrl.searchParams;
  const name = (params.get("name") ?? "").trim();
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));

  if (!name || name.length > 120) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lng) ||
    lng < -180 ||
    lng > 180
  ) {
    return NextResponse.json(
      { error: "lat and lng must be valid coordinates" },
      { status: 400 },
    );
  }

  const poi = await getDiscoverPoi(name, lat, lng);
  return NextResponse.json({
    ...poi,
    heroImageUrl: proxied(poi.heroImageUrl),
  });
}

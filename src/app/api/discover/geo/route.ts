import { NextResponse, type NextRequest } from "next/server";

import { getDiscoverGeoAttractions } from "@/lib/discover";

// GET /api/discover/geo?lat={lat}&lng={lng}&zoom={zoom}
// Wikipedia-documented attractions around a viewport center, for the globe's
// "Show attractions" explore layer. One geosearch request per cache miss;
// cached in geocode_cache under the discover_geo provider (see
// scripts/sql/2026-07-22-discover-geo-provider.sql for the constraint update).
// Public: reference data only, no user state.

function proxied(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("https://upload.wikimedia.org/")) {
    return `/api/photos/wikimedia/proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const zoom = Number(params.get("zoom"));

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
  if (!Number.isFinite(zoom) || zoom < 10 || zoom > 24) {
    return NextResponse.json(
      { error: "zoom must be at least 10" },
      { status: 400 },
    );
  }

  const attractions = await getDiscoverGeoAttractions(lat, lng, zoom);
  return NextResponse.json(
    attractions.map((attraction) => ({
      ...attraction,
      thumbnailUrl: proxied(attraction.thumbnailUrl),
    })),
  );
}

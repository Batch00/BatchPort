import { NextResponse, type NextRequest } from "next/server";

import { getDiscoverCity } from "@/lib/discover";

// GET /api/discover/city?name={name}&lat={lat}&lng={lng}&code={ISO_alpha2}
// Aggregate payload for the Discovery panel's city view: Wikipedia summary,
// hero photo, and POI highlights (Photon canned queries near the coordinates).
// Cached in geocode_cache under the discover_city provider for 90 days.
// Public: reference data only, no user state.

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
  const code = (params.get("code") ?? "").trim().toUpperCase();
  const latRaw = params.get("lat");
  const lngRaw = params.get("lng");

  if (!name || name.length > 120) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  // code and coordinates are optional (bucket list places can lack either);
  // when present they must be valid.
  if (code && !/^[A-Z]{2}$/.test(code)) {
    return NextResponse.json(
      { error: "code must be a 2-letter ISO country code" },
      { status: 400 },
    );
  }
  let lat: number | null = null;
  let lng: number | null = null;
  if (latRaw !== null || lngRaw !== null) {
    lat = Number(latRaw);
    lng = Number(lngRaw);
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
  }

  const city = await getDiscoverCity(name, lat, lng, code || null);
  return NextResponse.json({
    ...city,
    heroImageUrl: proxied(city.heroImageUrl),
    pois: city.pois.map((poi) => ({
      ...poi,
      imageUrl: proxied(poi.imageUrl),
    })),
  });
}

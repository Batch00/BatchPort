import { NextResponse, type NextRequest } from "next/server";

import { parseNominatim, readCache, writeCache } from "@/lib/geocode";

// GET /api/geocode/lookup?lat={lat}&lng={lng}
// Reverse lookup used to confirm a typeahead selection and fetch canonical
// details. Backed by Nominatim, cached in batchport.geocode_cache. Public.
export async function GET(request: NextRequest) {
  const latParam = request.nextUrl.searchParams.get("lat");
  const lngParam = request.nextUrl.searchParams.get("lng");
  const lat = Number(latParam);
  const lng = Number(lngParam);

  if (
    latParam === null ||
    lngParam === null ||
    Number.isNaN(lat) ||
    Number.isNaN(lng)
  ) {
    return NextResponse.json(
      { error: "lat and lng are required numbers" },
      { status: 400 },
    );
  }

  const userAgent = process.env.NOMINATIM_USER_AGENT;
  if (!userAgent) {
    return NextResponse.json(
      {
        error:
          "Reverse geocoding is unavailable: NOMINATIM_USER_AGENT is not configured.",
      },
      { status: 500 },
    );
  }

  const queryNorm = `${lat},${lng}`;

  const cached = await readCache("nominatim", queryNorm);
  if (cached) {
    return NextResponse.json(parseNominatim(cached, lat, lng));
  }

  let raw: unknown;
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
    // Nominatim requires a descriptive User-Agent and allows 1 request/second.
    // The cache keeps repeat lookups off the network, so a single uncached
    // request per selection stays well within that limit.
    const response = await fetch(url, {
      headers: { "User-Agent": userAgent, Accept: "application/json" },
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: "Reverse geocoding provider error" },
        { status: 502 },
      );
    }
    raw = await response.json();
  } catch {
    return NextResponse.json(
      { error: "Could not reach the reverse geocoding provider" },
      { status: 502 },
    );
  }

  const parsed = parseNominatim(raw, lat, lng);
  await writeCache("nominatim", queryNorm, raw, {
    lat,
    lng,
    country_code: parsed.country_code,
  });

  return NextResponse.json(parsed);
}

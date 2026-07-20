import { NextResponse, type NextRequest } from "next/server";

import { getDiscoverClimate } from "@/lib/discover";

// GET /api/discover/climate?lat={lat}&lng={lng}&month={1-12}
// Typical conditions for a month at a location: average daily high/low (°C)
// and wet days per month, derived from a decade of Open-Meteo ERA5 archive
// data and averaged server-side. Cached in geocode_cache under the
// discover_climate provider (rounded coordinates + month). Public: reference
// data only, no user state.

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const month = Number(params.get("month"));

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
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json(
      { error: "month must be an integer from 1 to 12" },
      { status: 400 },
    );
  }

  const climate = await getDiscoverClimate(lat, lng, month);
  if (!climate) {
    return NextResponse.json(
      { error: "No climate data available" },
      { status: 404 },
    );
  }
  return NextResponse.json(climate);
}

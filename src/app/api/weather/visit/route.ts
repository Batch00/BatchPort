import { NextResponse, type NextRequest } from "next/server";

import { getVisitWeather, isIsoDate } from "@/lib/weather";

// GET /api/weather/visit?lat={lat}&lng={lng}&start={YYYY-MM-DD}&end={YYYY-MM-DD}
// Observed daily high, low, and precipitation for the days someone was at a
// place, from the Open-Meteo ERA5 archive and cached in geocode_cache under the
// weather_visit provider. Public: reference data for a coordinate and a past
// date range, no user state, which is what lets the demo and share surfaces
// render the same line.
//
// 204 rather than 404 when there is nothing to say (a window still inside the
// archive lag, an upstream miss): the caller's answer is "omit the line", not
// "something went wrong".

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const start = params.get("start") ?? "";
  const end = params.get("end") ?? "";

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
  if (!isIsoDate(start) || !isIsoDate(end) || end < start) {
    return NextResponse.json(
      { error: "start and end must be YYYY-MM-DD dates, start first" },
      { status: 400 },
    );
  }

  const weather = await getVisitWeather(lat, lng, start, end);
  if (!weather) return new NextResponse(null, { status: 204 });
  return NextResponse.json(weather);
}

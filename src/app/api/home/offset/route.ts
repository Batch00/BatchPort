import { NextResponse, type NextRequest } from "next/server";

import { requireUser } from "@/lib/current-user";
import { getHomeLocation } from "@/lib/home-location";
import { getLocationUtcOffsetSeconds } from "@/lib/discover";

// GET /api/home/offset?lat={lat}&lng={lng}
//
// How many hours ahead of (or behind) home the given coordinates are. Returns
// { offsetHours: null } for every "cannot say" case: no home location set, or
// either side's timezone not resolvable. The caller renders nothing in that
// case, which is the whole degradation story for this feature.
//
// Both offsets come from the Open-Meteo climate lookup's utc_offset_seconds,
// so this adds no new upstream integration and warms the same cache rows the
// climate line uses.

const NO_OFFSET = { offsetHours: null } as const;

export async function GET(request: NextRequest) {
  const lat = Number(request.nextUrl.searchParams.get("lat"));
  const lng = Number(request.nextUrl.searchParams.get("lng"));
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return NextResponse.json(
      { error: "lat and lng are required" },
      { status: 400 },
    );
  }

  let userId: string;
  try {
    userId = (await requireUser()).user.id;
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const home = await getHomeLocation(userId);
  if (!home) return NextResponse.json(NO_OFFSET);

  const [there, here] = await Promise.all([
    getLocationUtcOffsetSeconds(lat, lng),
    getLocationUtcOffsetSeconds(home.lat, home.lng),
  ]);
  if (there === null || here === null) return NextResponse.json(NO_OFFSET);

  // Quarter-hour zones exist (Nepal, Chatham Islands), so keep the fraction.
  const offsetHours = Math.round(((there - here) / 3600) * 4) / 4;
  return NextResponse.json({ offsetHours });
}

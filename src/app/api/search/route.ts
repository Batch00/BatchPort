import { NextResponse, type NextRequest } from "next/server";

import { searchUserData } from "@/lib/search";
import { EMPTY_SEARCH_RESULTS, SEARCH_MIN_CHARS } from "@/lib/search-types";

// GET /api/search?q={term}
//
// Searches the caller's own trips, destinations, experiences, and bucket list.
// There is no user parameter: searchUserData reads through the session-scoped
// client, so RLS is the access boundary and no request can name another
// account. Distinct from /api/geocode/search, which finds places in the world.

export async function GET(request: NextRequest) {
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (query.length < SEARCH_MIN_CHARS) {
    return NextResponse.json(EMPTY_SEARCH_RESULTS);
  }

  try {
    const results = await searchUserData(query);
    return NextResponse.json(results, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
}

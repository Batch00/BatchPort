import { NextResponse, type NextRequest } from "next/server";

import { getWikimediaPhoto } from "@/lib/wikimedia";

// GET /api/photos/wikimedia?q={query}
// Returns the Wikidata P18 lead image for a place plus basic attribution,
// cached in batchport.geocode_cache. Public: backs the cover-photo suggestion
// and the destination auto-populate flow.
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q");
  if (!query || !query.trim()) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }

  const photo = await getWikimediaPhoto(query);
  return NextResponse.json(photo);
}

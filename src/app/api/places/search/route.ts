import { NextResponse, type NextRequest } from "next/server";

import { PLACES_ENABLED } from "@/lib/features";
import { searchCatalog, searchPhotonPlaces } from "@/lib/place-search-data";
import { rankPlaceResults, SEARCH_MIN_CHARS } from "@/lib/place-search";

// GET /api/places/search?q={query}&lat={lat}&lng={lng}
//
// The one search behind the log-a-place sheet. Fans out to the tracked venue
// catalog and to Photon, and returns one merged, ranked list; see
// lib/place-search.ts for the ranking rule and why a weak catalog match sits
// below Photon rather than above it.
//
// NOT public, unlike the /api/geocode/* routes. It reads the caller's own
// session-scoped client for the catalog half, so the proxy's default protection
// is what it wants: an unauthenticated request is redirected to / and never
// reaches this handler. Nothing here reads user rows, but there is also no
// reason for a signed-out visitor to have it.
//
// Behind the feature flag, so with the flag off this endpoint 404s and the app
// gains no new surface at all.
export async function GET(request: NextRequest) {
  if (!PLACES_ENABLED) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const params = request.nextUrl.searchParams;
  const query = (params.get("q") ?? "").trim();
  if (query.length < SEARCH_MIN_CHARS) {
    return NextResponse.json([]);
  }

  // Optional map or device bias, exactly as the POI route takes it.
  const latRaw = params.get("lat");
  const lngRaw = params.get("lng");
  const lat = latRaw !== null && Number.isFinite(Number(latRaw)) ? Number(latRaw) : null;
  const lng = lngRaw !== null && Number.isFinite(Number(lngRaw)) ? Number(lngRaw) : null;
  const bias = lat !== null && lng !== null ? { lat, lng } : undefined;

  // Both halves run together: the catalog read is a local index hit and Photon
  // is a network call, so waiting for one before starting the other would make
  // every keystroke cost the sum rather than the max.
  //
  // allSettled, not all: a Photon outage or a catalog error must degrade the
  // list to the half that answered rather than fail the search. searchPhoton
  // already swallows its own network errors; this covers the catalog half and
  // anything unexpected.
  const [catalogResult, photonResult] = await Promise.allSettled([
    searchCatalog(query),
    searchPhotonPlaces(query, bias),
  ]);

  if (catalogResult.status === "rejected" && photonResult.status === "rejected") {
    return NextResponse.json({ error: "Search is unavailable" }, { status: 502 });
  }

  const catalogItems = catalogResult.status === "fulfilled" ? catalogResult.value : [];
  const photonHits = photonResult.status === "fulfilled" ? photonResult.value : [];

  return NextResponse.json(rankPlaceResults(query, catalogItems, photonHits));
}

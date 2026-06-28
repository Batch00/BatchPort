import { NextResponse, type NextRequest } from "next/server";

import {
  normalizeQuery,
  parsePhotonPoi,
  readCache,
  writeCache,
} from "@/lib/geocode";

// GET /api/geocode/poi?q={query}&lat={lat}&lng={lng}
// POI typeahead backed by Photon, biased toward places near the destination so
// "Royal Palace" returns the one in the current city. Cached in
// batchport.geocode_cache under the "photon_poi" provider. Public (no auth):
// all geocoding runs server-side.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query = (params.get("q") ?? "").trim();
  if (query.length < 2) {
    return NextResponse.json([]);
  }

  const latRaw = params.get("lat");
  const lngRaw = params.get("lng");
  const lat =
    latRaw !== null && Number.isFinite(Number(latRaw)) ? Number(latRaw) : null;
  const lng =
    lngRaw !== null && Number.isFinite(Number(lngRaw)) ? Number(lngRaw) : null;

  // The bias is part of the cache key so the same query near different cities
  // does not collide.
  const queryNorm =
    lat !== null && lng !== null
      ? `${normalizeQuery(query)}@${lat.toFixed(2)},${lng.toFixed(2)}`
      : normalizeQuery(query);

  const cached = await readCache("photon_poi", queryNorm);
  if (cached) {
    return NextResponse.json(parsePhotonPoi(cached));
  }

  let raw: unknown;
  try {
    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "8");
    url.searchParams.set("lang", "en");
    if (lat !== null && lng !== null) {
      url.searchParams.set("lat", String(lat));
      url.searchParams.set("lon", String(lng));
    }
    // man_made is added beyond the suggested set: famous landmarks such as the
    // Eiffel Tower use man_made=tower as their primary OSM tag and would
    // otherwise be filtered out.
    for (const tag of [
      "tourism",
      "amenity",
      "leisure",
      "historic",
      "building",
      "man_made",
    ]) {
      url.searchParams.append("osm_tag", tag);
    }

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: "Geocoding provider error" },
        { status: 502 },
      );
    }
    raw = await response.json();
  } catch {
    return NextResponse.json(
      { error: "Could not reach the geocoding provider" },
      { status: 502 },
    );
  }

  await writeCache(
    "photon_poi",
    queryNorm,
    raw,
    lat !== null && lng !== null ? { lat, lng } : undefined,
  );

  return NextResponse.json(parsePhotonPoi(raw));
}

import { NextResponse, type NextRequest } from "next/server";

import {
  normalizeQuery,
  parsePhoton,
  readCache,
  writeCache,
} from "@/lib/geocode";

// GET /api/geocode/search?q={query}
// Typeahead endpoint backed by Photon, cached in batchport.geocode_cache for 30
// days. Public (no auth): all geocoding runs server-side so the provider is
// never called from the browser. The client should debounce by 300ms.
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const trimmed = query.trim();

  // The component enforces a 2-character minimum; guard the server too.
  if (trimmed.length < 2) {
    return NextResponse.json([]);
  }

  const queryNorm = normalizeQuery(trimmed);

  const cached = await readCache("photon", queryNorm);
  if (cached) {
    return NextResponse.json(parsePhoton(cached));
  }

  let raw: unknown;
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(
      trimmed,
    )}&limit=5&lang=en`;
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

  // Cache the raw provider payload so future parses stay consistent.
  await writeCache("photon", queryNorm, raw);

  return NextResponse.json(parsePhoton(raw));
}

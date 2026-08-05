// The country polygons every composition draws on, loaded from the same
// public/data/countries.geojson the globe already uses.
//
// It is a precached service worker asset, so this fetch is a cache read on any
// device that has opened the app before, and the poster renders with no
// connection at all. The country-code property is ISO_A2_EH, not ISO_A2:
// ISO_A2 is empty for a handful of entries (France and Norway among them) and
// matching on it silently loses them.

export interface CountryShape {
  /** ISO 3166-1 alpha-2, uppercase. Empty for unclaimed territory. */
  code: string;
  name: string;
  /** Each ring is a closed [lng, lat] loop; holes are ignored (invisible at
   * poster scale, and Natural Earth's 110m set has almost none). */
  rings: [number, number][][];
}

interface RawFeature {
  properties?: Record<string, unknown> | null;
  geometry?: {
    type?: string;
    coordinates?: unknown;
  } | null;
}

let cache: CountryShape[] | null = null;
let inFlight: Promise<CountryShape[]> | null = null;

function ringsOf(geometry: RawFeature["geometry"]): [number, number][][] {
  if (!geometry) return [];
  const rings: [number, number][][] = [];
  const collect = (ring: unknown) => {
    if (!Array.isArray(ring)) return;
    const points: [number, number][] = [];
    for (const position of ring) {
      if (!Array.isArray(position) || position.length < 2) continue;
      const lng = Number(position[0]);
      const lat = Number(position[1]);
      if (Number.isFinite(lng) && Number.isFinite(lat)) points.push([lng, lat]);
    }
    if (points.length > 2) rings.push(points);
  };

  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    // Only the outer ring: a hole at 110m detail is at most a few pixels.
    collect(geometry.coordinates[0]);
  } else if (
    geometry.type === "MultiPolygon" &&
    Array.isArray(geometry.coordinates)
  ) {
    for (const polygon of geometry.coordinates) {
      if (Array.isArray(polygon)) collect(polygon[0]);
    }
  }
  return rings;
}

/** Load and normalize the country shapes. Cached for the page's lifetime. */
export async function loadCountryShapes(): Promise<CountryShape[]> {
  if (cache) return cache;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const response = await fetch("/data/countries.geojson");
    if (!response.ok) throw new Error("Country outlines could not be loaded.");
    const payload = (await response.json()) as { features?: RawFeature[] };
    const shapes: CountryShape[] = [];
    for (const feature of payload.features ?? []) {
      const properties = feature.properties ?? {};
      const rings = ringsOf(feature.geometry);
      if (rings.length === 0) continue;
      const rawCode = properties.ISO_A2_EH;
      const code =
        typeof rawCode === "string" && /^[A-Za-z]{2}$/.test(rawCode)
          ? rawCode.toUpperCase()
          : "";
      const name =
        typeof properties.NAME === "string" ? properties.NAME : code || "";
      shapes.push({ code, name, rings });
    }
    cache = shapes;
    inFlight = null;
    return shapes;
  })();

  try {
    return await inFlight;
  } catch (error) {
    inFlight = null;
    throw error;
  }
}

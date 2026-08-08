"use client";

// The photograph that stands for one bucket list place.
//
// Two surfaces ask for it, the bucket cards and the recap's closing slide, and
// they have to agree: the same place showing a different picture on the card
// and in the recap would read as a bug even though both are "a picture of
// Patagonia". So the lookup and its session cache live here rather than being
// written twice.
//
// Both routes are public (see proxy.ts) and both cache server-side in
// geocode_cache, which is what lets /demo and /share render this too. The map
// below only avoids repeat round trips within one browser session: cards
// remount on every router.refresh, and re-fetching each image every time is a
// skeleton flash for no reason.

export interface BucketHeroKey {
  type: "country" | "place";
  countryCode: string | null;
  placeName: string | null;
}

const cache = new Map<string, string | null>();

export function bucketHeroKey(item: BucketHeroKey): string {
  return item.type === "country"
    ? `country:${item.countryCode ?? ""}`
    : `place:${item.placeName ?? ""}:${item.countryCode ?? ""}`;
}

export function cachedBucketHero(key: string): string | null | undefined {
  return cache.get(key);
}

export function hasCachedBucketHero(key: string): boolean {
  return cache.has(key);
}

export function rememberBucketHero(key: string, url: string | null): void {
  cache.set(key, url);
}

/** Resolve the hero image url, already proxied where it needs to be, or null
 * when the place has no lead image. Never throws for a miss: the callers all
 * degrade to their own gradient. */
export async function fetchBucketHero(
  item: BucketHeroKey,
): Promise<string | null> {
  if (item.type === "country") {
    if (!item.countryCode) return null;
    const response = await fetch(
      `/api/discover/country?code=${item.countryCode}`,
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { heroImageUrl?: string | null };
    // Already proxied by the discover route.
    return data.heroImageUrl ?? null;
  }
  if (!item.placeName) return null;
  const response = await fetch(
    `/api/photos/wikimedia?q=${encodeURIComponent(item.placeName)}`,
  );
  if (!response.ok) return null;
  const data = (await response.json()) as { url?: string | null };
  if (!data.url) return null;
  return `/api/photos/wikimedia/proxy?url=${encodeURIComponent(data.url)}`;
}

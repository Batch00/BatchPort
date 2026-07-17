// Client-safe helpers for the bucket list UI. Kept separate from bucket-list.ts
// so client components can import these without pulling in server-only code.

// The display name for a bucket item: the country or place it points at.
export function bucketItemName(item: {
  type: "country" | "place";
  country_name: string | null;
  country_code: string | null;
  place_name: string | null;
}): string {
  if (item.type === "country") {
    return item.country_name ?? item.country_code ?? "Country";
  }
  return item.place_name ?? "Place";
}

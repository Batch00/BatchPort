// Client-safe helpers for the bucket list UI. Kept separate from bucket-list.ts
// so client components can import these without pulling in server-only code.

export interface PriorityOption {
  value: number;
  label: string;
}

// Higher value means higher priority, so the list sorts these top to bottom.
export const PRIORITY_OPTIONS: PriorityOption[] = [
  { value: 5, label: "Must visit" },
  { value: 4, label: "High" },
  { value: 3, label: "Medium" },
  { value: 2, label: "Low" },
  { value: 1, label: "Someday" },
];

export function priorityLabel(value: number | null): string | null {
  if (value === null) return null;
  return PRIORITY_OPTIONS.find((option) => option.value === value)?.label ?? null;
}

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

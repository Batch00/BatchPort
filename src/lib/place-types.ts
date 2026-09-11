import type { PlaceType } from "@/lib/types";

// The place_type vocabulary, with the labels the UI shows. Pure and
// client-safe.
//
// "stadium" is labelled "Sports venue" on purpose. It covers every tracked
// venue that is not a national park, arenas included, and the label is where
// that semantics is visible to whoever is picking. See the note in CLAUDE.md:
// there is deliberately no separate "arena" value, because no surface asks the
// difference.
export const PLACE_TYPES: { type: PlaceType; label: string }[] = [
  { type: "city", label: "City" },
  { type: "stadium", label: "Sports venue" },
  { type: "park", label: "Park" },
  { type: "campus", label: "Campus" },
  { type: "landmark", label: "Landmark" },
  { type: "other", label: "Other" },
];

const LABELS = new Map(PLACE_TYPES.map((p) => [p.type, p.label]));

export function placeTypeLabel(type: PlaceType): string {
  return LABELS.get(type) ?? "Place";
}

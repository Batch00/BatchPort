// Superlatives derived from rated experiences. Pure functions over rows the
// caller already fetched: no new SQL view, because one narrow query returns
// every rated experience a personal travel log will ever hold and the
// top-N-per-category grouping is a few lines of JavaScript over it.
//
// Ratings are the raw smallint 1-10 (each step is half a star) throughout;
// only the display layer divides by two.

import type { DestinationWithExperiences } from "@/lib/types";

export interface RatedExperience {
  id: string;
  name: string;
  /** Raw smallint 1-10. */
  rating: number;
  categorySlug: string | null;
  categoryLabel: string | null;
  categoryColor: string | null;
  /** The lucide icon slug from categories.icon, for CategoryIcon. */
  categoryIcon: string | null;
  destinationId: string;
  destinationName: string;
  tripId: string;
  tripName: string;
  visitedDate: string | null;
}

export interface CategoryBest {
  slug: string;
  label: string;
  color: string | null;
  icon: string | null;
  experience: RatedExperience;
}

export interface Superlatives {
  /** Highest rated overall, best first, capped at ten. */
  top: RatedExperience[];
  /** The single highest rated experience in each category that has one. */
  bestPerCategory: CategoryBest[];
  /** Genuinely low-rated entries only, worst first. Empty when nothing
   * qualifies, which is the common case for a well-curated log. */
  disappointments: RatedExperience[];
}

const TOP_COUNT = 10;
const DISAPPOINTMENT_COUNT = 3;
// Two stars out of five. Above this a rating is "fine", not a disappointment,
// and calling it one would be putting words in the user's mouth.
const DISAPPOINTMENT_MAX_RATING = 4;
// A single bad meal is not a pattern. Below this many rated experiences the
// section stays hidden rather than singling out one entry.
const DISAPPOINTMENT_MIN_POOL = 5;

// Later ties lose: sorting is stable, so equal ratings keep their incoming
// order (most recent first from the query).
function byRatingDesc(a: RatedExperience, b: RatedExperience): number {
  return b.rating - a.rating;
}

export function buildSuperlatives(rows: RatedExperience[]): Superlatives {
  const sorted = [...rows].sort(byRatingDesc);

  const bestBySlug = new Map<string, CategoryBest>();
  for (const experience of sorted) {
    const slug = experience.categorySlug;
    if (!slug || bestBySlug.has(slug)) continue;
    bestBySlug.set(slug, {
      slug,
      label: experience.categoryLabel ?? slug,
      color: experience.categoryColor,
      icon: experience.categoryIcon,
      experience,
    });
  }

  const disappointments =
    rows.length >= DISAPPOINTMENT_MIN_POOL
      ? [...sorted]
          .reverse()
          .filter(
            (experience) => experience.rating <= DISAPPOINTMENT_MAX_RATING,
          )
          .slice(0, DISAPPOINTMENT_COUNT)
      : [];

  return {
    top: sorted.slice(0, TOP_COUNT),
    // Strongest category winner first, so the list opens on a high note.
    bestPerCategory: [...bestBySlug.values()].sort((a, b) =>
      byRatingDesc(a.experience, b.experience),
    ),
    disappointments,
  };
}

export function hasSuperlatives(superlatives: Superlatives): boolean {
  return superlatives.top.length > 0;
}

// --- Per-trip highlights -----------------------------------------------------

export interface TripHighlight {
  id: string;
  name: string;
  rating: number;
  destinationName: string;
}

const TRIP_HIGHLIGHT_COUNT = 3;
// One rated stop is not a ranking. Two is the minimum for "the best of".
const TRIP_HIGHLIGHT_MIN_POOL = 2;

/** The best-rated experiences on one trip, from the destination rows the trip
 * page has already loaded. Empty when there is nothing worth ranking. */
export function tripHighlights(
  destinations: DestinationWithExperiences[],
): TripHighlight[] {
  const rated: TripHighlight[] = [];
  for (const destination of destinations) {
    for (const experience of destination.experiences) {
      if (experience.status === "planned") continue;
      if (experience.rating === null) continue;
      rated.push({
        id: experience.id,
        name: experience.name,
        rating: experience.rating,
        destinationName: destination.name,
      });
    }
  }
  if (rated.length < TRIP_HIGHLIGHT_MIN_POOL) return [];
  return rated
    .sort((a, b) => b.rating - a.rating)
    .slice(0, TRIP_HIGHLIGHT_COUNT);
}

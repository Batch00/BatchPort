// Client-safe shapes for the global search. Kept apart from search.ts, which
// imports the cookie-backed Supabase client and therefore cannot be pulled
// into a Client Component even for a type-only import.

export const SEARCH_MIN_CHARS = 2;

export type SearchResultKind =
  | "trip"
  | "destination"
  | "experience"
  | "bucket";

export interface SearchResult {
  kind: SearchResultKind;
  id: string;
  title: string;
  /** Where this thing lives: "Rome · Italy 2024". */
  context: string | null;
  /** The matching note excerpt, when the name did not match. */
  excerpt: string | null;
  href: string;
  /** Raw smallint 1-10, experiences only. */
  rating?: number | null;
  countryCode?: string | null;
}

export interface SearchResults {
  trips: SearchResult[];
  destinations: SearchResult[];
  experiences: SearchResult[];
  bucket: SearchResult[];
}

export const EMPTY_SEARCH_RESULTS: SearchResults = {
  trips: [],
  destinations: [],
  experiences: [],
  bucket: [],
};

export function isSearchEmpty(results: SearchResults): boolean {
  return (
    results.trips.length === 0 &&
    results.destinations.length === 0 &&
    results.experiences.length === 0 &&
    results.bucket.length === 0
  );
}

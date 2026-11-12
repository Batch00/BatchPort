import { requireUser } from "@/lib/current-user";
import {
  COUNTRY_PARAM,
  EMPTY_SEARCH_RESULTS,
  SEARCH_MIN_CHARS,
  type SearchResult,
  type SearchResults,
} from "@/lib/search-types";

// Search across the user's OWN data: trips, destinations, experiences, and the
// bucket list, matching names and notes, plus the countries the user has a
// stop in, matched by country name. This is deliberately not the globe's
// geocode search, which finds places in the world; this finds things you have
// already written down.
//
// EVERY QUERY FILTERS ON user_id. RLS is not the owner filter here: the SELECT
// policies on these tables are `auth.uid() = user_id OR is_shared(user_id)`,
// and is_shared() grants the demo account and every publicly shared profile.
// Without the filter this palette returned other accounts' trips and notes to
// any signed-in user. RLS is defence in depth; see CLAUDE.md under "Search,
// Export, and Home Location".
//
// Matching is unanchored ILIKE. pg_trgm GIN indexes that serve that pattern are
// documented in scripts/sql/2026-07-29-search-indexes.sql; without them the
// queries still return the same rows, just via a sequential scan.

/** Per-group cap. The palette is a jump-to, not a report. */
const GROUP_LIMIT = 6;

// PostgREST parses .or() as a comma-separated list of filters, and a bare
// comma, parenthesis, or quote inside the value would break out of the term.
// Wrapping each value in double quotes handles those; escaping the quote
// handles the rest, so no typed character can break out of its own filter.
//
// Wildcards need separate handling, and backslash escaping does NOT work here:
// PostgREST unquotes the value before it becomes a LIKE pattern, and it also
// translates * to %. A typed "*.*" therefore reached Postgres as "%.%" and
// matched almost every row. Mapping each wildcard character to _ (match
// exactly one character) is the fix: the term can no longer match more than
// its own length, it still matches its literal self, and there is no
// trailing-backslash pattern for Postgres to reject.
const WILDCARD_CHARS = /[%_*\\]/g;

function orTerm(columns: string[], query: string): string {
  const escaped = query.replace(WILDCARD_CHARS, "_").replace(/"/g, '\\"');
  return columns.map((column) => `${column}.ilike."%${escaped}%"`).join(",");
}

/** A short window of the note around the match, so a note hit shows why. */
function excerpt(
  notes: string | null | undefined,
  query: string,
  matchedName: boolean,
): string | null {
  if (matchedName || !notes) return null;
  const index = notes.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return null;
  const start = Math.max(0, index - 30);
  const end = Math.min(notes.length, index + query.length + 60);
  const body = notes.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "..." : ""}${body}${end < notes.length ? "..." : ""}`;
}

function matches(value: string | null | undefined, query: string): boolean {
  return Boolean(value && value.toLowerCase().includes(query.toLowerCase()));
}

type SessionClient = Awaited<ReturnType<typeof requireUser>>["supabase"];

/**
 * Countries the user has at least one stop in, matched by name. A stop's own
 * name rarely contains its country ("Rome" does not match "Italy"), so without
 * this the palette could not find a country at all. Each result opens the
 * dashboard's drill-down for that country, the same panel a globe tap opens.
 *
 * Two steps because destinations carry only a country code: resolve the name
 * against the world-readable `countries` reference table, then count the
 * user's own stops in those codes. The second read is the one that touches a
 * user-owned table, and it carries the explicit owner filter.
 */
async function searchCountries(
  supabase: SessionClient,
  userId: string,
  query: string,
): Promise<SearchResult[]> {
  const { data: countryRows } = await supabase
    .from("countries")
    .select("code, name")
    // No limit: the table is about 250 rows, and a cap on a two-letter query
    // ("an") could drop the one country the user has actually been to.
    .or(orTerm(["name"], query));
  const named = (countryRows ?? []) as { code: string; name: string }[];
  if (named.length === 0) return [];

  const { data: stopRows } = await supabase
    .from("destinations")
    .select("country_code, trip_id")
    .eq("user_id", userId)
    .in("country_code", named.map((row) => row.code));
  const stops = (stopRows ?? []) as {
    country_code: string | null;
    trip_id: string;
  }[];

  type Tally = { stops: number; trips: Set<string> };
  const tally = new Map<string, Tally>();
  for (const stop of stops) {
    if (!stop.country_code) continue;
    const entry: Tally = tally.get(stop.country_code) ?? {
      stops: 0,
      trips: new Set<string>(),
    };
    entry.stops += 1;
    entry.trips.add(stop.trip_id);
    tally.set(stop.country_code, entry);
  }

  const lower = query.toLowerCase();
  return named
    .flatMap((row) => {
      const counts = tally.get(row.code);
      return counts ? [{ row, counts }] : [];
    })
    // A name that starts with the query outranks one that merely contains it
    // ("Guinea" before "Papua New Guinea"), then the country with the most
    // stops.
    .sort(
      (a, b) =>
        Number(b.row.name.toLowerCase().startsWith(lower)) -
          Number(a.row.name.toLowerCase().startsWith(lower)) ||
        b.counts.stops - a.counts.stops ||
        a.row.name.localeCompare(b.row.name),
    )
    .slice(0, GROUP_LIMIT)
    .map(({ row, counts }) => {
      const trips = counts.trips.size;
      return {
        kind: "country" as const,
        id: row.code,
        title: row.name,
        context: `${trips} ${trips === 1 ? "trip" : "trips"} · ${counts.stops} ${counts.stops === 1 ? "stop" : "stops"}`,
        excerpt: null,
        href: `/dashboard?${COUNTRY_PARAM}=${encodeURIComponent(row.code)}`,
        countryCode: row.code,
      };
    });
}

export async function searchUserData(
  rawQuery: string,
): Promise<SearchResults> {
  const query = rawQuery.trim();
  if (query.length < SEARCH_MIN_CHARS) return EMPTY_SEARCH_RESULTS;

  const { supabase, user } = await requireUser();

  // Narrow selects: only what the result row renders plus the ids needed to
  // build its href. bucket_list uses * because its notes column is optional
  // until 2026-07-16-bucket-notes.sql has run.
  const [countries, trips, destinations, experiences, bucket] = await Promise.all([
    searchCountries(supabase, user.id, query),
    supabase
      .from("trips")
      .select("id, name, notes, status, start_date, end_date")
      .eq("user_id", user.id)
      .or(orTerm(["name", "notes"], query))
      .limit(GROUP_LIMIT),
    supabase
      .from("destinations")
      .select("id, name, notes, country_code, trip_id, trips(name)")
      .eq("user_id", user.id)
      .or(orTerm(["name", "notes"], query))
      .limit(GROUP_LIMIT),
    supabase
      .from("experiences")
      .select(
        "id, name, notes, rating, destinations!inner(id, name, trip_id, trips!inner(name))",
      )
      .eq("user_id", user.id)
      .or(orTerm(["name", "notes"], query))
      .limit(GROUP_LIMIT),
    supabase
      .from("bucket_list")
      .select("*, countries(name)")
      .eq("user_id", user.id)
      .limit(200),
  ]);

  const tripRows = (trips.data ?? []) as {
    id: string;
    name: string;
    notes: string | null;
    start_date: string | null;
    end_date: string | null;
  }[];
  const destinationRows = (destinations.data ?? []) as unknown as {
    id: string;
    name: string;
    notes: string | null;
    country_code: string | null;
    trip_id: string;
    trips: { name: string } | null;
  }[];
  const experienceRows = (experiences.data ?? []) as unknown as {
    id: string;
    name: string;
    notes: string | null;
    rating: number | null;
    destinations: {
      id: string;
      name: string;
      trip_id: string;
      trips: { name: string } | null;
    } | null;
  }[];
  // The bucket list is small and its notes column may not exist, which would
  // make an .or() over it error the whole query. Filtering the fetched rows in
  // JS sidesteps that and costs nothing at these row counts.
  const bucketRows = ((bucket.data ?? []) as unknown as {
    id: string;
    type: string;
    place_name: string | null;
    country_code: string | null;
    notes?: string | null;
    fulfilled_at: string | null;
    countries: { name: string } | null;
  }[]).filter(
    (row) =>
      matches(row.place_name, query) ||
      matches(row.notes, query) ||
      matches(row.countries?.name, query),
  );

  return {
    countries,
    trips: tripRows.map((row) => {
      const year = row.start_date ? row.start_date.slice(0, 4) : null;
      return {
        kind: "trip" as const,
        id: row.id,
        title: row.name,
        context: year,
        excerpt: excerpt(row.notes, query, matches(row.name, query)),
        href: `/trips/${row.id}`,
      };
    }),
    destinations: destinationRows.map((row) => ({
      kind: "destination" as const,
      id: row.id,
      title: row.name,
      context: row.trips?.name ?? null,
      excerpt: excerpt(row.notes, query, matches(row.name, query)),
      href: `/trips/${row.trip_id}/destinations/${row.id}`,
      countryCode: row.country_code,
    })),
    experiences: experienceRows
      .filter((row) => row.destinations !== null)
      .map((row) => {
        const destination = row.destinations as NonNullable<
          typeof row.destinations
        >;
        return {
          kind: "experience" as const,
          id: row.id,
          title: row.name,
          context: [destination.name, destination.trips?.name]
            .filter(Boolean)
            .join(" · "),
          excerpt: excerpt(row.notes, query, matches(row.name, query)),
          href: `/trips/${destination.trip_id}/destinations/${destination.id}`,
          rating: row.rating,
        };
      }),
    bucket: bucketRows.slice(0, GROUP_LIMIT).map((row) => ({
      kind: "bucket" as const,
      id: row.id,
      title: row.place_name ?? row.countries?.name ?? "Bucket list item",
      context: row.fulfilled_at
        ? "Fulfilled"
        : row.place_name && row.countries?.name
          ? row.countries.name
          : null,
      excerpt: excerpt(
        row.notes,
        query,
        matches(row.place_name, query) || matches(row.countries?.name, query),
      ),
      href: "/dashboard/bucket-list",
      countryCode: row.country_code,
    })),
  };
}

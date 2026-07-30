import { createClient } from "@/utils/supabase/server";
import { getHomeLocation, type HomeLocation } from "@/lib/home-location";
import { haversineKm } from "@/lib/geo";
import {
  buildSuperlatives,
  type RatedExperience,
  type Superlatives,
} from "@/lib/superlatives";

// The server Supabase client is scoped to the batchport schema, so derive the
// parameter type from it rather than the default (public-schema) SupabaseClient.
type StatsClient = Awaited<ReturnType<typeof createClient>>;

// Server-side stats data layer. Every metric comes from a SQL view or function
// in the batchport schema, never from client-side aggregation. The server
// Supabase client is already scoped to the batchport schema, so view names and
// the f_distance_traveled RPC resolve without an explicit schema prefix.
//
// RPC note: supabase.rpc("f_distance_traveled", { p_user_id }) works directly.
// Because the client is created with db.schema = "batchport", PostgREST sends
// Content-Profile: batchport and finds the function. No wrapper is needed.

// --- Types -----------------------------------------------------------------

export interface TravelSummary {
  countries_visited: number;
  world_pct: number;
  continents_visited: number;
  total_trips: number;
  total_destinations: number;
  total_experiences: number;
  days_traveling: number;
}

export interface CategoryStat {
  slug: string;
  label: string;
  color: string;
  experience_count: number;
  avg_rating_stars: number | null;
}

export interface CountryStat {
  country_code: string;
  country_name: string;
  trips: number;
  destinations: number;
}

export interface YearStat {
  year: number;
  trips: number;
  countries: number;
  new_countries: number;
}

export interface BucketCompletion {
  total: number;
  fulfilled: number;
  completion_pct: number;
}

// A single extreme: the destination name plus the relevant coordinate value
// (latitude for north/south, longitude for east/west).
export interface ExtremeEntry {
  name: string | null;
  value: number | null;
}

export interface TravelExtremes {
  north: ExtremeEntry;
  south: ExtremeEntry;
  east: ExtremeEntry;
  west: ExtremeEntry;
}

// The destination furthest from the user's home city. Null whenever no home
// location is set, which is the default state.
export interface FurthestFromHome {
  name: string;
  distanceKm: number;
  homeLabel: string | null;
}

export interface StatsData {
  summary: TravelSummary | null;
  categories: CategoryStat[];
  countries: CountryStat[];
  yearly: YearStat[];
  bucket: BucketCompletion | null;
  extremes: TravelExtremes;
  distanceKm: number;
  furthestFromHome: FurthestFromHome | null;
  superlatives: Superlatives;
}

// The subset of stats the dashboard, demo, and share pages actually render
// (summary cards, distance, bucket ring). Fetching only this cuts the page
// from twelve stats queries to three.
export interface SummaryStats {
  summary: TravelSummary | null;
  distanceKm: number;
  bucket: BucketCompletion | null;
}

// --- Coercion helpers ------------------------------------------------------

// PostgREST can serialize numeric columns as strings to preserve precision.
// Coerce defensively so chart axes and formatting always receive numbers.
function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// --- Individual views ------------------------------------------------------

export async function getTravelSummary(
  supabase: StatsClient,
  userId: string,
): Promise<TravelSummary | null> {
  const { data, error } = await supabase
    .from("v_user_travel_summary")
    .select(
      "countries_visited, world_pct, continents_visited, total_trips, total_destinations, total_experiences, days_traveling",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    countries_visited: num(data.countries_visited),
    world_pct: num(data.world_pct),
    continents_visited: num(data.continents_visited),
    total_trips: num(data.total_trips),
    total_destinations: num(data.total_destinations),
    total_experiences: num(data.total_experiences),
    days_traveling: num(data.days_traveling),
  };
}

export async function getExperiencesByCategory(
  supabase: StatsClient,
  userId: string,
): Promise<CategoryStat[]> {
  const { data, error } = await supabase
    .from("v_experiences_by_category")
    .select("slug, label, color, experience_count, avg_rating_stars")
    .eq("user_id", userId)
    .order("experience_count", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    slug: String(row.slug),
    label: String(row.label),
    color: String(row.color),
    experience_count: num(row.experience_count),
    avg_rating_stars: numOrNull(row.avg_rating_stars),
  }));
}

export async function getCountryFrequency(
  supabase: StatsClient,
  userId: string,
): Promise<CountryStat[]> {
  const { data, error } = await supabase
    .from("v_country_frequency")
    .select("country_code, country_name, trips, destinations")
    .eq("user_id", userId)
    .order("destinations", { ascending: false })
    .limit(10);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    country_code: String(row.country_code),
    country_name: String(row.country_name),
    trips: num(row.trips),
    destinations: num(row.destinations),
  }));
}

export async function getYearlyBreakdown(
  supabase: StatsClient,
  userId: string,
): Promise<YearStat[]> {
  const { data, error } = await supabase
    .from("v_yearly_breakdown")
    .select("year, trips, countries, new_countries")
    .eq("user_id", userId)
    .order("year", { ascending: true });
  if (error) throw error;
  // Dateless (planned) trips have no year; if the view emits a null-year row
  // for them, drop it rather than charting a "year 0" bucket.
  return (data ?? [])
    .filter((row) => numOrNull(row.year) !== null)
    .map((row) => ({
      year: num(row.year),
      trips: num(row.trips),
      countries: num(row.countries),
      new_countries: num(row.new_countries),
    }));
}

export async function getBucketCompletion(
  supabase: StatsClient,
  userId: string,
): Promise<BucketCompletion | null> {
  const { data, error } = await supabase
    .from("v_bucket_completion")
    .select("total, fulfilled, completion_pct")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    total: num(data.total),
    fulfilled: num(data.fulfilled),
    completion_pct: num(data.completion_pct),
  };
}

interface TravelExtremesRow {
  northernmost_lat: number | null;
  southernmost_lat: number | null;
  easternmost_lng: number | null;
  westernmost_lng: number | null;
}

export async function getTravelExtremes(
  supabase: StatsClient,
  userId: string,
): Promise<TravelExtremesRow | null> {
  const { data, error } = await supabase
    .from("v_travel_extremes")
    .select(
      "northernmost_lat, southernmost_lat, easternmost_lng, westernmost_lng",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    northernmost_lat: numOrNull(data.northernmost_lat),
    southernmost_lat: numOrNull(data.southernmost_lat),
    easternmost_lng: numOrNull(data.easternmost_lng),
    westernmost_lng: numOrNull(data.westernmost_lng),
  };
}

export async function getDistanceTraveled(
  supabase: StatsClient,
  userId: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("f_distance_traveled", {
    p_user_id: userId,
  });
  if (error) throw error;
  return num(data);
}

// Planned experiences (trip planner ideas) must not count as things the user
// has done. The SQL views apply this filter once
// scripts/sql/2026-07-18-experience-status.sql has run; this app-side
// subtraction keeps the numbers correct before that. Two counts are needed
// because the views differ: v_user_travel_summary already excludes whole
// planned trips (so only planned experiences on non-planned trips would leak
// into it), while v_experiences_by_category counts every experience.
interface PlannedAdjustments {
  /** Planned experiences on non-planned trips (leaks into the summary). */
  summaryTotal: number;
  /** All planned experiences per category slug (leaks into the chart). */
  byCategorySlug: Record<string, number>;
}

async function getPlannedAdjustments(
  supabase: StatsClient,
  userId: string,
): Promise<PlannedAdjustments> {
  const none: PlannedAdjustments = { summaryTotal: 0, byCategorySlug: {} };
  try {
    const { data, error } = await supabase
      .from("experiences")
      .select(
        "id, categories(slug), destinations!inner(trips!inner(status))",
      )
      .eq("user_id", userId)
      .eq("status", "planned");
    // A missing status column (migration not yet run) errors here; that also
    // means no planned experiences can exist, so zero is correct.
    if (error || !data) return none;
    const rows = data as unknown as {
      categories: { slug: string } | null;
      destinations: { trips: { status: string } | null } | null;
    }[];
    const byCategorySlug: Record<string, number> = {};
    let summaryTotal = 0;
    for (const row of rows) {
      if (row.destinations?.trips?.status !== "planned") summaryTotal += 1;
      const slug = row.categories?.slug;
      if (slug) byCategorySlug[slug] = (byCategorySlug[slug] ?? 0) + 1;
    }
    return { summaryTotal, byCategorySlug };
  } catch {
    return none;
  }
}

function applySummaryAdjustment(
  summary: TravelSummary | null,
  adjustments: PlannedAdjustments,
): TravelSummary | null {
  if (!summary || adjustments.summaryTotal === 0) return summary;
  return {
    ...summary,
    total_experiences: Math.max(
      0,
      summary.total_experiences - adjustments.summaryTotal,
    ),
  };
}

function applyCategoryAdjustment(
  categories: CategoryStat[],
  adjustments: PlannedAdjustments,
): CategoryStat[] {
  return categories
    .map((stat) => ({
      ...stat,
      experience_count:
        stat.experience_count - (adjustments.byCategorySlug[stat.slug] ?? 0),
    }))
    .filter((stat) => stat.experience_count > 0);
}

// Resolve the destination name at each compass extreme. The names live in the
// destinations table, so this selects the single destination furthest in each
// direction (the same rows the v_travel_extremes min/max are taken from).
async function getExtremeNames(
  supabase: StatsClient,
  userId: string,
): Promise<{
  north: string | null;
  south: string | null;
  east: string | null;
  west: string | null;
}> {
  const furthest = async (
    column: "latitude" | "longitude",
    ascending: boolean,
  ): Promise<string | null> => {
    // Planned-trip stops have not been visited, so they cannot be extremes.
    const { data } = await supabase
      .from("destinations")
      .select("name, trips!inner(status)")
      .eq("user_id", userId)
      .neq("trips.status", "planned")
      .order(column, { ascending, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    return data ? (data.name as string) : null;
  };

  const [north, south, east, west] = await Promise.all([
    furthest("latitude", false),
    furthest("latitude", true),
    furthest("longitude", false),
    furthest("longitude", true),
  ]);
  return { north, south, east, west };
}

// The stop furthest from home, by great-circle distance. Returns null without
// a home location, so the caller renders nothing rather than an empty state.
// Planned-trip stops are excluded, matching the compass extremes.
async function getFurthestFromHome(
  supabase: StatsClient,
  userId: string,
  home: HomeLocation | null,
): Promise<FurthestFromHome | null> {
  if (!home) return null;

  const { data, error } = await supabase
    .from("destinations")
    .select("name, latitude, longitude, trips!inner(status)")
    .eq("user_id", userId)
    .neq("trips.status", "planned")
    .not("latitude", "is", null);
  if (error || !data) return null;

  let best: { name: string; distanceKm: number } | null = null;
  for (const row of data as { name: string; latitude: number | null; longitude: number | null }[]) {
    if (row.latitude === null || row.longitude === null) continue;
    const distanceKm = haversineKm(
      home.lat,
      home.lng,
      row.latitude,
      row.longitude,
    );
    if (!best || distanceKm > best.distanceKm) {
      best = { name: row.name, distanceKm };
    }
  }
  if (!best) return null;
  return { ...best, homeLabel: home.name };
}

// Every rated experience the user has logged, flattened for the superlatives
// derivation. One query: the top-N-per-category grouping is done in JS over
// these rows rather than in a view, because the row count is small and a view
// would be one more thing to keep in sync by hand.
async function getRatedExperiences(
  supabase: StatsClient,
  userId: string,
): Promise<RatedExperience[]> {
  // select * on the experience columns so a missing status column (migration
  // not yet run) does not error the query; status then reads as undefined and
  // normalizes to "done" below.
  const { data, error } = await supabase
    .from("experiences")
    .select(
      "*, categories(slug, label, color, icon), destinations!inner(id, name, trips!inner(id, name, status))",
    )
    .eq("user_id", userId)
    .not("rating", "is", null)
    .order("visited_date", { ascending: false, nullsFirst: false });
  if (error || !data) return [];

  const rows = data as unknown as {
    id: string;
    name: string;
    rating: number | null;
    status?: string | null;
    visited_date: string | null;
    categories: {
      slug: string;
      label: string;
      color: string | null;
      icon: string | null;
    } | null;
    destinations: {
      id: string;
      name: string;
      trips: { id: string; name: string; status: string } | null;
    } | null;
  }[];

  const rated: RatedExperience[] = [];
  for (const row of rows) {
    if (row.rating === null) continue;
    // A planned idea carries no verdict, and a planned trip has not happened.
    if (row.status === "planned") continue;
    const trip = row.destinations?.trips;
    if (!row.destinations || !trip || trip.status === "planned") continue;
    rated.push({
      id: row.id,
      name: row.name,
      rating: num(row.rating),
      categorySlug: row.categories?.slug ?? null,
      categoryLabel: row.categories?.label ?? null,
      categoryColor: row.categories?.color ?? null,
      categoryIcon: row.categories?.icon ?? null,
      destinationId: row.destinations.id,
      destinationName: row.destinations.name,
      tripId: trip.id,
      tripName: trip.name,
      visitedDate: row.visited_date,
    });
  }
  return rated;
}

// --- Aggregate -------------------------------------------------------------

// Summary cards, distance, and bucket completion only: everything the
// dashboard and share surfaces show. The full getAllStats remains for the
// dedicated stats page with its charts and extremes.
export async function getSummaryStats(userId: string): Promise<SummaryStats> {
  const supabase = await createClient();
  const [summary, distanceKm, bucket, adjustments] = await Promise.all([
    getTravelSummary(supabase, userId),
    getDistanceTraveled(supabase, userId),
    getBucketCompletion(supabase, userId),
    getPlannedAdjustments(supabase, userId),
  ]);
  return {
    summary: applySummaryAdjustment(summary, adjustments),
    distanceKm,
    bucket,
  };
}

export async function getAllStats(userId?: string): Promise<StatsData> {
  const supabase = await createClient();

  let uid = userId;
  if (!uid) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    uid = user.id;
  }

  const [
    summary,
    categories,
    countries,
    yearly,
    bucket,
    extremesRow,
    distanceKm,
    names,
    adjustments,
    home,
    ratedExperiences,
  ] = await Promise.all([
    getTravelSummary(supabase, uid),
    getExperiencesByCategory(supabase, uid),
    getCountryFrequency(supabase, uid),
    getYearlyBreakdown(supabase, uid),
    getBucketCompletion(supabase, uid),
    getTravelExtremes(supabase, uid),
    getDistanceTraveled(supabase, uid),
    getExtremeNames(supabase, uid),
    getPlannedAdjustments(supabase, uid),
    getHomeLocation(uid),
    getRatedExperiences(supabase, uid),
  ]);

  // Needs the home row, so it runs after the parallel batch rather than in it.
  const furthestFromHome = await getFurthestFromHome(supabase, uid, home);

  const extremes: TravelExtremes = {
    north: { name: names.north, value: extremesRow?.northernmost_lat ?? null },
    south: { name: names.south, value: extremesRow?.southernmost_lat ?? null },
    east: { name: names.east, value: extremesRow?.easternmost_lng ?? null },
    west: { name: names.west, value: extremesRow?.westernmost_lng ?? null },
  };

  return {
    summary: applySummaryAdjustment(summary, adjustments),
    categories: applyCategoryAdjustment(categories, adjustments),
    countries,
    yearly,
    bucket,
    extremes,
    distanceKm,
    furthestFromHome,
    superlatives: buildSuperlatives(ratedExperiences),
  };
}

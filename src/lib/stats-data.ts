import { createClient } from "@/utils/supabase/server";

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

export interface StatsData {
  summary: TravelSummary | null;
  categories: CategoryStat[];
  countries: CountryStat[];
  yearly: YearStat[];
  bucket: BucketCompletion | null;
  extremes: TravelExtremes;
  distanceKm: number;
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
  return (data ?? []).map((row) => ({
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
    const { data } = await supabase
      .from("destinations")
      .select("name")
      .eq("user_id", userId)
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

// --- Aggregate -------------------------------------------------------------

// Summary cards, distance, and bucket completion only: everything the
// dashboard and share surfaces show. The full getAllStats remains for the
// dedicated stats page with its charts and extremes.
export async function getSummaryStats(userId: string): Promise<SummaryStats> {
  const supabase = await createClient();
  const [summary, distanceKm, bucket] = await Promise.all([
    getTravelSummary(supabase, userId),
    getDistanceTraveled(supabase, userId),
    getBucketCompletion(supabase, userId),
  ]);
  return { summary, distanceKm, bucket };
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

  const [summary, categories, countries, yearly, bucket, extremesRow, distanceKm, names] =
    await Promise.all([
      getTravelSummary(supabase, uid),
      getExperiencesByCategory(supabase, uid),
      getCountryFrequency(supabase, uid),
      getYearlyBreakdown(supabase, uid),
      getBucketCompletion(supabase, uid),
      getTravelExtremes(supabase, uid),
      getDistanceTraveled(supabase, uid),
      getExtremeNames(supabase, uid),
    ]);

  const extremes: TravelExtremes = {
    north: { name: names.north, value: extremesRow?.northernmost_lat ?? null },
    south: { name: names.south, value: extremesRow?.southernmost_lat ?? null },
    east: { name: names.east, value: extremesRow?.easternmost_lng ?? null },
    west: { name: names.west, value: extremesRow?.westernmost_lng ?? null },
  };

  return {
    summary,
    categories,
    countries,
    yearly,
    bucket,
    extremes,
    distanceKm,
  };
}

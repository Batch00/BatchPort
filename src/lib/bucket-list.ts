import { requireUser } from "@/lib/current-user";

// Server-side data layer for the bucket list. Reads run with the user's session
// (RLS scopes them); the userId argument lets callers fetch a specific user's
// data for demo or public-share views. Mutations live in actions/bucket-list.ts.

export type BucketType = "country" | "place";

export interface BucketItem {
  id: string;
  type: BucketType;
  country_code: string | null;
  country_name: string | null;
  place_name: string | null;
  priority: number | null;
  target_date: string | null;
  fulfilled_trip_id: string | null;
  fulfilled_trip_name: string | null;
  fulfilled_at: string | null;
  created_at: string;
}

export interface BucketStats {
  total: number;
  fulfilled: number;
  completion_pct: number;
}

export interface CountryOption {
  code: string;
  name: string;
}

// The shape the dialog sends when creating or editing an item.
export interface BucketItemInput {
  type: BucketType;
  country_code: string | null;
  place_name: string | null;
  lat: number | null;
  lng: number | null;
  priority: number | null;
  target_date: string | null;
}

const SELECT =
  "id, type, country_code, place_name, priority, target_date, fulfilled_trip_id, fulfilled_at, created_at, countries(name), fulfilling_trip:trips!fulfilled_trip_id(name)";

interface BucketRow {
  id: string;
  type: string;
  country_code: string | null;
  place_name: string | null;
  priority: number | null;
  target_date: string | null;
  fulfilled_trip_id: string | null;
  fulfilled_at: string | null;
  created_at: string;
  countries: { name: string } | null;
  fulfilling_trip: { name: string } | null;
}

async function resolveUserId(userId?: string): Promise<string> {
  const { user } = await requireUser();
  return userId ?? user.id;
}

// All bucket items for the user: unfulfilled first, then highest priority, then
// newest. Country and trip names come from joined reference rows.
export async function getBucketList(userId?: string): Promise<BucketItem[]> {
  const { supabase } = await requireUser();
  const uid = await resolveUserId(userId);

  const { data, error } = await supabase
    .from("bucket_list")
    .select(SELECT)
    .eq("user_id", uid)
    .order("fulfilled_at", { ascending: true, nullsFirst: true })
    .order("priority", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;

  return ((data ?? []) as unknown as BucketRow[]).map((row) => ({
    id: row.id,
    type: row.type === "place" ? "place" : "country",
    country_code: row.country_code,
    country_name: row.countries?.name ?? null,
    place_name: row.place_name,
    priority: row.priority,
    target_date: row.target_date,
    fulfilled_trip_id: row.fulfilled_trip_id,
    fulfilled_trip_name: row.fulfilling_trip?.name ?? null,
    fulfilled_at: row.fulfilled_at,
    created_at: row.created_at,
  }));
}

// Completion totals from the SQL view, or null when the user has no items.
export async function getBucketListStats(
  userId?: string,
): Promise<BucketStats | null> {
  const { supabase } = await requireUser();
  const uid = await resolveUserId(userId);

  const { data, error } = await supabase
    .from("v_bucket_completion")
    .select("total, fulfilled, completion_pct")
    .eq("user_id", uid)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    total: Number(data.total) || 0,
    fulfilled: Number(data.fulfilled) || 0,
    completion_pct: Number(data.completion_pct) || 0,
  };
}

// The reference list of countries for the add/edit dialog dropdown.
export async function getCountries(): Promise<CountryOption[]> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("countries")
    .select("code, name")
    .order("name", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as { code: string; name: string }[]).map((row) => ({
    code: row.code,
    name: row.name,
  }));
}

// Distinct country codes of unfulfilled country-type items, for the globe's
// "want to visit" fill layer.
export async function getBucketCountryCodes(userId?: string): Promise<string[]> {
  const { supabase } = await requireUser();
  const uid = await resolveUserId(userId);

  const { data, error } = await supabase
    .from("bucket_list")
    .select("country_code")
    .eq("user_id", uid)
    .eq("type", "country")
    .is("fulfilled_at", null);
  if (error) throw error;
  return Array.from(
    new Set(
      ((data ?? []) as { country_code: string | null }[])
        .map((row) => row.country_code)
        .filter((code): code is string => Boolean(code)),
    ),
  );
}

// Best-effort: fulfill any unfulfilled country-type bucket item whose country
// the user has now visited, crediting the earliest trip that reached it. Safe to
// call after destination creation; the caller swallows errors.
export async function autoFulfillBucketItems(userId: string): Promise<void> {
  const { supabase } = await requireUser();

  const { data: pending } = await supabase
    .from("bucket_list")
    .select("id, country_code")
    .eq("user_id", userId)
    .eq("type", "country")
    .is("fulfilled_at", null);
  const items = (pending ?? []) as { id: string; country_code: string | null }[];
  if (items.length === 0) return;

  // Earliest trip per visited country, from the user's destinations.
  const { data: dests } = await supabase
    .from("destinations")
    .select("country_code, trip_id, trips(start_date)")
    .eq("user_id", userId);
  const rows = (dests ?? []) as unknown as {
    country_code: string | null;
    trip_id: string;
    trips: { start_date: string | null } | null;
  }[];

  const earliestTripByCountry = new Map<
    string,
    { tripId: string; start: string }
  >();
  for (const row of rows) {
    if (!row.country_code) continue;
    const start = row.trips?.start_date ?? "9999-12-31";
    const current = earliestTripByCountry.get(row.country_code);
    if (!current || start < current.start) {
      earliestTripByCountry.set(row.country_code, {
        tripId: row.trip_id,
        start,
      });
    }
  }

  const nowIso = new Date().toISOString();
  for (const item of items) {
    if (!item.country_code) continue;
    const match = earliestTripByCountry.get(item.country_code);
    if (!match) continue;
    await supabase
      .from("bucket_list")
      .update({ fulfilled_trip_id: match.tripId, fulfilled_at: nowIso })
      .eq("id", item.id);
  }
}

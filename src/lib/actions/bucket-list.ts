"use server";

import { requireUser } from "@/lib/current-user";
import { revalidateAppData } from "@/lib/revalidate";
import { pointEwkt } from "@/lib/geo";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { isDemoBlocked } from "@/lib/demo-guard";
import type { ActionResult } from "@/lib/action-result";
import type { BucketItemInput } from "@/lib/bucket-list";

// Server actions for bucket list mutations. Every write refuses the demo
// account and revalidates the pages that surface bucket data.

// Normalize the dialog input into the columns for one consistent row (excluding
// user_id), keeping the country/place check constraint satisfied.
function toRow(input: BucketItemInput) {
  const hasCoords = input.lat !== null && input.lng !== null;
  if (input.type === "country") {
    return {
      type: "country",
      country_code: input.country_code,
      place_name: null,
      geom: null,
      priority: input.priority,
      target_date: input.target_date,
    };
  }
  return {
    type: "place",
    country_code: input.country_code,
    place_name: input.place_name?.trim() ?? null,
    geom: hasCoords ? pointEwkt(input.lng as number, input.lat as number) : null,
    priority: input.priority,
    target_date: input.target_date,
  };
}

function validate(input: BucketItemInput): string | null {
  if (input.type === "country" && !input.country_code) {
    return "Choose a country.";
  }
  if (input.type === "place" && !input.place_name) {
    return "Search for and select a place.";
  }
  return null;
}

export async function createBucketItem(
  input: BucketItemInput,
): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const invalid = validate(input);
  if (invalid) return { error: invalid };

  const { supabase, user } = await requireUser();

  // Duplicate guard, mirroring the country-type behavior: adding a place that
  // is already on the list succeeds without inserting a second row. Matching
  // is case-insensitive on the trimmed name plus the country code, since
  // coordinates for the same place can differ between geocode results.
  if (input.type === "place" && input.place_name) {
    let query = supabase
      .from("bucket_list")
      .select("id")
      .eq("user_id", user.id)
      .eq("type", "place")
      .ilike("place_name", input.place_name.trim());
    query = input.country_code
      ? query.eq("country_code", input.country_code)
      : query.is("country_code", null);
    const { data: existing } = await query.limit(1);
    if ((existing ?? []).length > 0) {
      return { ok: true };
    }
  }

  const { error } = await supabase
    .from("bucket_list")
    .insert({ user_id: user.id, ...toRow(input) });
  if (error) return { error: "Could not add the bucket list item." };

  revalidateAppData();
  return { ok: true };
}

export async function updateBucketItem(
  id: string,
  input: BucketItemInput,
): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const invalid = validate(input);
  if (invalid) return { error: invalid };

  const { supabase } = await requireUser();
  // Rewrite the row's fields so a country/place switch stays consistent.
  const { error } = await supabase
    .from("bucket_list")
    .update(toRow(input))
    .eq("id", id);
  if (error) return { error: "Could not update the bucket list item." };

  revalidateAppData();
  return { ok: true };
}

export async function deleteBucketItem(id: string): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const { supabase } = await requireUser();
  const { error } = await supabase.from("bucket_list").delete().eq("id", id);
  if (error) return { error: "Could not delete the bucket list item." };

  revalidateAppData();
  return { ok: true };
}

export async function fulfillBucketItem(
  id: string,
  tripId: string,
): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("bucket_list")
    .update({ fulfilled_trip_id: tripId, fulfilled_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: "Could not mark the item as completed." };

  revalidateAppData();
  return { ok: true };
}

export async function unfulfillBucketItem(id: string): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("bucket_list")
    .update({ fulfilled_trip_id: null, fulfilled_at: null })
    .eq("id", id);
  if (error) return { error: "Could not undo the completion." };

  revalidateAppData();
  return { ok: true };
}

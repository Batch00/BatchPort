"use server";

import { requireUser } from "@/lib/current-user";
import { revalidateAppData } from "@/lib/revalidate";
import { createAdminClient } from "@/utils/supabase/admin";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { isDemoBlocked } from "@/lib/demo-guard";
import { pointEwkt } from "@/lib/geo";
import type { ActionResult } from "@/lib/action-result";

export interface HomeLocationInput {
  name: string;
  country_code: string | null;
  lat: number;
  lng: number;
}

// PostgREST reports an unknown column as PGRST204. The home label columns come
// from 2026-07-29-home-location.sql; until it runs, retry with the point alone
// so setting a home still works (every distance feature only needs the point).
function isUnknownColumn(code: string | undefined): boolean {
  return code === "PGRST204";
}

// Set or clear the current user's home location. Written as EWKT to the
// home_geom geography column, never as separate lat/lng columns.
export async function updateHomeLocation(
  input: HomeLocationInput | null,
): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };

  const { user } = await requireUser();

  if (input) {
    if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) {
      return { error: "That location has no usable coordinates." };
    }
    if (Math.abs(input.lat) > 90 || Math.abs(input.lng) > 180) {
      return { error: "That location has no usable coordinates." };
    }
  }

  const admin = createAdminClient();
  const base = {
    user_id: user.id,
    home_geom: input ? pointEwkt(input.lng, input.lat) : null,
  };
  const full = {
    ...base,
    home_name: input ? input.name.trim().slice(0, 120) || null : null,
    home_country_code: input?.country_code?.toUpperCase() ?? null,
  };

  const { error } = await admin
    .schema("batchport")
    .from("user_settings")
    .upsert(full, { onConflict: "user_id" });

  if (error) {
    if (!isUnknownColumn(error.code)) {
      return { error: "Could not save your home location." };
    }
    const retry = await admin
      .schema("batchport")
      .from("user_settings")
      .upsert(base, { onConflict: "user_id" });
    if (retry.error) {
      return { error: "Could not save your home location." };
    }
  }

  revalidateAppData();
  return { ok: true };
}

"use server";

import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { isDemoBlocked } from "@/lib/demo-guard";
import { requireUser } from "@/lib/current-user";
import { revalidateAppData } from "@/lib/revalidate";
import { toTransportMode, type TransportLegInput } from "@/lib/transport";
import type { ActionResult } from "@/lib/action-result";

// Transport leg mutations. One leg per arriving destination, so every write is
// an upsert on that key and clearing the mode is a delete: there is no such
// thing as a leg without a mode, which keeps "this hop was recorded" a row
// check everywhere else.

const MAX_CARRIER = 120;
const MAX_NOTES = 2000;
// Two weeks, matching the check constraint. Long enough for a cargo ship.
const MAX_MINUTES = 20160;
// Longer than any single hop on this planet, with room to spare.
const MAX_KM = 50000;

function trimmed(value: string | null, max: number): string | null {
  if (value === null) return null;
  const text = value.trim();
  if (text.length === 0) return null;
  return text.slice(0, max);
}

function positive(value: number | null, max: number): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(value, max);
}

export async function saveTransportLegAction(
  tripId: string,
  destinationId: string,
  input: TransportLegInput,
): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };

  const mode = toTransportMode(input.mode);
  if (!mode) return { error: "Pick how you travelled." };

  const { supabase, user } = await requireUser();

  const { error } = await supabase.from("transport_legs").upsert(
    {
      user_id: user.id,
      trip_id: tripId,
      destination_id: destinationId,
      mode,
      carrier: trimmed(input.carrier, MAX_CARRIER),
      duration_minutes: positive(input.duration_minutes, MAX_MINUTES),
      distance_km: positive(input.distance_km, MAX_KM),
      notes: trimmed(input.notes, MAX_NOTES),
    },
    { onConflict: "destination_id" },
  );
  if (error) return { error: transportError(error) };

  revalidateAppData();
  return { ok: true };
}

export async function deleteTransportLegAction(
  destinationId: string,
): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };

  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("transport_legs")
    .delete()
    .eq("destination_id", destinationId);
  if (error) return { error: transportError(error) };

  revalidateAppData();
  return { ok: true };
}

// A missing table means the migration has not run yet. Say so plainly rather
// than reporting a generic failure the user cannot act on.
function transportError(error: { code?: string }): string {
  if (error.code === "PGRST205" || error.code === "42P01") {
    return "Transport legs are not set up on this database yet.";
  }
  return "Could not save that leg. Try again.";
}

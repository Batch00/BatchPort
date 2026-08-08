/*
 * DATABASE CHANGES REQUIRED (see scripts/sql/2026-08-07-featured-curation.sql):
 *
 * ALTER TABLE batchport.experiences ADD COLUMN IF NOT EXISTS featured_rank smallint;
 * ALTER TABLE batchport.photos ADD COLUMN IF NOT EXISTS featured_rank smallint;
 */

"use server";

import { requireUser } from "@/lib/current-user";
import { revalidateAppData } from "@/lib/revalidate";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { isDemoBlocked } from "@/lib/demo-guard";
import {
  MAX_FEATURED_HONORED,
  featuredRankOf,
  nextFeaturedRank,
} from "@/lib/curation";
import { isMissingPhotoColumn } from "@/lib/photos";
import { ownersForTrip } from "@/lib/photo-cleanup";
import type { ActionResult } from "@/lib/action-result";

// Featuring: electing which experiences and which photos represent a trip.
//
// Both actions do the same three things, and the shape is deliberately shared:
// read the ranks already in use ON THIS TRIP, take the next one, and write it.
// Featuring is scoped to the trip because that is the unit every consuming
// surface works in (see lib/curation.ts), and it is computed server-side so
// two rows can never claim the same rank from one device.
//
// The trip id comes from the caller, as it does for the other per-trip actions
// (deleteExperienceAction takes one too). RLS is still the access boundary: a
// wrong trip id can only ever produce a slightly-off rank on the caller's own
// rows, never a read or a write of somebody else's.

type ServerClient = Awaited<ReturnType<typeof requireUser>>["supabase"];

/** PostgREST rejects a WRITE naming a column that does not exist as PGRST204,
 * and a READ that names one as 42703. */
function isMissingColumnWrite(error: { code?: string } | null): boolean {
  return error?.code === "PGRST204";
}

const NOT_SET_UP =
  "Featuring is not set up on this database yet. Run the featured-curation migration.";

function capReached(kind: "experiences" | "photos"): string {
  return `You can feature up to ${MAX_FEATURED_HONORED} ${kind} on one trip. Unfeature one first.`;
}

/** The ranks already in use across a trip's experiences. An empty list on a
 * database without the column, which is fine: the write that follows is the
 * thing that reports the migration is missing. */
async function experienceRanks(
  supabase: ServerClient,
  tripId: string,
): Promise<(number | null)[]> {
  const { data: dests } = await supabase
    .from("destinations")
    .select("id")
    .eq("trip_id", tripId);
  const destinationIds = ((dests ?? []) as { id: string }[]).map((row) => row.id);
  if (destinationIds.length === 0) return [];
  const { data, error } = await supabase
    .from("experiences")
    .select("featured_rank")
    .in("destination_id", destinationIds)
    .not("featured_rank", "is", null);
  if (error) return [];
  return ((data ?? []) as { featured_rank: number | null }[]).map((row) =>
    featuredRankOf(row.featured_rank),
  );
}

/** The ranks already in use across a trip's photos, at every level: the trip's
 * own, its stops', and its experiences'. ownersForTrip already resolves that
 * fan-out for the delete cascade, so this borrows it rather than repeating it. */
async function photoRanks(
  supabase: ServerClient,
  tripId: string,
): Promise<(number | null)[]> {
  const owners = await ownersForTrip(tripId);
  const ranks: (number | null)[] = [];
  for (const owner of owners) {
    if (owner.ids.length === 0) continue;
    const { data, error } = await supabase
      .from("photos")
      .select("featured_rank")
      .eq("owner_type", owner.type)
      .in("owner_id", owner.ids)
      .not("featured_rank", "is", null);
    if (isMissingPhotoColumn(error)) return [];
    if (error) continue;
    ranks.push(
      ...((data ?? []) as { featured_rank: number | null }[]).map((row) =>
        featuredRankOf(row.featured_rank),
      ),
    );
  }
  return ranks;
}

export async function setExperienceFeaturedAction(
  tripId: string,
  experienceId: string,
  featured: boolean,
): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const { supabase } = await requireUser();

  let rank: number | null = null;
  if (featured) {
    rank = nextFeaturedRank(await experienceRanks(supabase, tripId));
    if (rank === null) return { error: capReached("experiences") };
  }

  const { error } = await supabase
    .from("experiences")
    .update({ featured_rank: rank })
    .eq("id", experienceId);
  if (isMissingColumnWrite(error)) return { error: NOT_SET_UP };
  if (error) return { error: "Could not update the featured experience." };

  revalidateAppData();
  return { ok: true };
}

export async function setPhotoFeaturedAction(
  tripId: string,
  photoId: string,
  featured: boolean,
): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };
  const { supabase } = await requireUser();

  let rank: number | null = null;
  if (featured) {
    rank = nextFeaturedRank(await photoRanks(supabase, tripId));
    if (rank === null) return { error: capReached("photos") };
  }

  const { error } = await supabase
    .from("photos")
    .update({ featured_rank: rank })
    .eq("id", photoId);
  if (isMissingColumnWrite(error)) return { error: NOT_SET_UP };
  if (error) return { error: "Could not update the featured photo." };

  revalidateAppData();
  return { ok: true };
}

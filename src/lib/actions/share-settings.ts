"use server";

import { requireUser } from "@/lib/current-user";
import { revalidateAppData } from "@/lib/revalidate";
import { createAdminClient } from "@/utils/supabase/admin";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { isDemoBlocked } from "@/lib/demo-guard";
import {
  RESERVED_SLUGS,
  SLUG_PATTERN,
  isShareTripScope,
  type ShareSettingsInput,
} from "@/lib/share-settings";
import type { ActionResult } from "@/lib/action-result";

// Update the current user's share settings. Demo accounts cannot change these.
// The slug is normalized, format and reservation checked, and verified unique
// across users (via the admin client, which can see every row). The trip scope
// and journal switch are saved in the same upsert. The admin client is the only
// writer: signed-in browsers have no INSERT or UPDATE on user_settings.
export async function updateShareSettings(
  input: ShareSettingsInput,
): Promise<ActionResult> {
  if (await isDemoBlocked()) return { error: DEMO_READONLY_MESSAGE };

  const { user } = await requireUser();

  const slug = input.publicSlug ? input.publicSlug.trim().toLowerCase() : "";

  if (slug) {
    if (slug.length < 3 || slug.length > 30) {
      return { error: "Slug must be between 3 and 30 characters." };
    }
    if (!SLUG_PATTERN.test(slug)) {
      return {
        error: "Slug can use lowercase letters, numbers, and hyphens only.",
      };
    }
    if (RESERVED_SLUGS.includes(slug)) {
      return { error: "That slug is reserved. Choose another." };
    }
  }

  if (input.publicShareEnabled && !slug) {
    return { error: "Choose a slug before enabling your public link." };
  }

  // A server action's argument is whatever the request carried, so the scope
  // is checked against the same list the database's check constraint holds.
  if (!isShareTripScope(input.shareTripScope)) {
    return { error: "Choose which trips to share: past, current, or all." };
  }
  if (typeof input.shareJournal !== "boolean") {
    return { error: "Could not read the journal sharing choice." };
  }

  const admin = createAdminClient();

  // Uniqueness: no other user may hold this slug.
  if (slug) {
    const { data: taken } = await admin
      .schema("batchport")
      .from("user_settings")
      .select("user_id")
      .eq("public_slug", slug)
      .neq("user_id", user.id)
      .maybeSingle();
    if (taken) {
      return { error: "That slug is already taken." };
    }
  }

  const { error } = await admin
    .schema("batchport")
    .from("user_settings")
    .upsert(
      {
        user_id: user.id,
        public_share_enabled: input.publicShareEnabled,
        public_slug: slug || null,
        share_trip_scope: input.shareTripScope,
        share_journal: input.shareJournal,
      },
      { onConflict: "user_id" },
    );
  if (error) return { error: "Could not save your settings." };

  revalidateAppData();
  return { ok: true };
}

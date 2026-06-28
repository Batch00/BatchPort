"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/current-user";
import { createAdminClient } from "@/utils/supabase/admin";
import { DEMO_READONLY_MESSAGE } from "@/lib/demo";
import { isDemoBlocked } from "@/lib/demo-guard";
import {
  RESERVED_SLUGS,
  SLUG_PATTERN,
  type ShareSettingsInput,
} from "@/lib/share-settings";
import type { ActionResult } from "@/lib/action-result";

// Update the current user's share settings. Demo accounts cannot change these.
// The slug is normalized, format and reservation checked, and verified unique
// across users (via the admin client, which can see every row).
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
      },
      { onConflict: "user_id" },
    );
  if (error) return { error: "Could not save your settings." };

  revalidatePath("/dashboard/settings");
  return { ok: true };
}

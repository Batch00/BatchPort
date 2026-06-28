import { createAdminClient } from "@/utils/supabase/admin";

// Read side of share settings. Uses the admin client (server only): these are
// owner-only operations already gated by requireUser at the call site, and the
// admin client sidesteps any RLS edge cases around the user_settings row not yet
// existing. The admin client is not schema-scoped, so name batchport explicitly.

export interface ShareSettings {
  public_share_enabled: boolean;
  public_slug: string | null;
  is_demo: boolean;
}

export interface ShareSettingsInput {
  publicShareEnabled: boolean;
  publicSlug: string | null;
}

// Slugs that would collide with app routes or the demo, kept off-limits.
export const RESERVED_SLUGS = ["demo", "share", "api", "dashboard", "admin"];

export const SLUG_PATTERN = /^[a-z0-9-]+$/;

export async function getShareSettings(userId: string): Promise<ShareSettings> {
  const admin = createAdminClient();
  const { data } = await admin
    .schema("batchport")
    .from("user_settings")
    .select("public_share_enabled, public_slug, is_demo")
    .eq("user_id", userId)
    .maybeSingle();

  return {
    public_share_enabled: Boolean(data?.public_share_enabled),
    public_slug: (data?.public_slug as string | null) ?? null,
    is_demo: Boolean(data?.is_demo),
  };
}

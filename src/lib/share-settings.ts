import { createAdminClient } from "@/utils/supabase/admin";

// Read side of share settings. Uses the admin client (server only): these are
// owner-only operations already gated by requireUser at the call site, and the
// admin client sidesteps any RLS edge cases around the user_settings row not yet
// existing. The admin client is not schema-scoped, so name batchport explicitly.
//
// share_trip_scope and share_journal (PORT-4) are what the shared-read policies
// ask about, through the helpers in batchport_private. The demo account ignores
// both and shares everything.

/** Which trips a shared profile includes. Mirrors the check constraint on
 * user_settings.share_trip_scope. */
export const SHARE_TRIP_SCOPES = ["past", "current", "all"] as const;
export type ShareTripScope = (typeof SHARE_TRIP_SCOPES)[number];

/** The database default, and what an unreadable value falls back to. */
export const DEFAULT_SHARE_TRIP_SCOPE: ShareTripScope = "past";

export function isShareTripScope(value: unknown): value is ShareTripScope {
  return (
    typeof value === "string" &&
    (SHARE_TRIP_SCOPES as readonly string[]).includes(value)
  );
}

export interface ShareSettings {
  public_share_enabled: boolean;
  public_slug: string | null;
  is_demo: boolean;
  share_trip_scope: ShareTripScope;
  share_journal: boolean;
}

export interface ShareSettingsInput {
  publicShareEnabled: boolean;
  publicSlug: string | null;
  shareTripScope: ShareTripScope;
  shareJournal: boolean;
}

// Slugs that would collide with app routes or the demo, kept off-limits.
export const RESERVED_SLUGS = ["demo", "share", "api", "dashboard", "admin"];

export const SLUG_PATTERN = /^[a-z0-9-]+$/;

const BASE_COLUMNS = "public_share_enabled, public_slug, is_demo";
const SCOPE_COLUMNS = `${BASE_COLUMNS}, share_trip_scope, share_journal`;

export async function getShareSettings(userId: string): Promise<ShareSettings> {
  const admin = createAdminClient();
  const read = (columns: string) =>
    admin
      .schema("batchport")
      .from("user_settings")
      .select(columns)
      .eq("user_id", userId)
      .maybeSingle();

  // A database without the PORT-4 part A columns answers 42703; read the base
  // columns and report the defaults rather than an empty form.
  let { data, error } = await read(SCOPE_COLUMNS);
  if (error?.code === "42703") ({ data, error } = await read(BASE_COLUMNS));

  const row = (error ? null : data) as Record<string, unknown> | null;
  const scope = row?.share_trip_scope;
  return {
    public_share_enabled: Boolean(row?.public_share_enabled),
    public_slug: (row?.public_slug as string | null | undefined) ?? null,
    is_demo: Boolean(row?.is_demo),
    share_trip_scope: isShareTripScope(scope) ? scope : DEFAULT_SHARE_TRIP_SCOPE,
    share_journal: row?.share_journal === true,
  };
}

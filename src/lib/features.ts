// Feature flags.
//
// Read at module scope from NEXT_PUBLIC_* so the same answer is available in
// Server Components, Client Components, and route handlers without a round
// trip. Next inlines NEXT_PUBLIC_ vars at build time, so the expression must
// name process.env.NEXT_PUBLIC_X literally: a dynamic lookup like
// process.env[key] is not replaced and reads undefined in the browser.

// Anything other than the exact string "true" is off. An absent variable, an
// empty string, and "false" all mean off, which is what makes "leave it unset
// in Vercel" a complete instruction rather than a convention.
function flag(value: string | undefined): boolean {
  return value === "true";
}

/**
 * The places feature: the /places route, its nav entry, and every entry point
 * into the log sheet. Off in production until phase 1 is reviewed.
 *
 * With the flag off, nothing about the app changes: the route 404s, the nav
 * item is not rendered, and no other surface gains a control. The schema and
 * the reference data are already live either way, because phase 0 is additive
 * and nothing reads it yet.
 */
export const PLACES_ENABLED = flag(process.env.NEXT_PUBLIC_PLACES_ENABLED);

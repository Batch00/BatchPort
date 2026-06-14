// Shared constants for BatchPort.

// The auth.users id of the shared read-only demo account
// (demo@batchport.com). The "Try a Demo" button on the landing page signs into
// this account, and the app layer treats it as read-only.
//
// Placeholder for now: fill this in with the real UUID after the demo user is
// created in Supabase. Until then isDemoUser() always returns false, so the
// demo simply behaves like a normal (empty) account.
export const DEMO_USER_ID = "703fbe07-db8a-41bd-bdee-928c2fa88107";

// Shared constants for BatchPort.

// The auth.users id of the shared read-only demo account. The public /demo page
// renders this user's data sessionlessly (no sign-in), gated by the is_shared()
// RLS policy. The app layer also treats this id as read-only when signed in.
// Used as a fallback when batchport.demo_user_id() returns null (no row marked
// is_demo, or more than one).
export const DEMO_USER_ID = "703fbe07-db8a-41bd-bdee-928c2fa88107";

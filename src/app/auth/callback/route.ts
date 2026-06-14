import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/utils/supabase/server";

// GET /auth/callback?code=...
// Handles the OAuth/PKCE redirect: exchanges the one-time code for a session,
// then sends the user into the app. On any failure we send them to the landing
// page (not /auth/login, which does not exist here).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}/dashboard`);
    }
  }

  return NextResponse.redirect(`${origin}/`);
}

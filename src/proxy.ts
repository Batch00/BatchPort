import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase auth session on every matched request and forwards
// the rotated auth cookies to both the request and the response.
//
// Naming note: Next.js 16 renamed the "middleware" file convention to "proxy".
// This file is the former src/middleware.ts. The behaviour (per-request session
// refresh via getUser) is unchanged.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Until Supabase is configured (no env vars yet), skip the session refresh so
  // the app shell still renders. Auth simply stays signed out.
  if (!supabaseUrl || !supabaseKey) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    db: { schema: "batchport" },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Important: call getUser() right after creating the client and do not run
  // other logic in between. getUser() revalidates the token and triggers the
  // cookie rotation handled by setAll above.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Run on every path except Next.js internals, the service worker and
    // manifest, and static image assets.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

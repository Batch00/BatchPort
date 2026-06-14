import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase auth session on every matched request and forwards
// the rotated auth cookies to both the request and the response. After the
// refresh it enforces route protection: unauthenticated users are kept out of
// app routes, and authenticated users skip the landing page.
//
// Naming note: Next.js 16 renamed the "middleware" file convention to "proxy".
// This file is the former src/middleware.ts.

// Routes reachable without a session. Everything else requires authentication.
const PUBLIC_ROUTES = [
  "/",
  "/auth/callback",
  "/auth/setup-password",
  "/api/request-access",
  "/api/approve-access",
  "/api/deny-access",
  "/demo",
];

function isPublicRoute(pathname: string): boolean {
  // Geocoding endpoints are public so they can serve the landing-page typeahead.
  if (pathname.startsWith("/api/geocode/")) return true;
  return PUBLIC_ROUTES.includes(pathname);
}

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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Carry any rotated auth cookies onto a redirect so the refresh is not lost.
  function redirectTo(path: string) {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => {
      redirect.cookies.set(cookie);
    });
    return redirect;
  }

  // Unauthenticated visitor on a protected route: send them to the landing page.
  if (!user && !isPublicRoute(pathname)) {
    return redirectTo("/");
  }

  // Authenticated user on the landing page: skip it and go straight to the app.
  if (user && pathname === "/") {
    return redirectTo("/dashboard");
  }

  return response;
}

export const config = {
  matcher: [
    // Run on every path except Next.js internals, the service worker and
    // manifest, and static assets. The map's basemap and data live under
    // /styles and /data; they must be excluded too, otherwise route protection
    // redirects those fetches to / and the globe fails to load its style.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|styles/|data/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

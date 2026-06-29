@AGENTS.md

## Project Overview

BatchPort is a personal travel tracker and installable PWA built on an interactive 3D globe. It is part of the Batch Apps umbrella (batch-apps.com) and lives at batchport.batch-apps.com. The app shares a single Supabase project with other Batch Apps, each isolated in its own Postgres schema. BatchPort uses the `batchport` schema for all database tables. It is invite-only, with a public read-only demo at /demo and shareable user profiles at /share/[slug].

## Tech Stack

- **Framework:** Next.js 16.2.9 (App Router), TypeScript strict, React 19.2.4
- **UI:** shadcn/ui (Radix primitives), Tailwind CSS v4, Lucide icons, Sonner toasts
- **Database:** Supabase (shared Batch Apps project), batchport Postgres schema, PostGIS extensions
- **Auth runtime:** `@supabase/ssr` for cookie-based session management
- **Map:** MapLibre GL JS 5.24.0, native GeoJSON layers, Protomaps PMTiles dark raster basemap
- **Charts:** Recharts 3.9.0
- **Geocoding:** Photon (typeahead and POI), Nominatim (reverse)
- **Photos:** Supabase Storage, Wikimedia Commons API (Wikidata P18 property)
- **Email:** Resend

**Session refresh:** `src/proxy.ts`, NOT `src/middleware.ts`. Next.js 16 renamed the middleware convention to "proxy". The per-request session refresh and route protection live in `src/proxy.ts`. A file named `src/middleware.ts` would be ignored.

## Hard Constraints

These apply to every change, no exceptions:

- No em dashes in any file (code, comments, or copy). Use commas, colons, or parentheses instead.
- TypeScript strict mode. No `any` types.
- Dark theme only. Use `bg-background`, `bg-[#0a0a0a]`, or dark-token classes. Never add white or light backgrounds.
- All Supabase queries must scope to the batchport schema. The anon clients (client.ts and server.ts) are already configured with `db: { schema: "batchport" }`. The admin client (admin.ts) is NOT scoped, so every query chain from it must call `.schema("batchport")` explicitly.
- Demo user is read-only. Call `isDemoBlocked()` at the top of every server action before any mutation. Components may also check `isDemoUser(user.id)` to hide edit affordances in the UI, but the action-layer guard is the authoritative block.
- Mutations use server actions only. API routes handle external integrations (geocoding proxies, Wikimedia image proxy, auth approval flows, Resend email).
- Never insert or update `latitude` or `longitude` on destinations, or any generated column. Write only to `geom` using EWKT: `SRID=4326;POINT(${lng} ${lat})`. The same applies to experiences, which have an optional `geom` column for POI coordinates.

## Architecture

### Route Groups and URL Structure

One route group exists:

- `(app)/` contains all authenticated routes. Its `layout.tsx` calls `supabase.auth.getUser()` and hard-redirects unauthenticated visitors to `/`. It also renders `AppNav` and the demo read-only banner.

Outside that group (these are real URL segments, not route groups):
- `auth/callback` and `auth/setup-password`: PKCE exchange and password setup for invite recipients
- `demo/`: sessionless public demo page
- `share/[slug]/`: public user profile page
- `api/`: external integration endpoints

The proxy enforces access control: unauthenticated visitors on protected paths are redirected to `/`; authenticated users on `/` are redirected to `/dashboard`.

### Server Actions vs API Routes

Use **server actions** for all mutations: trips, destinations, experiences, photos (record operations), bucket list items, and share settings. They live in `src/lib/actions/`. Every action calls `isDemoBlocked()` as the first statement.

Use **API routes** for:
- External service proxies that need custom headers or non-JSON responses (geocoding, Wikimedia image proxy)
- Auth flows that must be reachable without a session or must return HTML (approve-access, deny-access, request-access)

### Supabase Client Setup

Three clients exist for three contexts:

1. **`utils/supabase/client.ts`:** Browser client, anon key, scoped to batchport schema. Use in Client Components for direct browser operations (e.g., Storage uploads in `uploadPhoto()`).

2. **`utils/supabase/server.ts`:** Server client, anon key with SSR cookie handling, scoped to batchport schema. Use in Server Components, Route Handlers, and Server Actions. The factory is async because it must `await cookies()`.

3. **`utils/supabase/admin.ts`:** Service-role client, uses `SUPABASE_SERVICE_ROLE_KEY`, bypasses RLS. NOT scoped to batchport schema. Every query must explicitly call `.schema("batchport")` on each query chain. Use only for privileged operations: inviting users, geocode_cache reads/writes, cover photo Storage cleanup, share settings uniqueness checks.

### RLS Pattern

Every user table has a `user_id` column and an RLS policy scoped to `auth.uid()`. The public share surface relies on an `is_shared()` SQL function in Supabase that returns true when a user has `public_share_enabled = true` in user_settings or `is_demo = true`. The anon client (no session) can SELECT through this helper without authentication. Do not use the admin client for share data fetching; it would bypass RLS and expose private profiles.

## Key Patterns

### Geocoding Flow

1. User types in a `LocationSearch` component, which calls `GET /api/geocode/search?q=...`.
2. The route proxies to Photon, parses the response with `parsePhoton()` (in `lib/geocode.ts`), deduplicates by `(normalized name | country_code)`, and writes the raw response to `geocode_cache` for 30 days.
3. User selects a result. The component calls `GET /api/geocode/lookup?lat=...&lng=...` which proxies to Nominatim reverse, parses with `parseNominatim()`, and caches.
4. The resolved `GeoLocation` (name, country, country_code, admin_region, lat, lng) feeds into the destination form, which sends `geom = SRID=4326;POINT(lng lat)` to the server action.

POI search for experiences uses `GET /api/geocode/poi?q=...&lat=...&lng=...` (Photon with location bias). OSM key/value tags are mapped to app category slugs in `osmToCategorySlug()` in `lib/geocode.ts`. Results are deduplicated by normalized name.

### Photos Flow

1. User picks a file in the upload component (Client Component).
2. `resizeImage()` in `lib/photos.ts` downscales via canvas to max 1920x1080 at 0.85 quality, preserving the source format (png/webp) or converting to jpeg.
3. `uploadPhoto()` uploads the resized blob to the `batchport` Storage bucket at the path `{userId}/{ownerType}/{ownerId}/{timestamp}_{filename}`.
4. `insertPhotoRecord()` server action saves the database row with `source: "upload"` and the storage path.
5. `getPhotoUrl()` constructs the public Storage URL for uploads; routes wikimedia external URLs through `/api/photos/wikimedia/proxy` to avoid CORS.

Wikimedia auto-population on destination create: `createDestinationAction` calls `autoPopulateDestinationCover(destination)` after the insert. This calls `getWikimediaPhoto(destination.name)` using the destination name only (not "city, country"). It searches Wikidata for the entity, reads the P18 (image) claim, builds the canonical upload.wikimedia.org URL, fetches attribution from Commons extmetadata, caches the result in geocode_cache under provider="wikimedia" for 90 days, inserts a photo record, and sets it as the destination cover. Any failure is swallowed silently so it never blocks destination creation.

### Globe Rendering

The globe is `src/components/map/globe.tsx`. It uses **MapLibre GL JS** native GeoJSON layers. The deck.gl packages in package.json are unused by the rendering code.

Layer stack (bottom to top):
- Dark base style (bundled JSON or PMTiles raster)
- `country-bucket`: amber fill for unfulfilled bucket list countries
- `country-visited`: brand-blue fill for visited countries, lightens on hover
- `country-visited-outline`: border around visited countries
- `country-outline`: all country borders (from the base style)
- `trip-arcs-glow`: wide blurred glow behind arcs
- `trip-arcs`: sharp great-circle arc lines
- `pins-glow`: blurred circle glow per destination
- `pins`: white circle with color-coded stroke per destination (color from primary experience category)

Country fills match features using the `ISO_A2_EH` property field in countries.geojson. Using `ISO_A2` instead would silently fail to match any country.

Great-circle arcs are computed client-side in `greatCirclePoints()` using spherical linear interpolation with 48 segments. Longitudes are unwrapped across the antimeridian. Arc coordinates are stored as `[lng, lat]` (GeoJSON order).

The map is initialized once in a `useEffect` with a stable ref. Live data changes (new destinations, visited countries) update the GeoJSON sources via a second `useEffect` that calls `source.setData()`.

### Auth Flow

1. User submits name, email, and optional referral to `POST /api/request-access`.
2. Route validates the payload, signs an HMAC-SHA256 token over the email using `APPROVAL_SECRET`, and sends an HTML email to `BATCHPORT_ADMIN_EMAIL` via Resend with Approve and Deny links.
3. Admin clicks Approve, hits `GET /api/approve-access?email=...&token=...`.
4. Route verifies the HMAC token, calls `supabase.auth.admin.inviteUserByEmail(email, { redirectTo: APP_URL/auth/setup-password })`, and optionally sends a welcome email.
5. User receives the Supabase invite email, clicks it, and lands on `/auth/setup-password` to set a password.
6. After password setup, the PKCE exchange at `/auth/callback` creates the session and redirects to `/dashboard`.

Demo user: the UUID `703fbe07-db8a-41bd-bdee-928c2fa88107` is hardcoded in `lib/constants.ts`. The `/demo` page fetches data for this user via `getDemoUserId()` without a session. When a real user signs in as the demo account, all server actions are blocked by `isDemoUser`.

### Public Share Flow

1. User enables sharing and sets a slug in `/dashboard/settings` via `updateShareSettings` server action.
2. The action validates the slug (length, format, reserved words, uniqueness via admin client), then upserts into `user_settings`.
3. `/share/[slug]` calls `getUserBySlug(slug)` (anon client; RLS checks `public_share_enabled = true` or `is_demo = true`) to resolve the user ID.
4. `getSharedProfile(userId)` fetches stats, map data, and trips in parallel using the anon server client.
5. `SharedProfileView` renders the same globe, stats, and trip list layout used by the authenticated dashboard.

### Stats Flow

All stats come from SQL views and the `f_distance_traveled` RPC in the batchport schema. `getAllStats(userId)` in `lib/stats-data.ts` fires eight parallel queries and returns a `StatsData` object. Components receive data as props; there is no client-side aggregation.

PostgREST can serialize numeric view columns as strings to preserve precision. The `num()` helper in `stats-data.ts` coerces them defensively before passing to charts.

## Common Gotchas

- **proxy.ts not middleware.ts:** Next.js 16 renamed the middleware file convention to "proxy". The session refresh and route guard live in `src/proxy.ts`. Creating a `src/middleware.ts` file would have no effect.

- **Admin client is not schema-scoped:** `createAdminClient()` returns a service-role client with no default schema. Every call must chain `.schema("batchport")` before `.from(...)`. Forgetting this silently queries the `public` schema and returns empty results or cryptic errors.

- **Generated lat/lng columns:** `destinations.latitude` and `destinations.longitude` are generated from `geom`. Never include them in INSERT or UPDATE payloads. Write only `geom` with EWKT: `SRID=4326;POINT(lng lat)`. The same rule applies to the experiences `geom` column.

- **Async cookies():** `cookies()` from `next/headers` is async in Next.js 16. The `createClient()` server factory is already async for this reason. Any new Route Handler or Server Action that needs the server client must `await createClient()`.

- **ISO_A2_EH in GeoJSON:** The countries GeoJSON uses `ISO_A2_EH` as the country code property, not `ISO_A2`. The globe's match filter uses `["get", "ISO_A2_EH"]`. Using the wrong field name causes all country fills to silently match nothing.

- **Wikimedia query uses city name only:** `getWikimediaPhoto` is called with the destination name alone (e.g., "Paris"), not "Paris, France". The Wikidata entity search returns better results with a bare city name. Do not append country information to the query.

- **Demo guard must be first:** `isDemoBlocked()` must be the first statement in every mutation server action. The UI may also hide edit controls via `isDemoUser(user.id)`, but the action-layer guard is the actual security boundary.

- **is_shared() RLS requires the anon client:** Share data reads must use the anon server client, not the admin client. The anon key triggers RLS and the `is_shared()` helper. Switching to the admin client for share routes would bypass RLS and expose any user's private data.

- **batchport schema must be exposed in Supabase:** Settings, API, Exposed schemas must include `batchport`. Without this, PostgREST rejects all anon-client queries to the schema.

- **Redirect URL must be registered:** The Supabase dashboard under Authentication, URL Configuration, Redirect URLs must include `https://batchport.batch-apps.com/auth/setup-password` (and the localhost equivalent). Missing this causes the invite link to silently break by stripping the `redirectTo` parameter.

## File Locations

| What | Where |
|---|---|
| Browser Supabase client | `src/utils/supabase/client.ts` |
| Server Supabase client | `src/utils/supabase/server.ts` |
| Admin (service-role) Supabase client | `src/utils/supabase/admin.ts` |
| Session refresh and route protection | `src/proxy.ts` |
| Domain types (mirrors Postgres schema) | `src/lib/types.ts` |
| Demo user ID constant | `src/lib/constants.ts` |
| requireUser() helper | `src/lib/current-user.ts` |
| isDemoUser(), demo guard helpers | `src/lib/demo.ts` |
| isDemoBlocked() server action helper | `src/lib/demo-guard.ts` |
| Trip data layer | `src/lib/trips.ts` |
| Destination data layer | `src/lib/destinations.ts` |
| Experience data layer and getCategories() | `src/lib/experiences.ts` |
| Bucket list data layer and auto-fulfill | `src/lib/bucket-list.ts` |
| Photo helpers (client-safe: resize, upload, URL) | `src/lib/photos.ts` |
| Photo server reads and Wikimedia auto-populate | `src/lib/photos-data.ts` |
| Globe data layer (getMapData) | `src/lib/map-data.ts` |
| Stats data layer (all views and RPC) | `src/lib/stats-data.ts` |
| Public share data layer | `src/lib/share-data.ts` |
| Share settings read side | `src/lib/share-settings.ts` |
| Geocoding cache and parsers | `src/lib/geocode.ts` |
| Wikimedia P18 lookup and cache | `src/lib/wikimedia.ts` |
| HMAC token utils | `src/lib/access-token.ts` |
| Trip server actions | `src/lib/actions/trips.ts` |
| Destination server actions | `src/lib/actions/destinations.ts` |
| Experience server actions | `src/lib/actions/experiences.ts` |
| Photo record server actions | `src/lib/actions/photos.ts` |
| Bucket list server actions | `src/lib/actions/bucket-list.ts` |
| Share settings server action | `src/lib/actions/share-settings.ts` |
| Globe rendering component | `src/components/map/globe.tsx` |
| Dashboard globe wrapper (overlay + drill-down) | `src/components/map/dashboard-globe.tsx` |
| Photo upload component | `src/components/photos/photo-upload.tsx` |
| Location search (geocoding typeahead) | `src/components/location-search.tsx` |
| POI search | `src/components/poi-search.tsx` |
| Rating input (half-star) | `src/components/rating-input.tsx` |
| Shared profile view (demo and /share/[slug]) | `src/components/share/shared-profile-view.tsx` |
| Seed script | `scripts/seed-trips.ts` |
| PWA icon generator | `scripts/generate-icons.mjs` |

## Testing

Run `npm run build` to verify type correctness across the whole project (TypeScript strict mode). Run `npm run lint` for ESLint. There is no automated test suite. Interactive features including the globe, photo lightbox, geocoding typeahead, and experience dialog require manual browser testing.

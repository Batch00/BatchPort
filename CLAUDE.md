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

Four clients exist for four contexts:

1. **`utils/supabase/client.ts`:** Browser client, anon key, scoped to batchport schema. Use in Client Components for direct browser operations (e.g., Storage uploads in `uploadPhoto()`).

2. **`utils/supabase/server.ts`:** Server client, anon key with SSR cookie handling, scoped to batchport schema. Use in Server Components, Route Handlers, and Server Actions. The factory is async because it must `await cookies()`.

3. **`utils/supabase/public.ts`:** Sessionless anon client, scoped to batchport, built on `@supabase/supabase-js` so it reads no cookies. Because it touches no Request-time API, its reads can run inside a cache scope (`unstable_cache`), which the cookie-backed server client cannot. RLS applies exactly as it does for a signed-out visitor, so it reaches only `is_shared()` data. Returns null when the Supabase env vars are absent. Used by the landing hero; do not reach for the admin client to do this job.

4. **`utils/supabase/admin.ts`:** Service-role client, uses `SUPABASE_SERVICE_ROLE_KEY`, bypasses RLS. NOT scoped to batchport schema. Every query must explicitly call `.schema("batchport")` on each query chain. Use only for privileged operations: inviting users, geocode_cache reads/writes, cover photo Storage cleanup, share settings uniqueness checks.

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

### Photo Deletion Cascade

`photos` is polymorphic (`owner_type` + `owner_id`, no foreign key), so Postgres cascades never touch it: deleting a trip cascades to its destinations and experiences but leaves every photo row behind as an invisible orphan. `src/lib/photo-cleanup.ts` owns the fix and is shared by the photo delete action and the three entity delete actions.

The convention for an entity delete action:

1. Collect the photo owners **before** the delete (`ownersForTrip`, `ownersForDestination`, `ownersForExperience`), while the child rows still exist to be listed. These collectors never throw; a failure degrades to the owners they resolved.
2. Perform the entity delete.
3. Call `cleanupPhotosForOwners(owners)` after it. This is strictly best-effort and never throws: orphaned photos are recoverable (`scripts/cleanup-orphan-photos.ts`), a resurrected trip is not.

`deletePhotosByIds` is the shared core. Order matters: clear cover pointers first (checked, since a dangling pointer would block the row delete and a trip's cover can reference a destination-owned photo), delete rows next (the source of truth), then best-effort Storage removal LAST. Only `source === "upload"` objects and their derived `{path}_thumb` are removed; Wikimedia cache files live at a shared `wikimedia/{hash}` path other rows may still reference, so they always stay.

### Landing Hero Globe

The landing page (`src/app/page.tsx`) renders the public demo account's real travel history, not mock data.

- `getLandingGlobeData()` in `lib/landing-data.ts` reads the demo user through `createPublicClient()` (sessionless anon, gated by `is_shared()`), reusing `getDemoUserId()` and `getMapData()`. Both accept an optional client argument for exactly this purpose.
- The read is wrapped in `unstable_cache` with a 1 hour revalidate and the `landing-globe` tag. **The route cannot be ISR:** the root layout exports `dynamic = "force-dynamic"` (it prevents a Next 16 Turbopack prerender crash on the internal `_not-found` and `_global-error` routes), and a page cannot loosen a parent's `force-dynamic`. Caching the data instead keeps Supabase off the hot path, which is what the render mode would have bought. This is also why the read must be cookie-free: `cookies()` is not allowed inside a cache scope.
- Planned trips are filtered out of the hero. Their hollow pins and dashed arcs need the legend and trip list that only /demo has.
- The fallback is `buildMockGlobeProps()` in `lib/mock-travel-data.ts`, a **generated** file. Do not hand-edit it: run `npm run generate-mock-globe`, which derives it from `scripts/demo-dataset.ts`, the same fixture `seed-demo.ts` writes. The fallback is chosen server-side in the same render as the live read, so there is never a client-side swap or a flash.

### Trip Dates and Stop Order

Two rules, both owned by `lib/trip-dates.ts` (pure) and enforced on write by
`lib/trip-schedule.ts` (server):

- **A dated trip's range is its stops.** If any destination carries a date, the
  trip runs from the earliest arrival to the latest departure. The stored
  `trips.start_date` / `end_date` columns are the fallback for a trip nobody has
  dated a stop on, never a second opinion about one that has been.
- **Stops are in date order.** `order_index` is still the stored sequence and
  still the manual order for an undated trip, but a dated stop belongs where its
  date puts it regardless of when it was typed in.

The stored columns are **kept in sync**, not replaced by derive-on-read, because
the SQL stats views read `trips.start_date/end_date` directly
(`v_user_travel_summary.days_traveling`, `v_yearly_breakdown`) and a view cannot
call a TypeScript function. `syncTripSchedule(tripId)` runs after every
destination create, update, and delete, and after a trip edit; it renumbers only
the `order_index` values that actually moved and only writes the trip row when
the derived range differs. It is best-effort and logs rather than throwing.

Every read path *also* applies the same pure functions
(`chronologicalDestinations`, `resolveTripDates`), so rows written before the
sync existed, or a sync that failed, still render correctly. The two can never
disagree because they are the same function. A failed sync degrades to stale SQL
views, never to a wrong date on screen.

Because `order_index` is renumbered to match, everything downstream of the route
sequence keeps reading `order_index` alone: the globe's arc order, the replay
timeline, the story, and "the leg into stop N". Nothing else had to learn about
dates. `getMapData` re-issues `orderIndex` as the position in visit order rather
than copying the column, so the globe is correct even on unsynced rows.

The trip form does not offer a date range when the stops supply one: it renders
the derived range read-only with a line saying where it came from. A trip with
no dated stops and no manual dates still reads "Dates to be decided".

Trip and destination dates are entered through `components/ui/date-range-picker.tsx`,
a hand-rolled single-calendar range picker over YYYY-MM-DD strings (no date
dependency; it uses the Radix Popover already available through `radix-ui`). All
of its arithmetic is UTC-anchored: a local `Date` on a YYYY-MM-DD string lands on
the previous day west of Greenwich.

### Map Control Model

`src/components/map/map-controls.tsx` ranks controls by **how often they are used**, not by whether they are a mode or a utility. That distinction was the old model and it put recenter (constant) three clicks deep while nearby (occasional) held a permanent button. Keep the current split:

- **Visible buttons:** photo map, replay, recenter, settings. Four, in that order, bottom-right.
- **The popover:** basemap swatches first, then projection, fullscreen, refresh, and the modes (nearby, show attractions) last. Modes sit at the bottom because the popover opens upward from a bottom-anchored trigger: the last row is nearest the thumb, and the list grows away from the top-right search corner instead of toward it.
- The popover's height is **measured against the map**, not the viewport: it caps at the gap between the map's top edge and the control cluster, less the search button's clearance, and scrolls past that. The map clips its own overflow (`data-globe-surface` marks it), so a menu sized in viewport units is either clipped mid-row on a short card or needlessly short on a tall one.
- Because two modes live out of sight, the popover trigger takes a brand tint plus a small brand dot whenever one is active, and its `aria-label` says so. Never let a mode run with no visible signal. The active menu row is tinted too and carries `role="menuitemcheckbox"`.
- Resting state is at most four buttons plus search. Adding a fifth means rethinking the model, not appending a button.
- The cluster is a bottom-right vertical column at every breakpoint; search anchors top-right. This is what makes the mobile collision structurally impossible (bounded cluster height, bottom-anchored, against a 300px minimum map height everywhere). Do not reintroduce a top-anchored phone column.

Overlay corner system: top-left for status chrome (stats pill, photo-mode header, replay readout), top-right for search, bottom-right for the control cluster, bottom-centre for the transient style-loading pill, bottom-left for MapLibre attribution.

### Globe Rendering

The globe is `src/components/map/globe.tsx`, which owns the map lifecycle, interaction handlers, and mode wiring. Supporting modules:

- `globe-types.ts`: the public data shapes (re-exported from `globe.tsx`, so existing imports keep working)
- `globe-sources.ts`: pure GeoJSON builders and popup HTML helpers
- `globe-layers.ts`: every runtime overlay layer plus `applySky`, called on first load and re-called after each basemap switch
- `basemaps.ts`: the basemap catalog, style resolution, per-style overlay themes, zoom caps, and the countries GeoJSON cache

It uses **MapLibre GL JS** native GeoJSON layers.

Layer stack (bottom to top):
- Dark base style (bundled JSON or PMTiles raster)
- `country-bucket`: amber fill for unfulfilled bucket list countries
- `country-visited`: brand-blue fill for visited countries, lightens on hover
- `country-visited-outline`: border around visited countries
- `country-outline`: all country borders (from the base style)
- `trip-arcs-glow`: wide blurred glow behind air arcs
- `trip-arcs`: sharp great-circle arc lines (air family: flights and unrecorded hops)
- `trip-arcs-ground`: violet dashed lines for train/bus/car/bike/walk legs
- `trip-arcs-sea`: cyan dotted lines for ferry legs
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

### Nearby Mode and Device Location

Nearby is the only feature that touches the user's live position, and it is
built around one rule: **the position is session state, never data.** Concretely:

- `navigator.geolocation.getCurrentPosition` is called only from an explicit
  tap (entering the mode, or the panel's refresh/retry). Nothing prompts on page
  load, and there is no `watchPosition`, so there is no background tracking.
- The fix lives in `useNearby`'s React state for the life of the mode and is
  dropped on exit. It is never written to storage, never sent to an API, and
  never included in a server action payload. The single exception is the
  experience the user deliberately creates in the log sheet (and its `geom`),
  plus the checkoff they deliberately tap.
- A denial is terminal for the session: the panel explains itself once and
  offers an exit. Only another explicit tap re-asks.

If a future change needs the position anywhere else, that is a new decision,
not an implementation detail. Do not add a persistence layer, a "last known
location" cache, or an analytics event carrying coordinates.

The proximity radii live in `lib/nearby.ts` with the reasoning attached:
50km for "which of my stops am I in", 250m for "am I at the thing I planned",
150m for "is this geosearch result what I am looking at". `lib/nearby.ts` is
pure and client-safe; `lib/nearby-data.ts` is the server read and, like search
and export, takes no userId so RLS is the boundary.

Nearby borrows the attractions layer rather than duplicating it
(`useAttractions().enable()` starts it without recording a preference), and
hands it back on exit unless the user already had it on.

It borrows the **basemap** the same way (`use-detail-basemap.ts`). The dark
minimal style has no detail past country shapes and `maxZoomForBasemap` caps it
at zoom 10, which is exactly where the attractions layer switches on and well
short of the 13 nearby flies to, so both modes switch to `streets` while they
run. Three rules keep it honest: it is a loan (nothing is written to
sessionStorage), a manual basemap change during the mode wins and abandons the
restore, and the loan is reference counted so nearby and attractions can hold it
at once. Nearby requests it only once a fix arrives, so a denial leaves the map
as it was found. With no `NEXT_PUBLIC_MAPTILER_KEY` there is nothing to borrow,
every call is a no-op, and both modes run on dark exactly as before.

### Historical Weather

`lib/weather.ts` answers "what was it like the days you were there" from the
same Open-Meteo ERA5 archive that backs the discovery climate line. Two things
shape the design:

- **ERA5 lags real time by several days.** The requested window is truncated to
  `today - 6 days` before the fetch, and the cache key uses the truncated end
  date. A window that was still partly in the future when it was cached simply
  misses tomorrow and refetches a longer one, so ongoing trips fill in by
  themselves. `partial` is recomputed per request, never trusted from the cache.
- **Past observations do not change**, so the TTL is a year, far longer than the
  30 and 90 day geocoding TTLs.

The route (`/api/weather/visit`) is public in `proxy.ts` because it carries no
user state (a coordinate and a date range in, daily numbers out), which is what
lets /demo and /share render the same line. It returns 204, not 404, when there
is nothing to say: the caller's answer is "omit the line".

The component fetches client-side for the same reason the climate line does: a
cache miss goes out to Open-Meteo, and no page should block its render on that.
Everything degrades to absent. No dates, no coordinates, a planned trip, a
window inside the lag, or an upstream failure all mean no line, never an empty
state.

### Journal, Story, and On This Day

Three surfaces that read the trip rather than edit it. The rules that hold
them together:

- **A journal entry is keyed by a date, never by a destination.** Which stop a
  day belongs to is already fully determined by the destination
  arrival/departure ranges, so `destinationForDate()` derives it on read. A
  `destination_id` column would be a second copy that drifts the first time a
  stop's dates are edited. If a future change needs the stop pinned (a stop
  the user deliberately overrides), that is a new decision, not a column to
  add quietly.
- **A blank body is not stored.** Clearing the text deletes the row, so "has
  an entry" is a row check everywhere and never a length check.
- **Only the flushing save revalidates.** `saveJournalEntryAction` takes
  `{ final }`; the debounced autosaves pass false. An app-wide
  `revalidateAppData()` mid-typing would re-render the trip page under the
  caret. Blur, the Done button, and closing the row pass true.
- **Journaling applies to completed and ongoing trips only** (`journalingApplies`).
  A planned trip's day structure already belongs to the planner.
- **The section is one disclosure per trip, closed by default**, and opens to
  the days that already have an entry with a "Show all N days" switch to reach
  an empty one. A journal with nothing in it opens to every day instead, or
  there would be no way to start. The header carries the entry count so the
  closed state still says whether there is writing inside. Do not nest the days
  a second time under per-stop headers: the destination list directly above
  already groups them, and it would add a click to reach any given day.

`lib/story.ts` is pure and takes a `StoryTrip` the caller assembles from rows
it already has. That is what lets the trip page, /demo, and /share/[slug]
render the same component with no second data layer, and why the story costs
no extra query anywhere. `getProfileTrips(userId, { story: true })` is the
read-only path's assembler; the option exists because the dashboard renders
neither journal prose nor a full photo list and should not ship them.

The composition rule, in one sentence: a slide is a day, a day belongs to the
stop whose stay contains it, and everything dated that day lands on it. Days
with nothing are skipped. Undated photos and experiences ride their stop's
first slide, and a stop with no dated day gets one slide of its own, so
nothing silently disappears.

`TripStory` renders through `createPortal` into `document.body`. Its launch
points sit inside cards that create their own stacking context (the share card
is `isolate`), and a `fixed z-50` element inside one of those cannot rise above
the cards after it. Do not "simplify" the portal away.

`getOnThisDay()` enumerates concrete anniversary dates rather than filtering
on `date_part`, because Postgres cannot index the latter and this app is not
adding an index for a thumbnail strip. It returns null when nothing matched;
callers render nothing. There is no empty state.

### Transport Legs

How the traveller got from one stop to the next. The model is one sentence:
**a leg belongs to the arriving destination, one row per stop.** Order within a
trip already comes from `destinations.order_index`, so storing an origin id
would be a second copy of that ordering and would be wrong the first time a
stop is reordered or deleted. "The leg into stop N" is a unique constraint on
`destination_id` and nothing more, which also means the leg on the first stop
is the journey out from home for free. The journey home after the last stop is
deliberately not modelled: it is not a hop between two things this app knows
about, and a nullable `destination_id` to hold it would cost the unique key
that keeps everything else simple.

`lib/transport.ts` is pure and client-safe (the mode catalog, arc families,
formatting, and the breakdown fold); `lib/transport-data.ts` is the server
read, and like search and export `getTransportLegs` takes no userId so RLS is
the boundary. `getSharedTransportByTrip` is the deliberate exception, mirroring
`getSharedJournalByTrip`.

Three rules hold the rest together:

- **Mode is the only required field.** Carrier, duration, distance, and notes
  live behind an "Add details" disclosure, and tapping a mode in the sheet
  saves immediately. Recording "we took the train" costs one tap, because the
  alternative is that nobody records anything.
- **Arcs style by family, not by mode** (`arcFamily`): air is the existing
  solid brand-blue great circle with a glow and covers flights *and every hop
  with no recorded mode*, so an unannotated map looks exactly as it always did;
  ground is violet and dashed; sea is cyan and dotted. Three layers rather than
  one data-driven paint because `line-dasharray` is not a data-driven property
  in MapLibre, the same constraint that already gives planned arcs their own
  layer. **Replay draws the same three families**, from the same one source
  split by a `family` feature property (`replay-arc-line`/`-glow` for air,
  `replay-arc-ground`, `replay-arc-sea`), and tints the growing arc's head to
  match. The mode reaches the timeline on `GlobeDestination.transportMode`, on
  the arriving stop, because that is where a leg lives. There is no globe legend: the overlay corners are spoken for, and the
  trip page's leg rows carry a dot in the matching arc colour, which teaches
  the language where a leg is authored.
- **Distance is broken down, never adjusted.** Every kilometre in
  `getTransportBreakdown` is the same great-circle measure `f_distance_traveled`
  counts, which is fair for a flight and an understatement for a road. A detour
  multiplier would be a number the app invented, so the caption states the
  measure instead, unrecorded hops are named rather than folded in, and a leg
  whose owner typed a real `distance_km` uses that. The CO2 line is one muted
  sentence from published per-passenger-km factors, presented as an estimate and
  never as a judgement; `gramsCo2PerKm: null` ("other") drops out of it.

### Search, Export, and Home Location

Three surfaces read the current user's own rows and must never take a userId
argument. `searchUserData()`, the export builders in `export-data.ts`, and
their API routes all read through `requireUser()`'s session-scoped client, so
RLS is the access boundary and no request can name another account. Adding a
userId parameter to any of them, or switching them to the admin client, would
turn them into a data leak. `getHomeLocation(userId)` is the exception and
takes one, because it uses the admin client for the same reason
`getShareSettings` does (the user_settings row may not exist yet); its callers
pass the id from `requireUser()`.

Search builds a PostgREST `.or()` filter by hand. Values are double quoted so
a typed comma or parenthesis cannot break out of the term, and every wildcard
character (`%`, `_`, `*`, `\`) is mapped to `_`. Backslash escaping does not
work here: PostgREST unquotes the value before it becomes a LIKE pattern and
separately translates `*` to `%`, so an escaped wildcard reaches Postgres as a
live one. See `orTerm()` in `search.ts`.

Everything downstream of the home location degrades to absent, never to an
empty state: no home means no distance lines, no furthest-from-home tile, and
no timezone chip. Nothing in the app prompts the user to set one.

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
| Sessionless anon Supabase client (cache-safe) | `src/utils/supabase/public.ts` |
| Admin (service-role) Supabase client | `src/utils/supabase/admin.ts` |
| Session refresh and route protection | `src/proxy.ts` |
| Domain types (mirrors Postgres schema) | `src/lib/types.ts` |
| Demo user ID constant | `src/lib/constants.ts` |
| requireUser() helper | `src/lib/current-user.ts` |
| isDemoUser(), demo guard helpers | `src/lib/demo.ts` |
| isDemoBlocked() server action helper | `src/lib/demo-guard.ts` |
| Trip data layer | `src/lib/trips.ts` |
| Trip date derivation and stop ordering (pure) | `src/lib/trip-dates.ts` |
| Trip date and order_index sync (server write) | `src/lib/trip-schedule.ts` |
| Single-calendar date range picker | `src/components/ui/date-range-picker.tsx` |
| Destination data layer | `src/lib/destinations.ts` |
| Experience data layer and getCategories() | `src/lib/experiences.ts` |
| Bucket list data layer and auto-fulfill | `src/lib/bucket-list.ts` |
| Photo helpers (client-safe: resize, upload, URL) | `src/lib/photos.ts` |
| Photo server reads and Wikimedia auto-populate | `src/lib/photos-data.ts` |
| Shared photo deletion and owner collection | `src/lib/photo-cleanup.ts` |
| Photo map mode data layer | `src/lib/photo-map-data.ts` |
| Globe data layer (getMapData) | `src/lib/map-data.ts` |
| Nearby proximity helpers and radii (pure) | `src/lib/nearby.ts` |
| Nearby planned-experience points (server read) | `src/lib/nearby-data.ts` |
| Observed weather at time of visit | `src/lib/weather.ts` |
| Transport modes, arc families, breakdown (pure) | `src/lib/transport.ts` |
| Transport server reads and distance breakdown | `src/lib/transport-data.ts` |
| Transport server actions | `src/lib/actions/transport.ts` |
| Transport leg row and entry sheet | `src/components/trips/transport-leg.tsx` |
| Distance by mode stats card | `src/components/stats/transport-breakdown.tsx` |
| Journal day derivation and helpers (pure) | `src/lib/journal.ts` |
| Journal server reads | `src/lib/journal-data.ts` |
| Journal server action | `src/lib/actions/journal.ts` |
| Trip story slide builder (pure) | `src/lib/story.ts` |
| Trip story full-screen view | `src/components/trips/trip-story.tsx` |
| Trip story entry point | `src/components/trips/story-launcher.tsx` |
| Trip journal editor | `src/components/trips/trip-journal.tsx` |
| On this day data layer | `src/lib/on-this-day.ts` |
| On this day dashboard strip | `src/components/dashboard/on-this-day.tsx` |
| Landing hero globe data (cached anon demo read) | `src/lib/landing-data.ts` |
| Landing hero static fallback (generated) | `src/lib/mock-travel-data.ts` |
| Home location read side and distance helpers | `src/lib/home-location.ts` |
| Home location server action | `src/lib/actions/home-location.ts` |
| Global search data layer (server) | `src/lib/search.ts` |
| Global search client-safe shapes | `src/lib/search-types.ts` |
| Global search command palette | `src/components/search/global-search.tsx` |
| Data export builders (JSON and GeoJSON) | `src/lib/export-data.ts` |
| Superlatives derivation (pure) | `src/lib/superlatives.ts` |
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
| Globe overlay layers and sky | `src/components/map/globe-layers.ts` |
| Globe GeoJSON source builders | `src/components/map/globe-sources.ts` |
| Basemap catalog and style resolution | `src/components/map/basemaps.ts` |
| Map control cluster (modes + settings popover) | `src/components/map/map-controls.tsx` |
| Nearby mode hook (geolocation, marker) | `src/components/map/use-nearby.ts` |
| Detailed-basemap loan for street-level modes | `src/components/map/use-detail-basemap.ts` |
| Nearby status card | `src/components/map/nearby-panel.tsx` |
| Nearby "log something here" sheet | `src/components/map/log-here-sheet.tsx` |
| Observed-weather line | `src/components/weather/visit-weather.tsx` |
| Dashboard globe wrapper (overlay + drill-down) | `src/components/map/dashboard-globe.tsx` |
| Photo upload component | `src/components/photos/photo-upload.tsx` |
| Location search (geocoding typeahead) | `src/components/location-search.tsx` |
| POI search | `src/components/poi-search.tsx` |
| Rating input (half-star) | `src/components/rating-input.tsx` |
| Shared profile view (demo and /share/[slug]) | `src/components/share/shared-profile-view.tsx` |
| Seed script | `scripts/seed-trips.ts` |
| Demo showcase fixture | `scripts/demo-dataset.ts` |
| Demo reset and reseed | `scripts/seed-demo.ts` |
| Landing fallback generator | `scripts/generate-mock-globe.ts` |
| PWA icon generator | `scripts/generate-icons.mjs` |

## Testing

Run `npm run build` to verify type correctness across the whole project (TypeScript strict mode). Run `npm run lint` for ESLint. There is no automated test suite. Interactive features including the globe, photo lightbox, geocoding typeahead, and experience dialog require manual browser testing.

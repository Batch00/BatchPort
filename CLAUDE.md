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

### Which Photo Size a Surface Requests

`getPhotoUrl(photo)` is the full image (up to 1920x1080). `getPhotoUrl(photo,
"thumb")` is the 400px gallery thumbnail. Picking between them is not a matter
of taste, and getting it wrong is invisible in code review and glaring on
screen: a thumbnail across a full-screen story slide is the blur that produced
this rule.

- **Grid tiles and small chips take the thumbnail.** Gallery cells, the
  dashboard and share trip cards, the recap's "year in trips" grid, the
  moments row, the On This Day strip, the offline photo cache.
- **Anything larger than a card takes the full image.** Story slides, recap
  slides, banners, the lightbox, the cover position editor, and both canvas
  exports. A card cover baked into a 2160px share card is the same mistake as
  one stretched across a slide.
- **Never both from one field.** Data layers that feed a card *and* a
  full-screen surface carry both urls (`ProfileTrip.coverUrl` /
  `coverFullUrl`, `StoryPhoto.thumbUrl` / `url`, `YearMoment.photoThumbUrl` /
  `photoUrl`). Making one field mean "whatever the biggest consumer needs" is
  how a dashboard ends up shipping twenty full-size JPEGs.
- **Warm-up must match.** The story's and the recap's "preload the next
  slide's lead image" effects fetch the exact url that slide will request. A
  warm-up that fetches the other size is two requests and no benefit.

`components/photos/slide-image.tsx` is how the full-screen surfaces render one
photo, and it owns both halves of the problem. Quality: the thumbnail paints
immediately as a placeholder and crossfades out when the full image arrives, so
nothing waits on a blank frame and nothing ships a blurry final state. Fit: it
measures its own frame and the image's natural size, and switches from
`object-cover` to `object-contain` over a blurred blow-up of the same photo once
the two aspect ratios disagree by more than 1.8x. That threshold puts a portrait
phone photo on a phone into cover (it fills, crop is modest) and the same photo
on a desktop slide into contain (nothing cropped). Mosaic cells pass
`allowContain={false}`: a four-photo grid is crops by design, and letterboxing
each cell turns one composition into four small pictures floating in blur.

**A cached image never fires `onLoad`.** The browser can finish an image out of
cache before React has attached the handler, and the event is then simply
missed: `loaded` stays false, the crossfade never runs, and a photograph that
downloaded perfectly sits at `opacity: 0` forever. `SlideImage` therefore keeps
a ref to its `<img>` and re-checks `complete` in an effect keyed on `src`, as
well as handling `onLoad`. It is easy to miss because the first view of any
photo is uncached and works; it bites on a second look at the same photo, and
it bit the curation preview immediately, where the thumbnail and the full image
can be the same file. `usePhotoRatio` in the picker guards the same trap for
the same reason.

The fit rule is exported as `willContain(frameAspect, imageAspect)` and the
threshold as `CONTAIN_THRESHOLD`, because the curation picker marks the
candidates that will be letterboxed without rendering them. A second copy of
`Math.max(a / b, b / a) > 1.8` in the picker is exactly the drift that matters:
the marker would go on saying "bars" for a week after somebody moved the
threshold. `useSlideFrameAspect()` is the other half, the shape a slide has on
this device, which is simply the viewport since both full-screen surfaces are
`fixed inset-0`.

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
  arrival/departure ranges, so `destinationForDate()` derives it on read
  (through `lib/stays.ts`, the same resolution the story uses). A
  `destination_id` column would be a second copy that drifts the first time a
  stop's dates are edited. If a future change needs the stop pinned (a stop
  the user deliberately overrides), that is a new decision, not a column to
  add quietly.
- **A blank body is not stored.** Clearing the text deletes the row, so "has
  an entry" is a row check everywhere and never a length check.
- **Only the flushing save revalidates.** `saveJournalEntryAction` takes
  `{ final }`; the debounced autosaves pass false. Blur, the Done button, and
  closing the row pass true. Not calling `revalidateAppData()` on every
  debounce does NOT keep the page still: **any Server Action makes the Next
  router refetch the current route**, whatever the action does about
  revalidation, so a debounced autosave already re-renders the trip page. That
  is harmless, because the textarea holds its own value and React reconciles
  rather than remounting. What `final` buys is that a paragraph does not fire
  twenty whole-app `revalidatePath("/", "layout")` calls. The same correction
  applies to the expense entry's debounced refresh; see
  `components/expenses/expense-workspace.tsx`, where it was measured.
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
STAY whose own range contains it, and everything dated that day lands on it.
Days with nothing are skipped. Undated photos and experiences ride their stop's
first slide, and a stop with no dated day gets one slide of its own, so
nothing silently disappears.

### A Day Belongs To A Stay, Never To A Place Name

`lib/stays.ts` is the whole of that resolution and is shared by the story, the
curation panel, and the journal, so all three answer "whose day is this"
identically. It exists because a trip's stops are ROWS: "Copenhagen,
Stockholm, Oslo, Copenhagen" is four stays, and the two Copenhagens have
nothing in common but a name.

- **The boundary rule: a day belongs to the stay that ARRIVED most recently on
  or before it.** When two ranges both contain a day the later arrival takes
  it, ties breaking on stored visit order, which also settles a stop nested
  inside another stop's range. The everyday case is a departure date equal to
  the next arrival, and it belongs to the stay you arrive at. The direction is
  forced: `planDayIso` numbers a stay's days from its arrival, so a stay that
  did not own its own arrival day would have a day 1 the story attributed
  somewhere else. `buildStayDays` implements it as "iterate in arrival order
  and let a later stay overwrite the day it shares", and `stayForDate` answers
  the same question for one date.
- **A day no stay contains belongs to NOBODY.** No nearest-stop fallback: that
  is what captioned a photograph taken the day before the trip with the first
  city, on a date that stop had not begun. A travel day with journal writing
  gets a slide with no stop on it; a photograph with nowhere to sit rides the
  opener rather than inventing a day.
- **Placement precedence** (`placeTripContent` in `lib/story.ts`): an item
  owned by an UNDATED stop stays with it (absence is not a conflict);
  otherwise the stay owning the item's date takes it, whichever row it hangs
  off, which is what separates a revisit when photographs of the second stay
  were uploaded onto the first; otherwise it stays with its owner as undated
  content. A stay's candidate days are exactly the days it owns, so a foreign
  date can no longer drag a day slide onto a stop.
- **Day numbering is anchored to the trip's first day on the ground**
  (`StayDays.firstDay`, the earliest day any stay owns). `trips.start_date` is
  a fallback for a trip nobody dated a stop on and nothing more, exactly as it
  is for the trip's range. A day before the anchor carries no number at all.
- **Day slides are emitted in one chronological run** and a stop opens at the
  first slide of each run of its own days, so a revisit gets two headers and
  two weather lines, and an undated stop keeps its place in visit order.
- Two places the rule deliberately does not reach, both documented in
  `lib/stays.ts`: the PLANNER's day sections still span the whole stay
  (`planned_day` is an offset the user already assigned, and dropping the
  contested last section would silently unassign what was planned on it), and
  the WEATHER window is the stay's own stored range (a coordinate and a range
  handed to an archive, not a claim about who owns a day).

`npm run check-stays` asserts all of it against the real shapes.

`TripStory` renders through `createPortal` into `document.body`. Its launch
points sit inside cards that create their own stacking context (the share card
is `isolate`), and a `fixed z-50` element inside one of those cannot rise above
the cards after it. Do not "simplify" the portal away.

`getOnThisDay()` enumerates concrete anniversary dates rather than filtering
on `date_part`, because Postgres cannot index the latter and this app is not
adding an index for a thumbnail strip. It returns null when nothing matched;
callers render nothing. There is no empty state.

### Year in Travel

`lib/year-recap.ts` is pure and takes a `YearRecapInput` the caller assembles
from `StoryTrip`s it already has, exactly like `lib/story.ts` and for the same
reason: the recap costs no query on any surface, and /demo and /share can open
it because building one reads nothing and writes nothing. The launcher does the
`ProfileTrip` to `StoryTrip` conversion client-side, so nothing new crosses the
server boundary.

Three rules, and everything in the file follows from them:

- **A year is a slice, not a bucket.** A trip that crosses new year is in both
  years, and each counts only its own part: days are clipped with
  `clipToYear`, and a stop, an experience, or a photo lands in the year its own
  date puts it in (falling back to its stop, then to the trip's first year, and
  the fallback is stated in the code rather than hidden). Distance counts a leg
  in the year its **arriving** stop falls in, the same rule transport legs use,
  so a hop over new year is counted once and on the right side. The map slide is
  the deliberate exception: it draws whole routes, because cutting a journey in
  half at midnight would draw a trip nobody took.
- **Planned is not history**, and a year that has not arrived is not offered.
  `recapYears` returns only years touched by a non-planned, dated trip, capped
  at the current year, so the picker can never lead to an empty recap. The
  closing slide is the one place planned trips appear, and it is explicitly
  about what is next.
- **Every year is named on the way in, not only inside the recap.** The picker
  has always existed and nothing outside said so, so the archive was invisible:
  the entry point opened the newest year and that was all anybody could see.
  `YearRecapLauncher` names them now. The `banner` variant (dashboard, /demo,
  /share) puts the newest year on the card at full size with its numbers and
  lists the rest as chips under it, all of them, wrapping, because a year chip
  is small and hiding one defeats the point. The `button` variant (stats page,
  on a header row with other actions) is a split button: the newest year plus a
  caret onto the same list, since chips would crowd that line. Inside the recap
  the trigger carries the caret and an "N more" count, because a bare label read
  as a caption rather than a control. Entry is still one tap for the obvious
  year on every surface.
- **Nothing is padded.** Every slide past the opener has a condition and a thin
  year simply produces fewer slides. There are no zero tiles on the scoreboard,
  no moments block without a rating, and no insight invented to fill a category.

**The year's photograph is one of its TRIPS' heroes, resolved once.**
`heroImage` asks each year-trip for its hero through the chain every other
surface uses (`tripHeroImage`: the curated `hero` slot, then the trip cover,
then its earliest dated photograph of the year) and picks between those. It
used to take the earliest dated photograph of the whole year, flat, so with
every trip on automatic the year opened on whatever carried the earliest EXIF
timestamp, and electing a hero on any trip but the earliest changed nothing.

The lead trip is **the curated one over an automatic one** (somebody answered
this question deliberately), then **the trip that took up most of the year**
(days already clipped to it; photo count would reward a camera and rating one
good afternoon), then the earliest. Steps 1 and 2 of the chain read the whole
trip rather than the year's slice, because a hero and a cover are elections
about a TRIP and a trip that crossed new year is wholly in both years; the
photograph fallback stays inside the slice, since it is a claim about the year.

The answer is carried on `YearRecap.hero` (`YearHero`, with a `source` saying
which step of the chain answered), and every surface that shows a photograph of
the year reads that one field: the opening slide and the scoreboard backdrop.
The year CARD is not in that list on purpose, because it leads with the map.

**A moment shows a photograph of the experience it names, or says it does
not.** `buildMoments` filters on `StoryPhoto.experienceId`, which is why that
field is carried separately from `destinationId`: collapsing the two made the
slide caption the first photo at the *stop* with the name of one experience at
it. Where the experience has no photo of its own the stop's cover is offered
as `photoOf: "place"` and the slide renders it dimmed under the category mark,
so it reads as the place rather than passing for the thing.

**The scoreboard is ranked, not listed.** Eight identical tiles is a report
footer at the exact moment a recap should land, so `buildScoreboard` splits the
numbers into one or two `leads` at real scale (distance and countries first,
in a fixed order rather than by size, or a big photo count outranks the year
itself), a quiet `stats` strip for the rest with no number appearing in both,
the year's own photograph as the backdrop, and a `closingLine` chosen from a
ladder of true statements. Null when there is nothing true to say; nothing is
padded here either. The trip story's closing slide is the same composition for
the same reason, so it is also the same two components
(`components/stats/scoreboard.tsx`), and two layout rules live in them:

- **A number and its unit are one line.** "4,660" over "km" is two facts
  stacked and reads as a second statistic, so `ScoreValue` measures the line
  against the column it has to fit and scales the type down until it fits
  rather than letting it wrap. The measuring copy carries the FINAL value (a
  count-up cannot change the fit as it runs) and is a shrink-to-fit line inside
  a zero-height clipped wrapper: `getBoundingClientRect`, never `scrollWidth`,
  which never reports less than the element it sits in and so measures every
  fitting line as exactly its own column. The unit rides in `em`, which keeps
  it subordinate and on the same baseline at every size.
- **A row that must wrap wraps evenly.** `ScoreStrip` takes its column count
  from the number of tiles, so five sit on one row instead of four and an
  orphan, and steps the type down at five and six. Where the row cannot fit,
  `balancedColumns` picks the widest split that does not leave one tile alone
  on the last row (five over three columns is 3 + 2), the same principle the
  share card's places line uses.

**Insights are ranked in bands** (`INSIGHT_BASE` plus a bounded bonus), not on a
free-running score. Free scores let a wide margin on the weakest question
("your busiest month") outrank the strongest one ("somewhere new"), which is how
a recap ends up leading on a fact nobody asked for. Each candidate must also be
true as stated: "where you went deepest" needs a strict winner, because on a tie
the caption would be a plain untruth.

`todayIso()` is the one impure function in the file and is called **on the
server**, in the page, so the offered years and the "so far" label cannot differ
across hydration. Every check in `scripts/check-year-recap.ts` passes `today`
explicitly, which is what makes the year logic testable at all
(`npm run check-year-recap`).

**The closing slide names bucket list places, it does not score them.** "0 of
7" is a scoreboard for a thing that is not a game. `yearBucket()` splits the
list in two: what was ticked off **in this year** (the year's own achievement,
so it leads) and the highest-ranked places still to go, three of each at most.
Their photographs come from `lib/bucket-hero.ts`, the same lookup and the same
session cache the bucket cards use, so one place cannot show two different
pictures. The totals still come from the SQL view; a surface holding only
totals still renders the bar with nothing named, and no list at all renders
nothing.

**The map slide reuses the replay engine, not a second timeline.**
`buildReplayTimeline` / `replayStateAt` / `sliceLeg` decide what has happened;
`lib/poster/year-map.ts` paints it with the poster's projection and `drawMap`.
The ocean, graticule, and neutral land go into an offscreen canvas once and are
blitted per frame, because re-projecting every country outline sixty times a
second is the difference between this running on a phone and not. Only the
reached countries, the arcs, and the pins are redrawn. React is kept out of the
loop: the readout is compared before it is set, so a playback costs a few dozen
renders rather than a few thousand.

**The map slide's pacing is the viewer's.** It offers 1x/2x/4x and a skip, both
held in refs alongside their state, because the animation loop reads them every
frame and rebuilding the effect to pick up a change would restart the playback
from zero. Playback time is **accumulated** (`advancePlayback` in `lib/replay.ts`,
`clock + dt * speed`) rather than derived from a start stamp, so raising the
speed mid-flight speeds up what is left instead of jumping the clock to where it
would have been at the new rate all along. Both controls disappear once the year
is drawn: there is nothing left to hurry, and the row becomes the replay button.

**The clock lives OUTSIDE the animation effect**, in a ref, and this is
load-bearing. The effect has to be rebuilt whenever the canvas is (a resize,
the outlines arriving), and with the clock inside it every rebuild silently
restarted the year from zero. Two things then conspired: the header's trip-name
line dropped out during the gap between two trips, which changed the header's
height, which resized the canvas; and `setSize` allocated a fresh object on
every ResizeObserver callback whether or not the numbers had changed. So the
year could never get past its first trip, and at 4x it hit that wall four times
sooner, which is why the speed control looked like the cause. All three are
fixed and must stay fixed: the clock is a ref keyed to its timeline, the trip
line always renders (a non-breaking space when empty), and `setSize` bails on
an unchanged measurement. `npm run check-year-map-playback` asserts the pacing
and the resume-on-rebuild against a real multi-trip timeline.

Its header sits **in the column, not floating over it**, with
`pt-[calc(3.5rem+env(safe-area-inset-top))]`. The recap's own chrome (the
progress bar, then the year picker and close button one safe-area inset below
it) grows with the notch; a header positioned against the viewport did not, and
was clipped on any phone that has one.

**The frame is fitted to the year** (`boundsOfProjectedPoints` +
`fitProjectionToBounds` in `poster/projection.ts`), for the same reason the
share card's inset is fitted to its trip: a year spent in Iceland on a
whole-world map is a four pixel route in the corner of an empty ocean. The fit
is *contain*, never cover, so no stop can be cropped out, and the bounds are
clamped to the projection's own extent so a year that spans everything simply
gets the whole map back. The year card uses the same call.

**The year card leads with the map, not a photograph.** A year has no single
cover, and electing one trip's photo to stand for twelve months is a claim the
data does not support. It shares the trip card's ratios, its canvas plumbing,
and its parts (`poster/card-parts.ts` holds the places line, the highlights row,
and the stat tiles, moved there unchanged when the second card needed them).

Entrance animation is one CSS class (`.recap-rise` in `globals.css`) applied
only while a slide is current, so adding the class is what starts it and there
is nothing to reset. It and `AnimatedNumber` both stand down under
`prefers-reduced-motion` (`lib/motion.ts`). `CountUpGroup` takes an optional
`active` prop for this: the recap's slides are all mounted and toggled by
opacity, so scrolling into view says nothing about whether they are visible.

### Curation (Slots)

Which experiences and which photos represent a trip in the story, the recap,
and the social cards. It exists because rating cannot answer that question: a
five star museum and a five star gelato are both five stars, and only one of
them belongs on a card.

`lib/curation.ts` holds the model (pure, client-safe), `lib/curation-slots.ts`
folds a `StoryTrip` into the three slots the panel renders (also pure), and
`components/trips/trip-curation.tsx` is the panel. Three rules, and everything
else follows:

- **A rank belongs to a SLOT, and a slot is a place on a real surface.** There
  are exactly three, and `SLOT_CAPACITY` is their capacity:
  - **Trip hero (1)**: `photos.featured_slot = 'hero'`, rank 1. The frame the
    trip story opens and closes on, the recap's opening frame, and the share
    card's backdrop. The story reads it through `storyTripImage` (hero, else
    the trip cover); it used to read `trip.coverUrl` directly, which meant the
    slot named "the trip's opening frame" was the one surface it did not open.
    Electing a hero does not touch `cover_photo_id`, so that was true of a
    SAVED hero too, and it also made the panel's "Preview story" look like the
    selection had not taken.
  - **Stop photos (`stopPhotoCapacity(dayslides)` per destination)**:
    `photos.featured_slot = 'stop'`, ranked **within the destination**. The
    photos that lead that stop's story slides. Its capacity is **derived, not
    a constant**: a pick is placed on a day slide and a slide draws
    `SLIDE_PHOTO_CAP`, so a stop with n day slides seats `n * 4` and a stop
    with none (one stop slide) seats 4. It replaced a flat 8, which was a guess
    at "roughly one a day for the stay most people curate": two full slides on
    a two day stop, half of them unplaceable, and a quarter of the seats on a
    fortnight in one city. The capacity is computed once in `stopSlots` and
    carried on `StopPhotoSlot.capacity`, so the panel enforces the number the
    story honours. A slot is one destination ROW, so a trip that returns to a
    city has two of them, each with its own days and its own candidates
    (`StopPhotoSlot` carries the stay's `dateLabel`, which is what tells two
    slots of the same name apart). What each slot offers comes from
    `photosByStop`, the same placement the slides use, so a photograph can
    never be elected into a slot it does not appear in.
  - **Highlights (3, ordered)**: `experiences.featured_rank`, ranked across the
    trip. The share card's list, the story's closing, the recap's moments, and
    the trip page's own "best of" block.

  A rank with nowhere to sit is what the first version shipped, and it is why
  nobody could tell what featuring an item had done. Do not add a fourth slot
  without a surface to point at, and do not let one rank answer two questions:
  a hero is deliberately not also a stop pick (`stopPhotoRank` returns null for
  it), because electing a year's opening frame says nothing about which four
  photos should lead one stop.

- **A slot is written whole.** `setTripHeroPhotoAction`,
  `setStopPhotosAction`, and `setTripHighlightsAction` each take the entire
  slot ("these three, in this order"), so choosing, reordering, and clearing
  back to automatic are all the same call. There is no rank arithmetic on the
  client, nothing can end up half-assigned, and the cap is enforced by the
  caller sending at most as many ids as the slot holds. `ownersForTrip`
  resolves the photo fan-out, borrowed from the delete cascade.

- **Nothing featured means nothing changes, and the panel SAYS what that is.**
  Every selector layers `compareFeatured` / `compareStopPhotos` /
  `compareCurated` on top of the order it already had, and those comparators
  return 0 for two uncurated items, so an uncurated trip produces exactly the
  story, recap, and card it produced before curation existed. Every slot in
  the panel also renders its automatic answer in the empty state
  (`HeroSlot.automatic`, `StopPhotoSlot.automatic`, `HighlightsSlot.automatic`),
  because a blank slot would be telling the user their inaction has no
  consequence. `scripts/check-curation.ts` asserts both halves.

**A stop's picks are spread across its DAYS, not piled on its first slide.**
A slide is a day and a pick is per destination, so `distributeStopPhotos`
(pure, in `lib/curation.ts`) is the mapping between them, and both
`buildStorySlides` (which places the photographs) and the panel (which
describes the placement before anything is saved) call it. Three rules:
a pick **dated** to one of the stop's own day slides leads that day, because
moving it would print a photograph under another day's date; everything else
is dealt in rank order onto the emptiest days, one pass at a time, so five
picks over four days go 2, 1, 1, 1 rather than 5, 0, 0, 0; and no day takes
more than `SLIDE_PHOTO_CAP`. A pick whose own day is already full is not
relocated; it stays in the gallery, like any pick past the cap. With nothing
elected the plan is empty and every line of it is a no-op.

**The seats a day is dealt are the photographs it shows.** Not the front of a
longer queue: `buildStorySlides` REPLACES a dealt day's photo list rather than
prepending to it, so curating one photograph of a day gives that day one
photograph. The first version led the day with the pick and then topped the
slide up to `SLIDE_PHOTO_CAP` with whatever else the camera took, which made
choosing fewer photographs change the order and nothing else. A day the plan
did NOT reach is untouched (its own photos, then the stop cover, exactly as
before), which is what keeps an uncurated stop unchanged, and it is also why
the undated leftovers still ride the stop's first slide unless that slide is
one the traveller curated. The same rule holds on a stop with no dated day at
all: its single stop slide shows the picks, capped at what a slide draws.

**The picker is grouped by DAY, and each day states what it will show.** A flat
grid of a stop's photographs said nothing about the spread above, so choosing
four photographs of one afternoon looked identical to choosing one from each of
four days. `StopPhotoSlot.days` is one `StopDaySlot` per day slide (its date,
its trip day number, and the photographs taken on it) and `StopPhotoSlot.spare`
holds the rest: undated, or dated outside the days this stay owns, which is
exactly the set the story lets ride the stop's first slide. Both are read off
the real day slides, not recomputed from the stay, because a day nobody
photographed is not a slide and would make every count in the panel one too
many. A day with no photographs of its own still gets a heading, because seeing
that it will fall back is the point of the grouping.

The copy is the outcome, not the algorithm. `planStopSelection` returns one
`StopDayOutcome` per day (`picks` / `own` / `cover`), generated by the same
`distributeStopPhotos` that does the placing, and the panel renders it as a chip
on the day's own heading: "Shows your 2" over a day that was picked from,
"Shows its own 6" over one that was not. It replaced a generated paragraph
("3 across 3 days: 2 days show your picks and nothing else, the other 1 fall
back to their own photos, then the stop cover"), which described the rule to
somebody who had to hold it in their head to apply it. `summarizeStopSelection`
is all that is left as prose, and it says nothing at all unless a pick found no
seat, because the headings have already said everything else.

Bounding it: a stop now mounts one grid per day rather than one grid, so a day
grid opens at `DAY_PAGE_SIZE` (8) rather than `PAGE_SIZE` (24). Five days at
eight is forty tiles against a flat page's twenty-four, and the point of the
grouping is that a traveller picks one per day rather than scrolling a gallery.

Past that opening page a grid offers **one expand and one collapse**, not a
pager. Revealing `pageSize` more per press is a button somebody hits
twenty-five times on a stop with two hundred photographs, and by the second
press they want the gallery rather than another eight. The compact state is
what keeps the dialog fast to open and is therefore kept; expanding costs
elements and layout but no full-size fetches, because the tiles are thumbnails
and stay `loading="lazy"`.

**The chosen row is grouped by the day each pick lands on**
(`groupChosenPhotos`). A flat run of position badges was correct about the
order and silent about the mapping, which is the one thing somebody opens that
row to confirm. The grouping runs the same `distributeStopPhotos` the slides
run, so it is a reading of the distribution and never a second opinion about
it, and `check-curation` asserts the groups against the real day slides.

Reordering stays **one global sequence**. The arrows and the drag move a photo
through the whole ranked list and the groups re-derive; there is no dragging
between day groups, because a dated pick is anchored to the day it was taken on
and no drag could honestly move it. Position badges stay the global rank for
the same reason. Picks that found no seat get their own "Nowhere to go" group
rather than being filed under a day they will not appear on.

`MAX_FEATURED_HONORED` is 8 and bounds **experience** ranks, which are scoped
to a whole trip and have no per-surface seat count of their own; past it a rank
is not honoured and falls back into the normal order. Neither fixed slot
capacity may exceed it (`check-curation` asserts this).

It deliberately does **not** bound a stop's photo ranks. `compareStopPhotos`
honours every rank, and the bound is applied where the number is actually
known: `curatedStopPhotos(photos, daySlides)` slices to `stopPhotoCapacity`,
and the panel refuses a pick past `slot.capacity`. A flat ceiling in the
comparator silently unranked picks the panel had just accepted, which on a ten
day stop meant offering forty seats and honouring eight. `setStopPhotosAction`
does not slice either: a stop's capacity needs the folded trip, which is a
query per save to rebuild, so the server's bound is the candidate set and
anything past the capacity falls back on read exactly as an over-long list
always has.

**The panel is bounded, because Radix mounts a dialog's whole subtree in one
synchronous commit.** Every photo on the trip is a hero candidate and every
photo of a stop is a stop candidate, so an unbounded panel built hundreds of
tiles before it could paint; `loading="lazy"` defers the fetch and none of the
element, state, or layout cost. Three bounds, and they must stay: a section
longer than `LONG_SECTION` opens collapsed and mounts nothing, an open grid
renders `PAGE_SIZE` candidates at a time behind a "show more", and a grid tile
is a plain `<img>` (`Thumb`) rather than `SafeImage`, whose skeleton and
three hooks are worth paying for once on the hero preview and not sixty times
in a grid. `buildCurationSlots` also runs only while the dialog is open: it
folds the whole trip and builds its story slides, which is not work to do on
every render of a page whose dialog is shut.

**A candidate is shown at its own shape, because shape is what the choice is
about.** A portrait phone photo and a landscape camera photo are the same tile
in a square grid and completely different objects on a slide: one fills the
frame, the other is shown whole over a blurred blow-up of itself (see the 1.8x
rule in `slide-image.tsx`). Picking between them off identical squares is
picking blind.

Three things make it cheap enough to keep the bounds above:

- **The size is measured, not stored.** `photos` carries no width or height,
  and adding two columns plus a backfill to lay out a picker would be a
  migration paying for a layout hint. The thumbnail is already downloading, so
  `usePhotoRatio` reads `naturalWidth/naturalHeight` off the loaded element.
  It measures from the ref callback as well as `onLoad`, because a cached image
  can finish before React attaches the handler.
- **`RATIO_CACHE` is module level**, keyed by photo id. A tile unmounts every
  time a section collapses, a page is revealed, or the same photo appears in
  both the hero grid and its stop's, and re-measuring on each would make the
  layout settle again in front of somebody who already watched it settle.
- **The layout is CSS multi-column, not a grid.** Variable heights in a row
  grid leave a ragged gap under every row that is not the tallest; columns pack
  with no holes, with no measurement pass and no layout library. The cost is
  column-major reading order, which is the right trade for candidates you
  recognise by sight: pick order lives on the position badges, not in the flow.

Bounds on the shape itself: tiles start square (`DEFAULT_RATIO`), so first
paint is what the picker always looked like and nothing lurches, and a measured
ratio is clamped to `[MIN_RATIO, MAX_RATIO]` (0.5 to 2). The clamp is for the
stitched panorama at 6:1, which unclamped is a two pixel sliver across a whole
column and reads as a broken tile rather than as a wide photograph. Tiles stay
`object-cover`, since that clamp is the one case where frame and photo
disagree and a mild crop beats letterboxing. The chosen row does the same at a
fixed width, so a pick keeps the shape it had as a candidate; the header
`ThumbStrip` chips stay square, because a 28px chip says nothing about
composition either way.

**A preview that approximates the slide is worse than no preview**, because it
would be believed. So `SlidePreview` mounts `SlideImage` itself, in a frame at
`useSlideFrameAspect()`, and reimplements nothing: the fill-versus-letterbox
decision, the threshold, the blurred backdrop, and the crossfade are the
story's own component doing its own job. A photograph that will be letterboxed
is visibly letterboxed there, which is the outcome rather than a note about it.

**The preview frame needs a DEFINITE WIDTH, not an aspect ratio and two max
caps.** It is a flex item in a column, so its cross axis is sized by its
contents, and its only content is `SlideImage`'s `size-full` wrapper (100% of a
parent whose width is being derived from it) over absolutely positioned images,
which contribute no intrinsic size at all. That circularity resolves to zero,
and `aspect-ratio` cannot break it: it derives one dimension from the other and
here neither is ever determined. The first version shipped with `aspect-ratio`
plus `max-h`/`max-w` and painted a perfectly loaded photograph into a 0x0 box.
`width: min(92dvw, {aspect * 70}dvh)` fixes it and keeps both caps, since the
derived height is then exactly `min(92dvw / aspect, 70dvh)`. `dvh` rather than
`vh` because a mobile address bar is part of `vh` and would let the frame
overflow the visual viewport.

The preview is opened by an explicit control on every tile, not by hover and
not by tap-and-hold. Hover does not exist on a touch screen, so a hover-only
preview is a feature half the devices never learn; tap-and-hold collides with
the long press that starts a reorder drag in the chosen row, and is invisible
either way. The tile is therefore a wrapper holding TWO buttons (select, and
preview) rather than one, since a button inside a button is invalid HTML and
the preview must not also toggle the selection.

**The preview is at this device's slide shape, and says so.** Not a fixed 16:9,
and not both orientations offered: the story is a live surface each viewer
opens at their own size rather than an exported image with one baked ratio, so
the honest question is "how will this look on the screen in front of me". A
caption names the shape. The letterbox marker on the tiles is the same
statement in miniature, which is why it is an icon with the full sentence on
its label rather than a word like "bars", and why it renders only once the
thumbnail has actually been measured: an unmeasured tile sits at the square
default and must not claim anything.

**Close and "preview story" ride one sticky bar**, because both are wanted from
any scroll position and two floating controls over a picker full of tiles are
two things in the way. A bar also cannot obscure a tile: it reserves its own
height in the flow. `DialogContent` takes `showCloseButton={false}` here, since
its default close is positioned against the content box and that box IS the
scroll container, so on a trip with a dozen stops it scrolls out of reach.

Two details in the bar are load-bearing. It is full bleed (`-mx-5`) so the
card's padding leaves no gap at either end for content to show through while it
is stuck. And it sticks at `-top-5`, not `top-0`: a sticky element inside a
padded scroll container sticks at the CONTENT box, which leaves the card's own
20px of top padding as a strip above the bar for content to scroll through.
Pulling the sticky origin up by that padding and paying it back as the bar's
own `pt-5` covers the strip, while `-mt-5` cancels it again in flow so the
resting layout is unchanged.

**Previewing the story from the panel** is the same loop one level up: adjust,
watch it in sequence, adjust. It mounts `TripStory`, never a second renderer.
Two things make it work:

- **The dialog stands down while the story plays.** Radix puts
  `pointer-events: none` on the body for the life of an open dialog and
  re-enables it only inside its own content, so a full-screen surface portalled
  beside it is visible and dead to the touch. `open` is left alone and the
  story's own `open` flag gates it, so closing the story lands straight back on
  the panel rather than on the trip page. It also avoids two focus traps and
  two Escape handlers fighting over one key. (`SlidePreview` is the smaller
  case of the same problem, and opts back in with `pointer-events-auto` plus a
  capture-phase Escape handler, because it is small enough to sit *over* the
  dialog rather than replace it.)
- **The preview reflects the live selection, not the last round trip.** Every
  change saves immediately, but "saved" and "back in the props" are different
  moments: a write is followed by `router.refresh()`, and until that lands the
  `StoryTrip` on the page still describes the selection before the last tap.
  So `TripCurationButton` holds a `CurationSelection` (sparse: an absent key
  means "not touched") and applies it with `applyCurationSelection` BEFORE the
  slots are built. One object then serves both, so what the picker shows and
  what the preview plays cannot disagree. The selection lives above the dialog
  because it has to outlive the panel being dismissed for the story.

`applyCurationSelection` mirrors what the three server actions write and
nothing else, including that a hero elected out of a stop's own photographs
survives that stop's slot being rewritten. `check-curation` asserts the round
trip (apply a selection, rebuild the slots, get that selection back), which is
what stops it drifting from `lib/actions/curation.ts`.

Consumers, all through the same comparators: story slide photo and experience
order, `storyClosingStats().best`, the share card's highlights **and its
backdrop**, `tripHighlights()` on the trip page (the same three lines as the
card, on the same page, so they must not disagree), the recap's moments, and
the recap's opening photograph. The stats page's all-time superlatives are
deliberately **not** curated: that is a leaderboard, and a rank assigned to
pace a slideshow has no business reordering it.

An unrated experience can be elected but still stays out of the highlights row
and the "best of" line: those print a star and a number, and featuring is a
statement about order, not a substitute for rating (the picker says so on the
row rather than hiding it). Planned experiences never reach these surfaces.

The panel is the only place a slot is edited. The galleries and the experience
rows show the **result** (a position badge, or a "Hero" mark), never a toggle:
two mechanisms that could disagree is exactly what was replaced.

Degradation before the migrations: experiences read through `select *` so a
missing column normalizes to null, and photo reads name their columns so the
curated ones ask for `featured_rank, featured_slot` and retry without them on
42703 (`PHOTO_COLUMNS_CURATED`, `isMissingPhotoColumn`). A photo row with a
rank and **no** slot reads as a stop pick (`photoSlotOf`), which is what a bare
rank meant before slots existed, so every trip curated under the old model
keeps leading its story slides. Writes report "Curation is not set up on this
database yet" on PGRST204 or 42703 rather than pretending to have saved.
Read-only surfaces render the result and offer no editing; the demo account is
blocked at the action and told so in the panel.

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
- **The canvas surfaces draw the same three families**, through
  `familyArcColor` / `familyArcDash` in `poster/draw-map.ts`. They live there
  rather than in each painter because three surfaces now need them (the year
  card, the trip share card, and the recap's animated map slide), and three
  copies of "violet, dashed" is three places to drift. `MapLeg.family` is
  optional and absent means air, so `drawMap` makes exactly one undashed glowed
  pass for a caller that knows nothing about modes: an unannotated trip and the
  poster both draw what they always drew. Only air carries the glow, since a
  continuous halo under a dashed line reads as a solid line with bites out of
  it. The mode is read off the **arriving** stop on every one of them
  (`StoryDestination.transportMode` for the trip card,
  `ReplayInputStop.transportMode` for the year).
- **The poster stays uniform, deliberately.** Its one legend slot is spent on
  visited versus bucket fills, and a print carrying three unexplained line
  treatments is a puzzle rather than a poster. `buildPosterData` passes no
  family. The two social cards have no legend either, but there the families
  read as texture on an image somebody scrolls past, not as a code to look up
  on a wall.
- **Distance is broken down, never adjusted.** Every kilometre in
  `getTransportBreakdown` is the same great-circle measure `f_distance_traveled`
  counts, which is fair for a flight and an understatement for a road. A detour
  multiplier would be a number the app invented, so the caption states the
  measure instead, unrecorded hops are named rather than folded in, and a leg
  whose owner typed a real `distance_km` uses that. The CO2 line is one muted
  sentence from published per-passenger-km factors, presented as an estimate and
  never as a judgement; `gramsCo2PerKm: null` ("other") drops out of it.

### Offline

The app is a real PWA now, not just an installable one. Four pieces, and the
rules that keep them from lying to the user.

**The service worker (`public/sw.js`) is conservative on purpose.** It only
intercepts GET, passes `/api/*` and `/auth/*` straight through (the photo proxy
is the one exception), and never caches a navigation response. That is what
keeps server actions, uploads, the session refresh, and the PKCE callback
working exactly as they did, and what makes a stale shell after a deploy
structurally impossible: the only HTML in any cache is `/offline`. Caches split
on one question, is this build output or the user's: `batchport-shell-*` and
`batchport-static-*` carry `SHELL_VERSION` and are wiped on activate;
`batchport-tiles-v1` and `batchport-photos-v1` survive deploys.

**Offline reads come from an IndexedDB snapshot, not cached RSC payloads.**
`/api/offline/snapshot` returns the whole account in one document (trips,
stops, experiences with plan days, journal, legs, bucket, categories, and
`getMapData()` verbatim); the client stores it and `/offline` renders from it.
RSC payloads were the alternative and they lose on four counts: one opaque blob
per visited route, invalidated by every deploy (the build id is baked in),
unreadable as data, and missing any trip the user never happened to open. The
cost is that `/offline` is a second rendering of a trip rather than the trip
page. `/offline` is public in `proxy.ts` and reads nothing from the server,
because a route that redirects cannot be precached.

**A failed navigation redirects to `/offline`, it does not serve the cached
body in place.** Serving `/offline`'s HTML under `/trips/xyz` reloads forever:
the document carries the App Router state for one route while the address bar
says another, and the router reconciles, fails, and navigates again.

**Four writes queue offline; everything else is refused.** Checking off a
planned experience, a journal entry, creating an experience (including from
nearby mode), and fulfilling a bucket item. They queue because they are what a
traveller does standing somewhere with no signal, and because each one replays
as an upsert on a natural key or a create behind a server-side duplicate check.
Deletes, reordering, trip and stop create/edit, day assignment, transport legs,
and settings are refused through `useConnectionGuard()` rather than queued:
their conflict semantics are not worth guessing at. **Photo uploads are refused
too**, for storage reasons rather than difficulty (see the note above
`PhotoUpload`).

Three invariants hold the queue together, and breaking any one of them breaks
the promise the feature makes:

- **A queued write leaves the queue by succeeding or by the user discarding
  it, and by nothing else.** A failed replay keeps its row, its error, and its
  place in the pending panel. `forgetOfflineData()` on sign-out is the single
  exception, and it is one.
- **`enqueue()` returns whether it landed.** Every caller checks it and shows
  a refusal instead of a confirmation when IndexedDB said no. Telling someone
  their journal entry is safe when it is only in a React state variable is the
  exact failure this exists to prevent.
- **Replay is FIFO and serial**, stopping at the first retryable failure so
  nothing behind a pending write jumps ahead of it. A non-retryable refusal is
  parked as failed and the loop continues past it, or one bad write would block
  the queue forever.

Conflict policy is **last write wins**, per row, stated in the pending panel.
Single-user app; a merge UI for "you wrote this journal day on two devices"
would cost more than it saves.

**Map tiles are never bulk pre-cached.** MapTiler's Cloud terms permit "a
temporary personal cache (browser cache, mobile app cache, etc.) for use by a
single end-user" and prohibit "batch or excessive bulk download of map tiles",
so the worker caches tiles the user has already viewed and nothing walks a
bounding box. The keyless dark style and `countries.geojson` are local static
files and are precached in full, so the globe always draws offline. The
per-trip "Available offline" toggle says this out loud rather than quietly
doing less than its label implies; what it actually stores is that trip's photo
thumbnails, capped at `MAX_THUMBS_PER_TRIP`, removable, with the count and an
approximate size shown after the fact.

### A Place List Is Never Truncated

`lib/place-lines.ts` is the one wrapping rule, and every surface that prints a
list of places calls it. It was written for the share card's country line and
lived inside `poster/card-parts.ts`, which meant only the two canvas cards
could use it: the trip story's opener and the recap's trip slides each carried
their own `routeSummary` capped at three or four stops with "and N more" after
it, which on a long trip hid most of the journey the slide exists to introduce.

- **Show everything, shrink before wrapping, wrap between places and never
  inside one.** "New Zealand" split across two lines is its own kind of broken,
  so `greedyPlaceLines` breaks on the separator rather than on spaces.
- **Every size is tried on one line before a second line is considered at
  all.** The loops are line count outer, size inner; reversing them is what put
  six countries on line one and "Spain" alone underneath.
- **A wrap that is genuinely needed is balanced.** `balancedPlaceLines`
  bisects the allowed width down until the line count is about to rise, which
  is the balanced split with no special case for two lines versus three.
- **The module takes a MEASURE FUNCTION, not a canvas.** That is what lets the
  cards pass a canvas measurer and `components/places-line.tsx` pass one backed
  by an offscreen context reading the element's own computed font, so the same
  nine-country trip breaks identically on a slide and on a share card.

`PlacesLine` is the DOM half. Two things in it are load-bearing: the fitted
size is written to an INNER span, never to the measured frame (writing it to
the frame makes the next measurement read the shrunken size as the base, so
every resize shrinks the line again), and measurement is canvas rather than a
hidden DOM copy (a bisection over sizes and line counts is a hundred forced
reflows for one line of text). Where the allowed line counts all overflow it
falls through to as many lines as it takes at the floor size. There is no
count of places at which hiding some of them becomes the right answer.

`components/fit-line.tsx` is the sibling for a line that is one fact rather
than a list: "TRIP 1 OF 2 · MAY 12, 2025 TO JUN 10, 2025" broke after the
comma and orphaned "2025", which reads as a second fact. It shrinks to fit and
only wraps below `minScale`, and it measures the way `ScoreValue` does (an
invisible full-size copy in a zero-height clipped wrapper, measured with
`getBoundingClientRect`). Its children are rendered twice, so they must be
static text.

Call sites: `StoryOpenerSlide.places` and `YearTripSummary.places` are arrays
of every stop, never a subset; `layoutPlaces` in `poster/card-parts.ts` for
both canvas cards. `scripts/check-year-recap.ts` and `scripts/check-curation.ts`
assert that the arrays are whole.

### Full-Screen Surfaces And The Notch

The trip story and the year recap both hang their chrome off the viewport
edges with `env(safe-area-inset-*)`, so the chrome grows with the notch. Their
slide content did not: a flat `p-6` / `py-16` put the opener's title under the
close button and the last line of a long journal entry under the pager on any
phone with an inset. Each file now spells one `SLIDE_PAD` constant carrying
both insets and every slide container uses it, so the two cannot drift apart.
The recap's map slide computes its own header padding for the same reason and
must keep doing so, since its header is in the column rather than over it.

The same applies to any new full-screen overlay: the lightbox pads both insets,
and a `fixed inset-0` surface with content near an edge needs them too.

### Exported Images (Poster and Share Cards)

Both exports are drawn onto a canvas from projected vector geometry
(`lib/poster/`). Nothing in either pipeline touches MapLibre or a basemap tile,
and that one decision is what the rest follows from. The alternatives both
lose:

- **Reading back the MapLibre canvas** caps the output at the on-screen size
  times the device pixel ratio, so a laptop yields roughly 3000px on the long
  edge and calls it a poster. It also drags in raster tiles, which are blurry
  enlarged and carry licensing obligations.
- **Composing SVG and rasterising it through an `<img>`** is resolution
  independent, which is the right instinct, but an SVG loaded that way is cut
  off from the document: it cannot see the page's `@font-face` rules, so every
  label silently falls back to a system face. Embedding the font as a base64
  data URI to fix that is a lot of machinery to arrive where canvas already is.

Canvas draws the same geometry at any size, uses the page's real typeface (read
off `document.body` because next/font hashes the family name, so a literal
`"Inter"` in a canvas font string would miss), and hands back a blob.

Four rules hold the rest together:

- **The preview is the export.** `drawPosterPreview` and `drawShareCardPreview`
  call the same draw function at a screen size. There is no second layout to
  keep in step, and nothing can download differently from what was on screen.
- **Resolution is probed and reported, never promised.** Browsers cap canvas
  area and disagree about where (Safari at 16,777,216 pixels, under a 300 DPI
  poster), with no feature query for it. `resolvePrintSize` allocates a
  candidate, writes the far corner, reads it back, and steps down a DPI ladder
  until one works. The dialog states what it got. Do not hardcode 300.
- **The poster's orientation follows its framing**, so it is not a third thing
  to choose: flat prints 16x12, globe prints 12x16. Type scales off the short
  edge, which is 12 inches in both, so the pair matches.
- **Layout is map-first.** The map takes the full content width and the chrome
  is fitted around whatever is left (`verticalBudget` in `poster.ts`). Sizing
  the header and stats first and giving the map the remainder is what produced
  a postage stamp floating in the middle of a page. The flat map also crops the
  empty polar bands, widened by `posterLatitudeRange` to cover any stop outside
  them, which is what makes a 1.97:1 map fit a 4:3 page at all.

**CORS is load-bearing.** Photos are drawn with `crossOrigin="anonymous"`,
without which the image draws fine and then taints the canvas so `toBlob`
throws at the very end. Both sources cooperate: Supabase Storage answers public
objects with `access-control-allow-origin: *`, and the Wikimedia proxy is
same-origin (its 302 lands on that same Storage CDN). The service worker had to
learn about this: an opaque cached photo cannot answer a cors-mode request (the
spec turns it into a network error), so `corsPhoto()` in `public/sw.js` serves
cors requests from a non-opaque hit or the network, and the cors response it
gets back replaces the cached opaque one. Never route photo requests in these
compositions through a path that can yield an opaque response.

**Attribution.** No tiles means no tile provider's terms apply; the country
outlines are Natural Earth (public domain, credited anyway in the poster
footer). A share card whose cover came from Wikimedia prints the stored
attribution: the licence condition does not stop applying because the image was
redrawn onto a canvas. If a future composition draws a third-party image, it
carries its credit or it does not ship.

The share card takes a `StoryTrip` and nothing else
(`shareCardFromStoryTrip`), which is why the trip page, /demo, and
/share/[slug] all offer it with no second data layer and no extra query, and
why the read-only surfaces can offer it at all: generating an image reads
nothing and writes nothing.

Four more rules are specific to the card, and each one replaced a version that
looked fine in isolation and wrong on a photograph:

- **The route map is an inset, corner-anchored, in both ratios.** Top-right,
  because the text block owns the bottom-left and the middle is where a
  photograph puts its subject. A disc in the centre lands on somebody's face
  and reads as a sticker. It carries a drop shadow and a thin ring so it sits
  *on* the picture; without them it reads as a hole punched through it. Its
  inset from the corner is deliberately **tighter than the text margin**
  (`margin * 0.55`), which is what makes it read as anchored to the corner
  rather than merely near it.
- **The title is measured against the inset.** It is the only element in the
  block both wide enough and tall enough to reach that corner: everything
  below it sits lower, and the dates eyebrow above it is a narrow line. So the
  title is fitted across the full width, its top is computed, and only if that
  lands level with the disc is it re-fitted into the column beside it (one
  extra line allowed there, since the constraint is width). A permanent
  narrowing would shrink every title to protect against a case most trips
  never hit, which is why this is a second pass.
- **It is framed to the trip, not to the planet.** `fitOrthographicRadius`
  fits the stops with padding, and `orthographicProjection` takes that radius
  and reports the smaller circle from `outline`, so the ocean fill, the clip,
  and the ring all follow one number. Two clamps: a point past 90 degrees
  cannot be fitted so the view falls back to a full hemisphere, and a minimum
  radius stops a one-city trip becoming a featureless close-up. The centre is
  the trip's true centroid (`clampLatitude: false`), or an Iceland trip slides
  off its own map.
- **Line weights are a fraction of the map's own size, so an inset needs
  `lineScale`.** At a quarter of the card the poster's proportions put arcs
  under a pixel and the route vanishes. The arc glow is tied to the arc width
  rather than to the unit, so it stays in proportion at any scale.
- **The places line never truncates.** It names countries (a "+8" was hiding
  most of the trip), falls back to stops for a single-country trip, and wraps
  between places and never inside one. The rule itself lives in
  `lib/place-lines.ts` and is shared with the DOM surfaces (see "A Place List
  Is Never Truncated" below).
- **The highlights block fills the width and collapses cleanly.** Up to three
  best-rated experiences, name flush left and rating flush right against the
  edge the stats rule ends on; a single star and a short name left two thirds
  of the line empty. Names shrink to fit and only ellipsize at the floor. With
  nothing rated the whole block (label included) is never pushed, so the
  measured text block simply gets shorter rather than leaving a hole.

The text block is measured into rows before anything is painted, because the
bottom scrim has to know where the block starts. Sizing that scrim as a
fraction of the height instead is what left a title fighting a bright cover.

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

- **The service worker must stay out of the way:** it intercepts GET only, and passes `/api/*` and `/auth/*` through untouched. Adding a cache to either would break server actions (POSTs to the page URL), photo uploads, the session refresh, or the PKCE callback. Navigation responses are never cached, which is what makes a stale shell after a deploy impossible.

- **proxy.ts not middleware.ts:** Next.js 16 renamed the middleware file convention to "proxy". The session refresh and route guard live in `src/proxy.ts`. Creating a `src/middleware.ts` file would have no effect.

- **Admin client is not schema-scoped:** `createAdminClient()` returns a service-role client with no default schema. Every call must chain `.schema("batchport")` before `.from(...)`. Forgetting this silently queries the `public` schema and returns empty results or cryptic errors.

- **Photo reads name their columns:** `PHOTO_COLUMNS` is an explicit list, so adding a column to it breaks every photo query on a database where the migration has not run. That is why `featured_rank` lives in a separate `PHOTO_COLUMNS_CURATED` used only by the reads that need it, each retrying with the base list on 42703. Do not fold a new optional column into `PHOTO_COLUMNS`.

- **Generated lat/lng columns:** `destinations.latitude` and `destinations.longitude` are generated from `geom`. Never include them in INSERT or UPDATE payloads. Write only `geom` with EWKT: `SRID=4326;POINT(lng lat)`. The same rule applies to the experiences `geom` column.

- **Async cookies():** `cookies()` from `next/headers` is async in Next.js 16. The `createClient()` server factory is already async for this reason. Any new Route Handler or Server Action that needs the server client must `await createClient()`.

- **ISO_A2_EH in GeoJSON:** The countries GeoJSON uses `ISO_A2_EH` as the country code property, not `ISO_A2`. The globe's match filter uses `["get", "ISO_A2_EH"]`. Using the wrong field name causes all country fills to silently match nothing.

- **Wikimedia query uses city name only:** `getWikimediaPhoto` is called with the destination name alone (e.g., "Paris"), not "Paris, France". The Wikidata entity search returns better results with a bare city name. Do not append country information to the query.

- **Demo guard must be first:** `isDemoBlocked()` must be the first statement in every mutation server action. The UI may also hide edit controls via `isDemoUser(user.id)`, but the action-layer guard is the actual security boundary.

- **is_shared() RLS requires the anon client:** Share data reads must use the anon server client, not the admin client. The anon key triggers RLS and the `is_shared()` helper. Switching to the admin client for share routes would bypass RLS and expose any user's private data.

- **batchport schema must be exposed in Supabase:** Settings, API, Exposed schemas must include `batchport`. Without this, PostgREST rejects all anon-client queries to the schema.

- **A stale `.next/dev` lies to you, and a server restart is not enough.** Three distinct failures traced to it in a single session, all of which looked like application bugs:

  1. **Missing utility classes.** `gap-x-8` and `gap-y-3` were in the markup and computed to `normal`, because they appear only in new files and the dev chunk had not rescanned. The summary figures collided on screen.
  2. **A module factory error after a hot reload**, where the running page referenced a factory the rebuilt chunk no longer had.
  3. **Missing container query rules.** `@container/card` and its `@[16rem]/card:` variants were absent from the served stylesheet, so the base case rendered and every conditional part hid. This looked exactly like a mis-scoped container.

  The fix in all three was `rm -rf .next` (or at least `.next/dev`) and a hard reload. **In two of them a plain `npm run dev` restart did not help**, because the build directory was reused: the served chunk hash was byte-identical across the restart. If a class is in the DOM and does nothing, suspect this before suspecting the class.

  A related symptom worth knowing: a hung dev server (listening on the port, answering nothing, connections piling up in `CLOSE_WAIT`) makes Claude in Chrome look broken. Navigations appear not to stick and `Runtime.evaluate` times out, because the page never finishes loading. Check the server before blaming the extension. A restart after a hang may also come up on **3001**, because the stale lock makes it think 3000 is still taken.

- **`.next/static` is not evidence about dev.** Grepping the built CSS proves what `npm run build` produced and says nothing about what the dev server is serving; the two diverge exactly when a stale dev chunk is the problem, which is the case you are usually trying to diagnose. This mistake was made twice in one session, both times concluding "the CSS generated, so the markup must be wrong".

  The check that actually works, and the only one worth trusting:

  ```
  curl -s http://localhost:3000/<page> | grep -o 'href="[^"]*\.css[^"]*"'
  curl -s "http://localhost:3000<that href>" -o probe.css   # then search probe.css
  ```

  Fetch the stylesheet the page actually links, and search that. Note that dev CSS is pretty-printed (`container: card / inline-size`) while production is minified (`container:card/inline-size`), so a grep tuned to one will silently miss the other; search for a distinctive fragment rather than an exact declaration.

- **A grant is not a policy, and the difference is silent.** Supabase enables RLS on new tables by default, so a table created by a migration has RLS on whether or not the migration says so. RLS enabled with **zero policies denies everything**, and PostgREST reports that as **zero rows and no error**. A missing GRANT is the opposite: it raises `42501 permission denied`. So the loud failure is the one you did not cause, and the quiet one is.

  Every new table needs its policies **stated explicitly**, including reference tables that "everyone can read". Do not infer the behaviour from how `batchport.categories` happens to work: whether that table has RLS off or RLS on with a permissive policy is not observable through PostgREST (both read 12 rows through anon), and inheriting an assumption from it is exactly what caused this. Settle it with `select relrowsecurity from pg_class where oid = 'batchport.categories'::regclass;` and `select * from pg_policies where schemaname = 'batchport';` before copying its shape.

  **Service role bypasses RLS, so no service-role script and no SQL editor query can see this class of failure.** `expense_groups` and `expense_categories` shipped granted-but-policyless and every service-role check passed while the app rendered an empty category picker and "Mostly Uncategorized 100%" over 226 categorised rows, because `v_expense_rows` is `security_invoker` and its LEFT JOIN to the taxonomy matched nothing. The anon key is the only instrument that shows it; `npm run check-expense-attribution` asserts it by comparing anon's row counts against the seed.

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
| Place-list wrapping and shrink ladder (pure) | `src/lib/place-lines.ts` |
| Place list that never truncates (DOM) | `src/components/places-line.tsx` |
| One-line text that shrinks rather than wraps | `src/components/fit-line.tsx` |
| Curation model, slots, and comparators (pure) | `src/lib/curation.ts` |
| The three slots of one trip, and their automatic answers (pure) | `src/lib/curation-slots.ts` |
| Curation panel (slot editor, entered from the trip page) | `src/components/trips/trip-curation.tsx` |
| Bucket list hero lookup and session cache (client) | `src/lib/bucket-hero.ts` |
| Full-screen photo (full-quality swap, fit rule) | `src/components/photos/slide-image.tsx` |
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
| Which stay owns a calendar day, and the boundary rule (pure) | `src/lib/stays.ts` |
| Journal day derivation and helpers (pure) | `src/lib/journal.ts` |
| Journal server reads | `src/lib/journal-data.ts` |
| Journal server action | `src/lib/actions/journal.ts` |
| Trip story slide builder (pure) | `src/lib/story.ts` |
| Year in Travel derivation (pure) | `src/lib/year-recap.ts` |
| Year recap full-screen view | `src/components/year/year-recap.tsx` |
| Year recap animated map slide | `src/components/year/year-map-slide.tsx` |
| Year recap entry points | `src/components/year/year-recap-launcher.tsx` |
| Year card dialog and launcher | `src/components/year/year-share-card.tsx` |
| Year card render | `src/lib/poster/year-card.ts` |
| Year recap map painter (canvas) | `src/lib/poster/year-map.ts` |
| Social card shared parts | `src/lib/poster/card-parts.ts` |
| Scoreboard lead and supporting strip (story and recap) | `src/components/stats/scoreboard.tsx` |
| prefers-reduced-motion check | `src/lib/motion.ts` |
| Trip story full-screen view | `src/components/trips/trip-story.tsx` |
| Trip story entry point | `src/components/trips/story-launcher.tsx` |
| Trip journal editor | `src/components/trips/trip-journal.tsx` |
| On this day data layer | `src/lib/on-this-day.ts` |
| On this day dashboard strip | `src/components/dashboard/on-this-day.tsx` |
| Map projections and path clipping (pure) | `src/lib/poster/projection.ts` |
| Country outline loader for exports | `src/lib/poster/countries.ts` |
| Poster palettes (Midnight, Paper) | `src/lib/poster/theme.ts` |
| Shared map painter (fills, arcs, pins) and the arc family colours/dashes | `src/lib/poster/draw-map.ts` |
| Poster layout and render | `src/lib/poster/poster.ts` |
| Poster inputs from map data and stats | `src/lib/poster/poster-data.ts` |
| Per-trip share card render | `src/lib/poster/share-card.ts` |
| Canvas plumbing (DPI probe, fonts, CORS, download) | `src/lib/poster/canvas.ts` |
| One-page PDF wrapper | `src/lib/poster/pdf.ts` |
| Poster export dialog | `src/components/poster/poster-export.tsx` |
| Share card dialog and launcher | `src/components/share/trip-share-card.tsx` |
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
| Curation slot server actions (hero, stop photos, highlights) | `src/lib/actions/curation.ts` |
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
| Offline snapshot shape (client-safe) | `src/lib/offline/types.ts` |
| Offline queue vocabulary and coalescing (pure) | `src/lib/offline/queue-types.ts` |
| IndexedDB wrapper (meta + queue stores) | `src/lib/offline/db.ts` |
| Offline write queue and replay loop | `src/lib/offline/queue.ts` |
| Snapshot fetch, store, and staleness | `src/lib/offline/snapshot.ts` |
| Per-trip photo cache warm and removal | `src/lib/offline/trip-cache.ts` |
| Online status, queue, and connection guard hooks | `src/lib/offline/use-offline.ts` |
| Offline storage wipe on sign-out | `src/lib/offline/forget.ts` |
| Offline replay server action | `src/lib/actions/offline.ts` |
| Offline snapshot API route | `src/app/api/offline/snapshot/route.ts` |
| Offline shell page (public, client-rendered) | `src/app/offline/page.tsx` |
| Offline shell (trip list, globe, snapshot read) | `src/components/offline/offline-shell.tsx` |
| Offline trip view (checkoff and journal writes) | `src/components/offline/offline-trip.tsx` |
| Offline status chip and pending queue panel | `src/components/offline/offline-status.tsx` |
| Per-trip "available offline" toggle | `src/components/offline/trip-offline-toggle.tsx` |
| Service worker (caching, offline fallback) | `public/sw.js` |
| Seed script | `scripts/seed-trips.ts` |
| Demo showcase fixture | `scripts/demo-dataset.ts` |
| Demo reset and reseed | `scripts/seed-demo.ts` |
| Landing fallback generator | `scripts/generate-mock-globe.ts` |
| PWA icon generator | `scripts/generate-icons.mjs` |

## Testing

Run `npm run build` to verify type correctness across the whole project (TypeScript strict mode). Run `npm run lint` for ESLint. There is no automated test suite, with the exceptions below, all pure, none needing a database or a dev server:

- `npm run check-stays` asserts day-to-stay resolution: the boundary rule, gaps, nesting, a place visited twice in one trip (its own days, photos, journal, and curation slot, never merged with the first visit), a stored `start_date` that predates the first stop, an undated stop in a dated trip, and a single-stay trip left unchanged. Re-run it after any change to `lib/stays.ts`, `placeTripContent`, or `buildStorySlides`.
- `npm run check-year-recap` asserts the Year in Travel derivation (year list, slicing across new year, planned exclusion, sparse years, in-progress labelling, insight selection, that a trip slide names every stop rather than "and N more", and that the year's photograph is a trip hero: the whole resolution chain, a curated hero outranking a longer trip's automatic one, a stop pick never opening a year, and the opener and the scoreboard reading the same field). Re-run it after any change to `lib/year-recap.ts`.
- `npm run check-curation` asserts the curation model end to end (rank order, the cap, the photo slots and their backwards compatibility, the three slots' contents and their automatic answers, the derived per-stop capacity on a one day, ten day, and undated stop with a selection up to the maximum on each, the spread of a stop's picks across its day slides for equal, fewer, and more picks than days, the picker's day grouping and the per-day outcome each heading states, that a day with picks shows only those and a day without falls back to its own photos and then to the stop cover, that a moment shows its own experience's photograph and marks a place fallback as one, that the story opener names every stop, what the story, the share card, and the recap select, and the round trip through `applyCurationSelection` that lets the panel preview an unsaved selection), including the uncurated fallback path on every one of them. Re-run it after any change to `lib/curation.ts`, `lib/curation-slots.ts`, or a selector that consumes them.
- `npm run check-map-arcs` asserts the transport arc families on the drawn maps: the mode to family mapping, the dash pattern each family draws (air solid, ground dashed, sea dotted, all scaling with the line width), that both exported cards style each hop by the mode on its **arriving** stop, that an unlocatable stop drops out without sliding a mode onto the wrong arc, that the poster passes no family, and that an unannotated trip or year is uniformly air on every one of them. Re-run it after any change to `arcFamily`, `familyArcColor` / `familyArcDash`, or either card's leg builder.
- `npm run check-year-map-playback` asserts the recap map slide's clock: that 1x, 2x, and 4x all reach the end of a real multi-trip timeline, that changing speed mid-flight rescales the remaining time rather than jumping or truncating, that skip lands on the finished year, and that rebuilding the animation mid-playback resumes instead of restarting. Re-run it after any change to `advancePlayback` or to the map slide's effect wiring.

- `npm run check-expense-csv` asserts that the expense CSV round-trips: export, parse, deep-equal, over the shapes that break naive CSV code (a refund staying negative, an undated row, an uncategorized row, a vendor with a comma, a vendor with a quote, a note containing a comma AND a quote AND a newline, cents, a trip name with a comma, a row with no id). It also asserts that re-exporting an unchanged ledger is byte-identical, that a wrong header is refused rather than guessed at, and that every bad row is reported with its line number. Pure. Re-run it after any change to `lib/expenses-csv.ts`, which is the single definition both the exporter and `import-expenses --csv` read.

Two check scripts are deliberately NOT in that list, because they break the property the others share:

- `npm run check-expense-attribution` **needs a database and writes to the live project**. It is a sibling of `check-stays` rather than part of it, so `check-stays` stays pure. It asserts two things that each live in two places: the day-to-stay boundary rule, implemented in TypeScript (`stayForDate`) and again in SQL (the lateral in `v_expense_rows`), by inserting a six-stop trip covering the transfer day, the gap, the nested stop, the revisit and the undated stop and asserting the two agree; and the privacy gate, by reading `v_expense_rows` through the ANON key and asserting it sees the demo account's expenses and none of the owner's, filtered and unfiltered. The gate half runs its preconditions first (the service role really can see the fixture rows, and anon really can read demo trips through `is_shared`), because "anon saw zero rows" also passes when the anon key is broken. Requires `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Every fixture row carries the reserved name `__parity_fixture__`, the fixture trip is `planned` so a crash survivor is excluded from every stats view, and purge runs on entry as well as in a `finally`. `npm run purge-parity-fixture` sweeps by hand.

- `npm run check-share-gate` **needs a running dev server and a seeded demo account.** It asserts that expenses reach `/demo` and never `/share/[slug]`, by fetching both pages and searching the rendered HTML. It exists for its NEGATIVE case: `/share/demo` resolves the demo account (`getUserBySlug` accepts `is_demo = true`), RLS permits anon to read that account's expenses, so the *only* thing refusing is that the share route calls `getSharedProfile(userId)` without the flag. A gate exercised only on the route that should pass is not tested. It carries a control (`/demo` must render spending, or the leak test passes trivially) and it verifies its own markers against every trip, city and experience name in the fixture before using them, because the first draft picked "Naschmarkt", which is also a Vienna experience. If it cannot reach the server it FAILS rather than skipping. Verify changes to it by deliberately breaking the gate and watching it fail.

Interactive features including the globe, photo lightbox, geocoding typeahead, and experience dialog require manual browser testing.

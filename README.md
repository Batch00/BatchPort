# BatchPort

BatchPort is a personal travel tracker and installable progressive web app built on an interactive 3D globe. It lets you log every trip, destination, and experience, visualize journeys as great-circle arcs on a spinning globe, explore stats through a dedicated dashboard with charts, and maintain a bucket list of countries and places you want to visit. BatchPort is part of the Batch Apps umbrella (batch-apps.com), lives at batchport.batch-apps.com, and is invite-only. A public read-only demo runs at /demo, and any user can generate a shareable profile at /share/[slug].

## Features

### Interactive Globe

- MapLibre GL JS globe rendering with globe/mercator projection toggle
- Visited country fills (electric blue) and bucket list country fills (amber) using native GeoJSON fill layers
- Destination pin layer, color-coded by primary experience category, with hover glow and popup
- Great-circle trip arc layer with glow, computed from consecutive destinations within each trip
- Country click drill-down: flies to the country and shows a side panel listing destinations grouped by trip
- Hover tooltips on pins (destination name) and countries (name plus destination count)
- Stats overlay showing countries, trips, and destination counts
- Auto-rotate while idle on the landing page hero; static on the dashboard
- The landing hero renders the public demo account's real travel history, read through the anon path and cached for an hour, with a generated static snapshot of the same trips as the fallback so the hero is never an empty globe
- Protomaps PMTiles dark raster basemap (optional, via NEXT_PUBLIC_PMTILES_URL); falls back to the bundled dark style at /styles/dark-style.json
- Basemap style switcher: the keyless dark default plus MapTiler streets, satellite, and terrain when NEXT_PUBLIC_MAPTILER_KEY is set; each style carries its own overlay tint, pin halo, and zoom depth, and the choice persists per session
- Fullscreen mode: the globe card swaps to a fixed full-viewport container with panel-first Escape handling

### Map Controls

The floating control cluster follows a two-tier model, capped at five buttons plus the search icon on the fullest surface and fewer everywhere else.

- **Modes** change what the map shows and get visible buttons that fill brand blue while active: photo map, replay, attractions, and nearby. A mode may surface its own chrome while running (replay swaps the cluster for a transport bar; photo mode adds a header pill; nearby adds a status card). Nearby is the fourth mode and the last one this layout carries; a fifth would mean rethinking the model, not appending a button.
- **Utilities** adjust how the current view is drawn and all live in one settings popover: basemap swatches, recenter, globe/flat projection, fullscreen, and refresh.
- Layout is a single bottom-right vertical column at every breakpoint. Search anchors top-right, so the two cannot collide: the cluster's height is bounded at five buttons (about 264px on phones) and the dashboard globe, the only surface that wires all four modes, is at least 340px tall. Every other globe surface is at least 300px.
- Read-only surfaces (demo and /share/[slug]) render the same model minus the auth-gated pieces (no refresh, no attractions, no nearby, no photo management actions).

### Alternate Globe Modes

- **Photo map:** every photo with a resolvable coordinate rendered as a clustered thumbnail marker; travel layers stand down. Coordinates resolve from EXIF GPS, then the owning experience, destination, or the trip's first destination. Photos with no location are counted in the header and viewable in an off-map grid, where they can be assigned to a destination.
- **Replay:** timeline playback of travel history with a date and country readout, scrubber, speed toggle, and restart.
- **Attractions:** viewport Wikipedia geosearch markers (via /api/discover/geo) that open in the discovery panel. Debounced, memoized per viewport cell, and gated to zoom 10 and above.
- **Nearby:** the app's present tense, built for standing somewhere. Tapping the mode (and only tapping it) asks the browser for a location; the map flies to it, drops a pulsing emerald you-are-here marker, and switches the attractions layer on around you. The card names the stop you are in when one is within 50km, links into that destination and its trip plan, offers a one-tap checkoff when you are within 250m of something you planned, and opens a compact sheet that logs an experience at your coordinates (name prefilled from an attraction within 150m, destination defaulted to the stop you are in). The position is held in memory for the life of the mode and never stored or transmitted; the only coordinate that leaves the session is the one on a record you create. A denial states the problem once and offers an exit, and never re-asks on its own.
- **Discovery:** clicking any country opens a panel with country facts (currency, languages, driving side, plug and voltage), climate lines, and top cities; POIs can be saved onto a trip as planned or done experiences.

### Trip, Destination, and Experience Management

- Full CRUD for trips, destinations, and experiences via server actions
- Trip status: planned, ongoing, completed
- Trip and destination notes fields
- Destinations ordered within a trip via order_index (reorderable)
- Experience categories: museum, restaurant, attraction, nightlife, beach, nature, lodging, and more
- Half-star rating on experiences: stored as a smallint 1-10 (each unit is half a star), displayed as 0.5-5.0 stars
- Date fields on trips (start/end), destinations (arrival/departure), and experiences (visited date)

### Geocoding Pipeline

- Photon typeahead for location search with client-side deduplication (one result per normalized name and country code pair)
- Nominatim reverse lookup to resolve country, admin region, and PostGIS geom from a selected result
- geocode_cache table stores provider responses for 30 days (providers: photon, photon_poi, nominatim) to avoid repeat API calls
- POI search for experiences: Photon with location bias, OSM key/value tags mapped to app category slugs via osmToCategorySlug()
- Country polygons bundled at public/data/countries.geojson for globe fills

### Photo System

- Client-side image resize (canvas, max 1920x1080, 0.85 quality) before uploading to Supabase Storage
- Photos attach to a trip, a destination, or an experience via owner_type and owner_id
- Three photo sources: upload (Supabase Storage), wikimedia (Wikimedia Commons URL, proxied), url (arbitrary external)
- Wikimedia auto-population on destination create: resolves the Wikidata P18 (lead image) property using the destination name only (not "city, country"), caches the result in geocode_cache for 90 days under provider="wikimedia", and sets the image as the destination cover photo
- Wikimedia images are served through /api/photos/wikimedia/proxy to avoid CORS and hotlinking issues
- Photo galleries with lightbox on destination and trip pages
- Trip-level photo upload: photos can be retagged to a specific destination or experience after uploading
- Cover photo management on trips and destinations: explicit picker with crop/zoom, or falls back to the first photo; galleries can set a photo as either the destination cover or the trip cover
- Attribution stored on Wikimedia photos (artist and license from Commons extmetadata)
- Manual location override: a mislocated photo can be pointed at one of your destinations, or cleared back to its owner's location
- Deletion cascade: photos is polymorphic (owner_type and owner_id, no foreign key), so Postgres never cascades to it. Deleting a trip, destination, or experience removes the photos it owned (including its children's, for a trip) along with their upload Storage objects and thumbnails; shared Wikimedia cache files are kept, and any cover pointer on a surviving parent is cleared. Cleanup is best-effort after the entity delete succeeds, so a Storage hiccup can never resurrect a deleted trip. Historical orphans are recoverable with `npm run cleanup-orphan-photos`.

### Stats Dashboard

- Summary card grid: countries visited, world percentage, continents, trips, destinations, experiences, days traveling
- Yearly breakdown chart (Recharts): trips, countries, and new countries per year
- Experience by category chart (Recharts): experience count and average rating per category
- Top countries chart (Recharts): destinations and trips per country (top 10)
- Travel extremes panel: northernmost, southernmost, easternmost, and westernmost destination names and coordinates
- Bucket list completion progress bar and percentage
- All metrics come from SQL views and an RPC function; no client-side aggregation

### Bucket List

- Two item types: country (linked to the countries reference table) and place (free-text with optional coordinates)
- Priority field and optional target date per item
- Manual fulfill and unfulfill, linking a fulfilled item to a specific trip
- Auto-fulfillment on destination create: country-type bucket items are automatically fulfilled by the earliest matching trip when a new destination is added
- Globe amber fill layer for unfulfilled country-type bucket items, distinct from the blue visited fill
- Completion percentage tracked via the v_bucket_completion SQL view

### Auth and Invite Pipeline

- Invite-only: access requests submitted via POST /api/request-access (name, email, optional referral), emailed to the admin via Resend
- Admin receives an approval email with signed Approve and Deny links (HMAC-SHA256 tokens, secret from APPROVAL_SECRET)
- Approve link calls GET /api/approve-access, verifies the HMAC token, invites the user via Supabase admin.inviteUserByEmail, and optionally sends a welcome email via Resend
- User sets their password at /auth/setup-password after accepting the Supabase invite
- PKCE code exchange at /auth/callback
- Demo user: a hardcoded user ID (in constants.ts), readable at /demo sessionlessly and also accessible as a logged-in read-only account; all mutations are blocked for this ID

### Public Share

- User-controlled: enable/disable sharing and choose a public slug in Settings
- Public profile at /share/[slug]: globe, stats, trips with destinations and experiences, all read-only
- Access gated by the is_shared() RLS helper in Supabase; the anon client can read only when sharing is enabled or the user is the demo account
- Open Graph and Twitter card metadata generated dynamically per slug (title and description include country and trip counts)
- The /demo page uses the same SharedProfileView component, sessionlessly

### Global Search

- Search icon in the app nav on every authenticated page, plus Cmd+K / Ctrl+K
- Matches your own trip, destination, experience, and bucket list names and notes (a note-only hit shows the matching excerpt)
- Results grouped by type with context (an experience shows its destination and trip) and a rating where there is one; each row navigates to the right page
- Keyboard navigable: arrow keys move across group boundaries, Enter opens, Escape closes
- Debounced and server-side via `/api/search`, session-scoped so RLS is the access boundary
- Distinct from the globe's geocode search, which finds places in the world; this finds things you have already logged, and the copy in both says so

### Weather at Time of Visit

- One quiet line on any dated stop with coordinates: "While you were here: 12 to 19°C (54 to 66°F), rain on 2 of 4 days", with a "By day" expander showing each day's high, low, and precipitation
- Observed daily values from the Open-Meteo ERA5 archive, the same source behind the planner's climate lines, served by `/api/weather/visit` and cached in geocode_cache under the `weather_visit` provider for a year (past observations do not change)
- ERA5 runs several days behind real time, so the window is truncated to what the archive can answer: an ongoing trip resolves as far as it can and says "(so far)", and a stop that ended in the last few days simply has no line yet
- Absent, never empty: no dates, no coordinates, a planned trip, or an upstream miss all mean the line does not render
- Shown on destination pages and on the read-only demo and share surfaces alike, since it is reference data keyed by a coordinate and a past date range with no user state in it

### Home Location and Distance

- Set a home city in Settings with the same location typeahead used for destinations; stored as `user_settings.home_geom` via the EWKT convention
- Unlocks distance from home on destination pages, the furthest stop on trip pages, and a furthest-from-home entry in the travel extremes panel
- Trip planning picks up a time difference chip in the country facts strip, derived from the `utc_offset_seconds` the existing Open-Meteo climate lookup already returns (no new API, no new cache provider)
- Every one of these is absent when no home is set: no empty states, no prompts

### Superlatives

- Top 10 rated experiences all time, with destination, trip, and rating
- Best in category: the highest rated experience in each category that has one
- "Did not quite land": the lowest rated entries, shown only when ratings are genuinely low (2 stars or below) and there are at least five rated experiences to rank
- Per-trip bests on trip pages, derived from rows the page already fetched
- All of it comes from one query for the whole stats page; planned experiences and planned trips are excluded

### Data Export

- JSON archive: every trip with nested destinations and experiences, plus the bucket list, photo metadata with absolute URLs, and settings
- GeoJSON: destinations as Point features (trip, experience, and rating properties) and trips as LineString routes, so it opens in geojson.io or any GIS tool
- Server-side generation at `/api/export?format=json|geojson`, downloaded with a dated filename; the builders take no user parameter, so a request can only ever return the caller's own data

### Settings

- Set or clear your home city
- Toggle public sharing on/off
- Set a custom public slug (3 to 30 characters, lowercase letters, numbers, and hyphens; reserved slugs are blocked; must be unique across users)
- Download your data as JSON or GeoJSON

### PWA

- Web app manifest served at /manifest.webmanifest
- Pass-through service worker (public/sw.js), installable but no offline caching
- Branded icons at multiple sizes (48x48 through 512x512) plus maskable variants (192x192 and 512x512)
- Responsive layout with hamburger nav on mobile (AppNav)
- Touch-friendly photo lightbox

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.9 (App Router), TypeScript strict, React 19.2.4 |
| UI | shadcn/ui (Radix primitives), Tailwind CSS v4, Lucide icons, Sonner toasts |
| Database | Supabase (shared Batch Apps project), batchport schema, PostGIS |
| Map | MapLibre GL JS 5.24.0, native GeoJSON layers for pins and arcs, Protomaps PMTiles dark basemap |
| Charts | Recharts 3.9.0 |
| Geocoding | Photon (typeahead and POI), Nominatim (reverse), GeoNames countries.geojson (bundled) |
| Photos | Supabase Storage (batchport bucket), Wikimedia Commons API (Wikidata P18 property) |
| Email | Resend |
| Hosting | Vercel |

## Data Model

All tables live in the `batchport` Postgres schema. Row-level security scopes every table to the authenticated user. A shared `is_shared()` function in Supabase allows anonymous SELECT when a user has `public_share_enabled = true` in user_settings or `is_demo = true`.

### Hierarchy

```
trips
  destinations   (ordered by order_index within a trip)
    experiences  (category, rating, optional coordinates)
```

### Tables

**trips:** Top-level travel event with name, status (planned/ongoing/completed), start_date, end_date, notes, and cover_photo_id.

**destinations:** A stop within a trip. Stores a PostGIS `geom geography(Point,4326)` column; `latitude` and `longitude` are generated columns derived from geom and must never be inserted or updated directly. Also holds country_code, admin_region, arrival_date, departure_date, order_index, cover_photo_id, and notes.

**experiences:** An activity at a destination. Has category_id, `rating` (smallint 1-10; each unit is half a star, so 10 = five full stars), visited_date, notes, and an optional `geom geography(Point,4326)` set from POI search.

**categories:** Static reference data: slug, label, icon, color, sort_order.

**countries:** Static reference data: code (ISO 3166-1 alpha-2), name. Used for the bucket list country dropdown and country name display.

**bucket_list:** Country or place items with type ("country" or "place"), country_code, place_name, optional geom (for place type), priority, target_date, fulfilled_trip_id, and fulfilled_at.

**photos:** Owner_type (trip/destination/experience), owner_id, source (upload/wikimedia/url), storage_path (for uploads), external_url (for wikimedia and url sources), attribution, and order_index.

**geocode_cache:** Cached API responses keyed by provider (photon, photon_poi, nominatim, wikimedia, the discover_* family, weather_visit) and query_norm. TTL: 30 days for geocoding responses, 90 days for Wikimedia and discovery responses, 365 days for observed weather (past observations are immutable).

**user_settings:** Per-user configuration: public_share_enabled, public_slug, is_demo, and the home location (`home_geom geography(Point,4326)` plus the `home_name` and `home_country_code` labels).

## Metrics Layer

All stats come from SQL views and an RPC function in the batchport schema. The server Supabase client is already schema-scoped, so view names resolve without an explicit prefix.

| Name | Returns |
|---|---|
| `v_user_travel_summary` | countries_visited, world_pct, continents_visited, total_trips, total_destinations, total_experiences, days_traveling |
| `v_experiences_by_category` | slug, label, color, experience_count, avg_rating_stars |
| `v_country_frequency` | country_code, country_name, trips, destinations |
| `v_yearly_breakdown` | year, trips, countries, new_countries |
| `v_bucket_completion` | total, fulfilled, completion_pct |
| `v_travel_extremes` | northernmost_lat, southernmost_lat, easternmost_lng, westernmost_lng |
| `f_distance_traveled(p_user_id)` | Total distance traveled in kilometers (RPC call via supabase.rpc) |

## Environment Variables

Set these in `.env.local` (gitignored; never commit this file). See `.env.local.example` for the full list.

| Variable | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Supabase anon key |
| `NEXT_PUBLIC_APP_URL` | public | Canonical app URL for auth redirects and absolute links (e.g. https://batchport.batch-apps.com) |
| `NEXT_PUBLIC_PMTILES_URL` | public | Base URL for the PMTiles dark basemap; leave empty to use the bundled dark style |
| `NEXT_PUBLIC_MAPTILER_KEY` | public | MapTiler API key (free tier) enabling the detailed basemap styles (streets, satellite, terrain) in the globe style switcher; leave empty to ship only the keyless dark default |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Privileged Supabase access for admin operations (invites, geocode_cache writes, Storage cleanup) |
| `RESEND_API_KEY` | server only | Resend API key for transactional email |
| `BATCHPORT_ADMIN_EMAIL` | server only | Email address that receives access request notifications |
| `APPROVAL_SECRET` | server only | 32-byte hex secret for signing HMAC approval/deny tokens (generate with: openssl rand -hex 32) |
| `NOMINATIM_USER_AGENT` | server only | Contact string sent as User-Agent to Nominatim and Wikimedia APIs (e.g. BatchPort/1.0 (you@example.com)) |

The app shell still renders when `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are absent; the session refresh in `src/proxy.ts` is skipped and the app stays signed out.

## Scripts

```bash
npm run dev              # Start the dev server at http://localhost:3000
npm run build            # Production build (type-checks the whole project)
npm run start            # Serve the production build
npm run lint             # Run ESLint
npm run seed             # Import seed trips for a user (requires the dev server running at localhost:3000)

# Wipe the public demo account and rebuild it from the fictional showcase
# dataset. Refuses to run without --reset, and refuses any user id other than
# the demo account. Leaves user_settings intact. Requires the dev server.
npm run seed-demo -- --reset

# Rebuild the landing hero's static fallback (src/lib/mock-travel-data.ts) from
# the demo fixture. Re-run it whenever scripts/demo-dataset.ts changes.
npm run generate-mock-globe

npm run backfill-photos  # Backfill Wikimedia cover photos for existing destinations
npm run backfill-thumbnails  # Generate gallery thumbnails for photos uploaded before thumbnails existed
npm run backfill-exif    # Backfill date_taken and GPS coordinates from stored originals
npm run seed-countries   # Populate the countries reference table
npm run seed-cities      # Populate the cities table from GeoNames cities15000 (powers Discovery top cities)
npm run setup-shares     # Initialize user_settings rows for existing users

# Find photo rows whose owner entity no longer exists. Report only:
npm run cleanup-orphan-photos -- --dry-run
# Delete the rows and their upload Storage objects (idempotent):
npm run cleanup-orphan-photos
```

## Project Structure

```
src/
  app/
    (app)/                       Authenticated route group (session required)
      layout.tsx                 App shell: AppNav header + optional demo read-only banner
      actions.ts                 signOut server action
      dashboard/
        page.tsx                 Main dashboard: globe, stats overview, trip list, bucket preview
        stats/page.tsx           Full stats dashboard with all charts and extremes
        bucket-list/page.tsx     Bucket list management board
        settings/page.tsx        Share settings (public toggle, slug)
      trips/
        new/page.tsx             New trip form
        [id]/page.tsx            Trip detail: destination list, cover banner, photo section
        [id]/edit/page.tsx       Edit trip form
        [id]/destinations/
          new/page.tsx           Add destination form
          [destId]/page.tsx      Destination detail: experiences and photos
          [destId]/edit/page.tsx Edit destination form
    auth/
      callback/route.ts          PKCE code exchange after Supabase invite
      setup-password/page.tsx    Password setup page for new invite recipients
    demo/page.tsx                Sessionless public demo (SharedProfileView)
    share/[slug]/page.tsx        Public share profile with OG/Twitter metadata
    api/
      approve-access/route.ts    HMAC-verified invite trigger (GET)
      deny-access/route.ts       HMAC-verified denial email (GET)
      request-access/route.ts    Access request handler: validates input, emails admin (POST)
      geocode/
        search/route.ts          Photon typeahead proxy with geocode_cache
        lookup/route.ts          Nominatim reverse lookup proxy with geocode_cache
        poi/route.ts             Photon POI search proxy with geocode_cache
      weather/
        visit/route.ts           Observed daily weather for a coordinate and past date range
      photos/
        wikimedia/route.ts       Wikimedia metadata lookup (server-side)
        wikimedia/proxy/route.ts Image proxy to avoid CORS when displaying Wikimedia photos
    layout.tsx                   Root layout: Inter font, dark class, Toaster, ServiceWorkerRegister
    manifest.ts                  Web app manifest served at /manifest.webmanifest
    globals.css                  Tailwind v4 tokens including --brand color (#2563EB)
  components/
    app-nav.tsx                  Top navigation with sign-out and mobile hamburger
    location-search.tsx          Geocoding typeahead component
    poi-search.tsx               POI search component for experience dialog
    rating-input.tsx             Half-star rating input (1-10 scale)
    rating-display.tsx           Read-only half-star rating display
    category-icon.tsx            Category icon renderer
    map/
      globe.tsx                  MapLibre GL JS globe: map lifecycle, interaction, mode wiring
      globe-types.ts             Public data shapes (destinations, arcs, bucket places, selection)
      globe-sources.ts           Pure GeoJSON builders and popup HTML helpers
      globe-layers.ts            Every runtime overlay layer (fills, arcs, pins) plus sky
      basemaps.ts                Basemap catalog, style resolution, per-style overlay themes
      map-controls.tsx           Floating control cluster: mode buttons + settings popover
      dashboard-globe.tsx        Globe wrapper with stats overlay and country drill-down panel
      country-drilldown.tsx      Side panel listing a country's destinations grouped by trip
      replay-controls.tsx        Replay mode overlay: readout and transport bar
      unlocated-photos-modal.tsx Off-map grid of photos with no resolvable location
      use-replay.ts              Replay timeline engine
      use-photo-mode.ts          Photo map mode: clustering, markers, enter/exit
      use-attractions.ts         Wikipedia geosearch attraction markers
      use-nearby.ts              Nearby mode: device fix, you-are-here marker, enter/exit
      nearby-panel.tsx           Nearby status card: context, checkoff prompt, actions
      log-here-sheet.tsx         Compact sheet that logs an experience at your coordinates
      use-globe-fullscreen.ts    Fullscreen state with panel-first Escape handling
      map-utils.ts               Brand colour, country match filters, feature bounds
      map.css                    MapLibre popup dark theme styles
    discover/
      discovery-host.tsx         Page-level discovery panel host and context
      discovery-panel.tsx        Country, city, and POI views
      globe-search.tsx           Collapsible search overlay for the globe
      climate-line.tsx           Monthly climate line for a city
      country-facts.tsx          Currency, languages, driving side, plug and voltage
    trips/
      dashboard-trip-card.tsx    Trip card for the dashboard list
      dashboard-trips.tsx        Trip list section with Add Trip link
      trip-form.tsx              Trip create/edit form
      delete-trip-button.tsx     Confirmed delete with alert dialog
      status-badge.tsx           Planned/ongoing/completed badge
    destinations/
      destination-form.tsx       Destination create/edit form with location search
      delete-destination-button.tsx  Confirmed delete
    experiences/
      experience-dialog.tsx      Modal dialog for create/edit experiences with POI search
      experiences-section.tsx    Destination page section listing all experiences
    weather/
      visit-weather.tsx          "While you were here" observed-weather line and day expander
    photos/
      photo-upload.tsx           File picker with client-side resize and Storage upload
      photo-gallery.tsx          Grid gallery with lightbox
      photo-banner.tsx           Full-width cover photo banner with overlay
      cover-photo-picker.tsx     Pick or change the cover from existing photos
      destination-photos.tsx     Destination page photo section
      trip-photos.tsx            Trip page photo section (untagged + tagged by destination)
    stats/
      stats-grid.tsx             Summary stat cards
      yearly-chart.tsx           Year-by-year bar chart
      category-chart.tsx         Experience count and rating by category
      country-chart.tsx          Visits per country bar chart
      travel-map-stats.tsx       Travel extremes display (N/S/E/W)
      bucket-progress.tsx        Bucket list completion bar and counts
      chart-card.tsx             Shared chart wrapper card
      stat-card.tsx              Individual stat number card
    bucket-list/
      bucket-list-board.tsx      Full bucket list page with add/edit/fulfill
      bucket-item-card.tsx       Individual bucket item card
      bucket-item-dialog.tsx     Create/edit dialog with country or place selection
      country-combobox.tsx       Country picker for bucket items
      fulfill-dialog.tsx         Mark item fulfilled with trip selection
    share/
      shared-profile-view.tsx    Shared layout: globe, stats, trip list (used by /demo and /share/[slug])
      share-globe.tsx            Globe instance for public share (read-only, no drilldown links)
      shared-trip-card.tsx       Read-only trip card for share view
    settings/
      share-settings-form.tsx    Public share toggle and slug form
    auth/
      landing-actions.tsx        Request access and sign-in buttons on the landing page
    ui/                          shadcn/ui primitives (button, card, dialog, input, etc.)
    service-worker-register.tsx  Registers public/sw.js on mount
  lib/
    types.ts                     Domain types mirroring the Postgres schema
    constants.ts                 DEMO_USER_ID constant
    utils.ts                     cn() Tailwind class merge helper
    current-user.ts              requireUser(): resolves auth session and returns supabase + user
    demo.ts                      isDemoUser() and the shared read-only message
    demo-guard.ts                isDemoBlocked() helper for server actions
    format.ts                    formatDateRange(), flagEmoji()
    geo.ts                       pointEwkt() and haversineKm() shared helpers
    revalidate.ts                revalidateAppData(): app-wide cache purge after mutations
    action-result.ts             ActionResult type ({ ok: true } | { error: string })
    trips.ts                     Trip data layer (getTrip, getTripOptions, create, update, delete)
    destinations.ts              Destination data layer (create sends EWKT geom)
    experiences.ts               Experience data layer and getCategories()
    bucket-list.ts               Bucket list data layer and autoFulfillBucketItems()
    bucket-format.ts             Bucket item display formatting helpers
    photos.ts                    Photo helpers: resizeImage, uploadPhoto, getPhotoUrl (client-safe)
    photos-data.ts               Server photo reads and autoPopulateDestinationCover()
    photo-cleanup.ts             Shared photo deletion: rows, Storage, cover pointers, owner lists
    photo-map-data.ts            Photo map mode data layer: coordinate resolution per photo
    map-data.ts                  Globe data layer: getMapData() fetching destinations, arcs, bucket codes
    replay.ts                    Replay timeline construction from destinations
    discover.ts                  Discovery data layer: countries, cities, POIs, climate
    day-plan.ts                  Day assignment helpers for planned experiences
    stats-data.ts                Stats data layer: all SQL view queries and f_distance_traveled RPC
    stats-format.ts              Stats number formatting helpers
    share-data.ts                Public share data layer: getSharedProfile(), getProfileTrips()
    share-settings.ts            getShareSettings() read side using admin client
    weather.ts                   Observed weather at time of visit (ERA5 archive, cached)
    nearby.ts                    Nearby proximity helpers and radii (client-safe, pure)
    nearby-data.ts               Planned experiences with coordinates, for the checkoff prompt
    geocode.ts                   Geocoding cache helpers: readCache, writeCache, parsePhoton, parseNominatim
    wikimedia.ts                 Wikimedia P18 lookup: getWikimediaPhoto() with 90-day cache
    access-token.ts              HMAC-SHA256 token generation and verification for invite links
    landing-data.ts              Landing hero globe data: cached anon read of the demo account
    mock-travel-data.ts          GENERATED static fallback for the landing hero (see generate-mock-globe.ts)
    actions/
      trips.ts                   Trip server actions
      destinations.ts            Destination server actions (triggers Wikimedia + bucket auto-fulfill)
      experiences.ts             Experience server actions
      photos.ts                  Photo record server actions (insert, setCover, retag, delete + Storage cleanup)
      bucket-list.ts             Bucket list server actions
      share-settings.ts          Share settings server action
  utils/supabase/
    client.ts                    Browser Supabase client (batchport schema)
    server.ts                    Server Supabase client (batchport schema, async cookies())
    public.ts                    Sessionless anon client (batchport schema, no cookies; usable inside a cache scope)
    admin.ts                     Service-role client (not schema-scoped; must call .schema("batchport") per query)
  proxy.ts                       Session refresh and route protection (Next.js 16 proxy convention)
public/
  sw.js                          Pass-through service worker (enables PWA installability)
  data/countries.geojson         Country polygons for the globe (ISO_A2_EH property for code matching)
  styles/dark-style.json         MapLibre dark base style (used when PMTiles is not configured)
  icons/                         PWA icons: 48x48 through 512x512, maskable 192x192 and 512x512
scripts/
  generate-icons.mjs             Regenerates placeholder PWA icon PNGs
  seed-trips.ts                  Imports travel history for a user (idempotent per trip name + user_id)
  seed-demo.ts                   Resets the demo account and reseeds the fictional showcase dataset (--reset required)
  demo-dataset.ts                The demo showcase fixture (trips, destinations, experiences, bucket items)
  generate-mock-globe.ts         Regenerates src/lib/mock-travel-data.ts, the landing hero's static fallback
  backfill-photos.ts             Backfills Wikimedia cover photos for existing destinations
  backfill-thumbnails.ts         Generates {storage_path}_thumb thumbnails and sets photos.thumb_path
  backfill-exif.ts               Backfills date_taken and GPS from stored originals
  fix-gps-signs.ts               Repairs EXIF GPS hemisphere signs on affected photos
  cleanup-orphan-photos.ts       Finds and removes photo rows whose owner no longer exists (--dry-run)
  seed-countries.ts              Populates the countries reference table
  seed-cities.ts                 Populates the cities table from GeoNames cities15000
  setup-share-settings.ts        Creates user_settings rows for existing users
  sql/                           One-off migrations to run in the Supabase SQL editor
```

## Database Notes

The `geocode_cache.provider` check constraint must allow every provider the app
writes: `photon`, `photon_poi`, `nominatim`, `wikimedia`, `discover_country`,
`discover_cities`, `discover_city`, `discover_poi`, `discover_climate`, and
`discover_geo`. If the constraint is stale, cache writes fail silently and
every lookup hits the upstream API. Run
`scripts/sql/2026-07-22-discover-geo-provider.sql` in the Supabase SQL editor
to widen it (it supersedes the provider constraint from
`2026-07-20-planner-completion.sql`, which superseded
`2026-07-18-discover-poi-provider.sql` and
`2026-07-15-geocode-cache-providers.sql`). Note that
`2026-07-20-planner-completion.sql` also adds the `experiences.planned_day`
column (below), which the 07-22 file does not replace.

Planned trips are excluded from visited countries and stats in the app data
layer, but the SQL stats views also need the planned filter applied. See
`scripts/sql/2026-07-16-stats-exclude-planned-trips.sql` for the per-view
change to run in the Supabase SQL editor.

The trip planner needs the `experiences.status` column ('planned' | 'done')
and the matching stats-view filters. Run
`scripts/sql/2026-07-18-experience-status.sql` in the Supabase SQL editor.
Until it runs, the app degrades: experience writes retry without the status
key, reads treat a missing status as 'done', and the stats layer subtracts
planned experiences app-side.

Day planning needs the `experiences.planned_day` column (integer; day 1 = the
destination's arrival date, null = unassigned). It is added by
`scripts/sql/2026-07-20-planner-completion.sql` alongside the climate cache
provider. Until it runs, day-assignment writes fail with a friendly error,
reads treat a missing value as unassigned, and the plan block still renders as
a flat list. Climate lines and country practical facts (currency, languages,
driving side, plug/voltage from Wikidata) need no schema change; climate uses
the Open-Meteo ERA5 archive and caches under the `discover_climate` provider,
and the facts ride along in the existing `discover_country` aggregate (its
cache key was bumped so stale pre-facts payloads refresh).

The home location needs the `home_name` and `home_country_code` label columns
on `user_settings` (and `home_geom`, if the column is missing). Run
`scripts/sql/2026-07-29-home-location.sql` in the Supabase SQL editor. Until it
runs the feature degrades: saving a home retries without the label columns, so
the point is still stored and every distance feature works, but Settings shows
coordinates instead of a city name.

The observed-weather line needs the `weather_visit` cache provider allowed on
`geocode_cache`. Run `scripts/sql/2026-08-01-weather-visit-provider.sql` in the
Supabase SQL editor (it supersedes `2026-07-22-discover-geo-provider.sql`,
widening the same constraint). Until it runs the line still renders correctly,
but nothing caches: every view re-hits the Open-Meteo archive.

Nearby mode needs no migration. It reads the destinations the globe already has
and the planned experiences that carry a `geom`, so it works as soon as the
experience status column exists (`2026-07-18-experience-status.sql`); before
that every experience reads as done and the checkoff prompt simply never fires.

Global search works with no migration at all. When the tables grow, run
`scripts/sql/2026-07-29-search-indexes.sql` to add the pg_trgm GIN indexes that
serve its unanchored ILIKE matching; without them the same rows come back via a
sequential scan.

## Development Setup

1. Clone the repository and install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template and fill in real values:

   ```bash
   cp .env.local.example .env.local
   ```

3. In the Supabase dashboard, expose the `batchport` schema under Settings, API, Exposed schemas. All Supabase clients in this app are scoped to that schema.

4. Run the seed scripts after your database migrations are applied:

   ```bash
   npm run seed-countries      # Populate the countries reference table
   npm run setup-shares        # Initialize user_settings rows for existing users
   ```

5. Start the dev server:

   ```bash
   npm run dev
   ```

   Open http://localhost:3000. Unauthenticated visitors land on the rotating-globe landing page.

## Deployment

1. Connect the repository to a Vercel project.
2. Set every variable from `.env.local.example` in the Vercel project settings under Environment Variables.
3. In the Supabase dashboard under Authentication, URL Configuration, Redirect URLs, add `https://batchport.batch-apps.com/auth/setup-password` (and the http://localhost:3000 equivalent for local or preview use). Missing this entry causes Supabase to strip the redirectTo parameter and silently break the invite flow.
4. Deploy via git push or the Vercel dashboard.

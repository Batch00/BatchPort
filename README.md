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
- Recenter button to fit the camera to all destinations
- Auto-rotate while idle on the landing page hero; static on the dashboard
- Protomaps PMTiles dark raster basemap (optional, via NEXT_PUBLIC_PMTILES_URL); falls back to the bundled dark style at /styles/dark-style.json

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

### Settings

- Toggle public sharing on/off
- Set a custom public slug (3 to 30 characters, lowercase letters, numbers, and hyphens; reserved slugs are blocked; must be unique across users)

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

**geocode_cache:** Cached API responses keyed by provider (photon, photon_poi, nominatim, wikimedia) and query_norm. TTL: 30 days for geocoding responses, 90 days for Wikimedia responses.

**user_settings:** Per-user configuration: public_share_enabled, public_slug, and is_demo.

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
npm run backfill-photos  # Backfill Wikimedia cover photos for existing destinations
npm run backfill-thumbnails  # Generate gallery thumbnails for photos uploaded before thumbnails existed
npm run seed-countries   # Populate the countries reference table
npm run seed-cities      # Populate the cities table from GeoNames cities15000 (powers Discovery top cities)
npm run setup-shares     # Initialize user_settings rows for existing users
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
      globe.tsx                  MapLibre GL JS globe: all layer setup and interaction
      dashboard-globe.tsx        Globe wrapper with stats overlay and country drill-down panel
      projection-toggle.tsx      Globe/mercator toggle button and recenter control
      map.css                    MapLibre popup dark theme styles
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
    map-data.ts                  Globe data layer: getMapData() fetching destinations, arcs, bucket codes
    stats-data.ts                Stats data layer: all SQL view queries and f_distance_traveled RPC
    stats-format.ts              Stats number formatting helpers
    share-data.ts                Public share data layer: getSharedProfile(), getProfileTrips()
    share-settings.ts            getShareSettings() read side using admin client
    geocode.ts                   Geocoding cache helpers: readCache, writeCache, parsePhoton, parseNominatim
    wikimedia.ts                 Wikimedia P18 lookup: getWikimediaPhoto() with 90-day cache
    access-token.ts              HMAC-SHA256 token generation and verification for invite links
    mock-travel-data.ts          Mock globe data for the landing page hero
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
  backfill-photos.ts             Backfills Wikimedia cover photos for existing destinations
  backfill-thumbnails.ts         Generates {storage_path}_thumb thumbnails and sets photos.thumb_path
  seed-countries.ts              Populates the countries reference table
  setup-share-settings.ts        Creates user_settings rows for existing users
```

## Database Notes

The `geocode_cache.provider` check constraint must allow every provider the app
writes: `photon`, `photon_poi`, `nominatim`, `wikimedia`, `discover_country`,
`discover_cities`, `discover_city`, and `discover_poi`. If the constraint is
stale, cache writes fail silently and every lookup hits the upstream API. Run
`scripts/sql/2026-07-18-discover-poi-provider.sql` in the Supabase SQL editor
to widen it (it supersedes `2026-07-15-geocode-cache-providers.sql`).

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

# BatchPort

BatchPort is a personal travel tracker and installable progressive web app built on an interactive 3D globe. It lets you log every trip, destination, and experience, visualize journeys as great-circle arcs on a spinning globe, explore stats through a dedicated dashboard with charts, and maintain a bucket list of countries and places you want to visit. BatchPort is part of the Batch Apps umbrella (batch-apps.com), lives at batchport.batch-apps.com, and is invite-only. A public read-only demo runs at /demo, and any user can generate a shareable profile at /share/[slug].

## Features

### Interactive Globe

- MapLibre GL JS globe rendering with globe/mercator projection toggle
- Visited country fills (electric blue) and bucket list country fills (amber) using native GeoJSON fill layers
- Destination pin layer, color-coded by primary experience category, with hover glow and popup
- Great-circle trip arc layer with glow, computed from consecutive destinations within each trip, styled by how each hop was travelled (solid blue for flights and unrecorded hops, violet dashes for ground, cyan dots for ferries)
- Country click drill-down: flies to the country and shows a side panel listing destinations grouped by trip
- Hover tooltips on pins (destination name) and countries (name plus destination count)
- Stats overlay showing countries, trips, and destination counts
- Auto-rotate while idle on the landing page hero; static on the dashboard
- The landing hero renders the public demo account's real travel history, read through the anon path and cached for an hour, with a generated static snapshot of the same trips as the fallback so the hero is never an empty globe
- Protomaps PMTiles dark raster basemap (optional, via NEXT_PUBLIC_PMTILES_URL); falls back to the bundled dark style at /styles/dark-style.json
- Basemap style switcher: the keyless dark default plus MapTiler streets, satellite, and terrain when NEXT_PUBLIC_MAPTILER_KEY is set; each style carries its own overlay tint, pin halo, and zoom depth, and the choice persists per session
- Fullscreen mode: the globe card swaps to a fixed full-viewport container with panel-first Escape handling

### Map Controls

The floating control cluster is ranked by how often a control is actually reached for, capped at four buttons plus the search icon on the fullest surface and fewer everywhere else.

- **Visible buttons** are the frequent four: photo map, replay, recenter, and the settings popover. Recenter earns its place by sheer frequency (every stray drag on a globe ends in wanting the data back on screen). Photo map and replay surface their own chrome while running (replay swaps the cluster for a transport bar; photo mode adds a header pill).
- **The settings popover** holds everything occasional, modes included: basemap swatches, globe/flat projection, fullscreen, and refresh, then nearby and show attractions at the foot. Both modes are entered once and lived in, so a permanent button would spend resting-state room on a tap most sessions never make; they sit last because the popover opens upward from a bottom-anchored trigger, so the final row is the one nearest the thumb. The menu's height is capped against the map rather than the viewport, and scrolls past that, so it can never reach the search button on a short phone map.
- Because two modes live behind the popover, its trigger takes a brand tint and a small brand dot whenever one is running, and the active menu row is tinted too, so no mode is ever on with no visible signal.
- Layout is a single bottom-right vertical column at every breakpoint. Search anchors top-right, so the two cannot collide: the cluster's height is bounded at four buttons (about 220px on phones) and every globe surface is at least 300px tall.
- Read-only surfaces (demo and /share/[slug]) render the same model minus the auth-gated pieces (no refresh, no attractions, no nearby, no photo management actions).

### Alternate Globe Modes

- **Photo map:** every photo with a resolvable coordinate rendered as a clustered thumbnail marker; travel layers stand down. Coordinates resolve from EXIF GPS, then the owning experience, destination, or the trip's first destination. Photos with no location are counted in the header and viewable in an off-map grid, where they can be assigned to a destination.
- **Replay:** timeline playback of travel history with a date and country readout, scrubber, speed toggle, and restart. Each leg draws in its transport family's styling, the same one the static arcs use, with the growing arc's leading head tinted to match.
- **Attractions:** viewport Wikipedia geosearch markers (via /api/discover/geo) that open in the discovery panel. Debounced, memoized per viewport cell, and gated to zoom 10 and above.
- **Nearby:** the app's present tense, built for standing somewhere. Tapping the mode (and only tapping it) asks the browser for a location; the map flies to it, drops a pulsing emerald you-are-here marker, switches the attractions layer on around you, and borrows the detailed streets basemap so there is something under the marker to read. The basemap is a loan, not a preference: it is handed back on exit, a manual basemap change during the mode wins, and with no MapTiler key configured the mode simply runs on dark. The card names the stop you are in when one is within 50km, links into that destination and its trip plan, offers a one-tap checkoff when you are within 250m of something you planned, and opens a compact sheet that logs an experience at your coordinates (name prefilled from an attraction within 150m, destination defaulted to the stop you are in). The position is held in memory for the life of the mode and never stored or transmitted; the only coordinate that leaves the session is the one on a record you create. A denial states the problem once and offers an exit, and never re-asks on its own.
- **Discovery:** clicking any country opens a panel with country facts (currency, languages, driving side, plug and voltage), climate lines, and top cities; POIs can be saved onto a trip as planned or done experiences.

### Trip, Destination, and Experience Management

- Full CRUD for trips, destinations, and experiences via server actions
- Trip status: planned, ongoing, completed
- Trip and destination notes fields
- Destinations ordered chronologically by arrival date, with order_index as the stored sequence and the manual order for an undated trip. Dating a stop moves it to where it belongs, and everything derived from the route order (globe arcs, replay, the story, transport legs) follows without being told
- Experience categories: museum, restaurant, attraction, nightlife, beach, nature, lodging, and more
- Half-star rating on experiences: stored as a smallint 1-10 (each unit is half a star), displayed as 0.5-5.0 stars
- Date fields on trips (start/end), destinations (arrival/departure), and experiences (visited date). Trip and destination ranges are picked on a single calendar: click the first day, click the last, and the selected span highlights as you go
- A trip's dates come from its stops once any of them are dated, running from the earliest arrival to the latest departure, so the trip and its route can never quote different weeks. The trip form shows that range read-only and points at the stops; the stored columns stay in sync underneath, since the stats views read them directly. A trip with no dated stops keeps its own manually entered range, and one with neither still reads as undated

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
- "How you travelled": distance split by transport mode, with the CO2e estimate that follows from it. Kilometres are the same great-circle measure the total uses, never scaled up by a made-up detour factor, and hops with no recorded leg are named rather than folded in. Absent until at least one leg carries a mode
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

### Travel Journal

- One freeform entry per day of a trip, distinct from an experience's notes: an experience note describes a place, a journal entry describes a day
- Appears on completed and ongoing trips only. A planned trip's days already belong to the planner, and there is nothing to look back on yet
- Days come from the trip's own dates (or the span its stops cover), and each day derives the stop it falls in from the destination date ranges; nothing about the stop is stored on the entry
- Low friction writing: tap a day, type, and it autosaves. A failed save never clears what was typed, closing the editor flushes immediately, and an unsaved change warns before the tab closes
- Clearing an entry deletes it, so a day either has writing or it does not
- Collapsed by default and folded twice, so a month-long trip does not become a wall of empty days: the closed header carries the entry count, and opening it lists only the days that already have writing, with a "Show all N days" switch to reach an empty one. A journal with nothing in it opens straight to every day
- Entries render on the trip page and feed the trip story

### Transport Legs

- Record how you got to each stop: flight, train, bus, car, ferry, bike, walk, or other
- One tap to log. Picking a mode saves immediately; carrier ("Eurostar", "BA 342"), duration, a distance override, and notes all sit behind an optional "Add details" disclosure
- A leg belongs to the stop it arrives at, one per stop, so the leg on the first stop is the journey out from home and the order comes from the route itself. Nothing has to be re-entered when a stop moves
- Arcs on the globe restyle by how the hop was travelled: flights stay the solid brand-blue great circle with a glow, ground travel reads as thinner violet dashes, ferries as cyan dots. A hop with no recorded leg keeps the original styling, so an unannotated map is unchanged
- The dot on each leg row matches the arc colour its family draws in, which is the legend, in the place a leg is written rather than floating over the map
- Shown read-only on /demo and /share/[slug], where an unrecorded leg simply renders nothing

### Trip Story

- A full-screen, chronological reading of one trip, opened from a "Story" action on completed and ongoing trips
- Slides are days: the journal entry, the photos taken that day (by `date_taken`), the experiences logged that day with their ratings, and the observed weather line on the slide that opens each stop. Days with nothing in them are skipped, which is what keeps it a story
- Undated things do not disappear: a photo or experience without a date rides on its stop's first slide, and a stop that produced no dated day gets a single slide of its own
- Opens on a title slide (cover, dates, route, country flags) and closes on a scoreboard (days, stops, countries, experiences, photos, distance, best-rated)
- Photos are the visual backbone: one fills the frame, two to four tile, the rest are counted. Where a day has none, the stop's cover carries the slide and the writing takes the foreground
- Navigation: swipe on touch (horizontal only, so a long entry still scrolls), arrow keys and click zones on desktop, Escape closes, a segmented progress bar tracks position
- Loads lazily: only the slides adjacent to the current one are mounted, and only the next slide's lead image is preloaded
- Read-only by construction, so /demo and /share/[slug] offer the same story

### On This Day

- A dashboard strip of photos taken and experiences logged on today's month and day in earlier years
- Renders only when there is something to show. There is no "no memories today" card
- Cheap by design: rather than a `date_part` filter Postgres cannot index, two queries ask for the handful of concrete anniversary dates in a 25 year look-back, and the context lookups that follow run only for rows that actually matched
- Tapping a photo opens the lightbox with a link into its destination; tapping an experience opens its destination page

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

### Map Poster and Share Cards

Two exportable images, both drawn on a canvas from projected geometry rather than captured from the map, so neither is a screenshot and neither has a resolution ceiling set by the screen.

**Map poster.** An "Export poster" action on the stats page opens a dialog with a live preview drawn by the export's own code path, so what downloads is what was on screen. The choices are deliberately few: framing (a Robinson world map, or a globe centred on the traveller's own centre of gravity), theme (Midnight, the app's palette, or Paper, a warm off-white made to be printed), an optional stat block (countries, continents, trips, distance), and a title and subtitle that default to something sensible. Orientation follows the framing rather than being a third thing to choose: a world map is a landscape object and prints 16 x 12 inches, a globe is a square one and prints 12 x 16. Both are the same 12 inches on the short edge, so the type is the same physical size and the two hang as a pair.

The flat map crops the empty polar bands, widened automatically to cover any stop that falls outside them, which is what lets it run the full width of the page instead of floating in the middle of it. The globe framing says out loud how many stops fall on the hidden hemisphere and points at the world map, rather than quietly dropping them.

Output is a PNG at 300 DPI (4800 x 3600 px), or a PDF that states the physical page size so a print shop does not have to guess. Browsers cap canvas area and disagree about where (Safari stops at 16.7 megapixels, under a 300 DPI poster), so the dialog probes what this device can actually allocate, steps down through a ladder of DPIs, and reports the size it achieved instead of promising one it did not.

**Per-trip share cards.** A "Share" action next to the story, on the trip page, on the read-only demo and share surfaces, and on the story's closing slide. The card is the trip's cover photograph with the trip name and dates, the countries it crossed, the numbers (stops, countries, distance), the trip's best-rated experiences, and a small circular map of the route. Square for a feed, 9:16 for a story, both at 2160px on the short edge. Download always; where the browser supports sharing files, the OS share sheet as well.

The route map is an inset, not an overlay: a little under a third of the card's width, pushed into the top-right corner on a tighter margin than the text so it reads as anchored there rather than floating near it, with a soft drop shadow so it sits on the picture rather than looking stuck to it. It is framed to the trip rather than to the planet, so a week in Europe fills the disc with the five countries it actually crossed instead of scattering five dots across a hemisphere; a trip too wide to fit falls back to the full hemisphere, and a trip in one city stops zooming before the coastline disappears. The title knows where the inset is, and on the rare card where a long name would run under it the name takes the column beside it instead.

The places line names countries, not cities, and never truncates. Countries are fewer and say more ("Netherlands, Germany, Czechia, Austria, Hungary" beats three city names and a "+8"). Seven of them fit on one line, because every size is tried on a single line before a second one is allowed, and where a wrap is genuinely needed the two lines are balanced by width rather than packing the first and orphaning whatever is left. A single-country trip shows its stops instead, since the country name alone would say almost nothing.

The foot of the card lists up to three best-rated experiences, name on the left and rating flush right, which fills the width where a single starred line left it looking unfinished. Fewer than three shows what exists, long names shrink to fit, and a trip nobody rated drops the block entirely rather than leaving a gap where it would have been.

Everything the card draws comes from the same trip payload the story already builds, so it costs no extra query on any surface. A cover that will not load is a designed state, not a broken one: the card falls back to its own gradient and says so.

**Attribution.** The compositions use no basemap tiles at all, only the bundled Natural Earth country outlines, so no tile provider's terms apply and there is nothing to attribute for the map beyond the credit the poster carries anyway. Where a share card's cover came from Wikimedia Commons, the licence's attribution condition does not stop applying because the image was redrawn onto a canvas, so the card prints the credit line.

### Data Export

- JSON archive: every trip with nested destinations and experiences, plus the bucket list, photo metadata with absolute URLs, and settings
- GeoJSON: destinations as Point features (trip, experience, and rating properties) and trips as LineString routes, so it opens in geojson.io or any GIS tool
- Server-side generation at `/api/export?format=json|geojson`, downloaded with a dated filename; the builders take no user parameter, so a request can only ever return the caller's own data

### Settings

- Set or clear your home city
- Toggle public sharing on/off
- Set a custom public slug (3 to 30 characters, lowercase letters, numbers, and hyphens; reserved slugs are blocked; must be unique across users)
- Download your data as JSON or GeoJSON

### PWA and Offline

- Web app manifest served at /manifest.webmanifest
- Branded icons at multiple sizes (48x48 through 512x512) plus maskable variants (192x192 and 512x512)
- Responsive layout with hamburger nav on mobile (AppNav)
- Touch-friendly photo lightbox

BatchPort works with no connection, which is when a travel app matters most: abroad, on a plane, standing somewhere you planned to be.

**Reading offline.** Opening the app with no signal lands on a saved copy of your account: every trip, its stops and experiences, the plan checklists with their day assignments, journal entries, and the globe with its country fills and arcs. The copy is a snapshot refreshed whenever you open the app online, held in IndexedDB, so it covers trips you never happened to open rather than only the pages you visited. The dark basemap and the country outlines are files that ship with the app, so the map draws with nothing to reach.

**Writing offline.** Four things a traveller does in the field keep working: checking a planned experience off, writing a journal entry, logging a new experience (including from nearby mode), and marking a bucket list item completed. Each one is queued on the device with a visible pending marker, and sent when you reconnect. A queued write is never dropped: it leaves the queue by succeeding or by you discarding it, a failed send keeps its error and stays in the list, and if the browser refuses to store it you are told it was not saved rather than told it was.

**What needs a connection.** Deleting anything, reordering, creating or editing trips and stops, assigning plan days, recording transport legs, settings, and photo uploads all refuse offline with a message naming what needs the connection, rather than queueing a change with conflict semantics nobody can predict. Discovery, weather, search of new places, attractions, and POI lookup simply have nothing to show. Nothing spins forever.

**Conflict policy** is last write wins, per row, stated in the pending panel.

**A calm indicator, not a banner.** A small chip in the nav appears when you are offline or something is waiting, and nothing at all otherwise. Tapping it lists every pending write, any that failed with why, and a retry.

**Per-trip "Available offline".** Every trip is already readable offline; this toggle stores that trip's photo thumbnails too, capped, removable, with the approximate size shown. It does not pre-download map tiles: MapTiler's terms allow keeping tiles you have already looked at and prohibit bulk download, so the map caches as you pan and the toggle says so rather than implying more.

**Service worker hygiene.** Caches are versioned and cleaned on activate. Navigations are network-first and never cached, so a deploy cannot leave a stale page on screen. Server actions, photo uploads, the session refresh, and the auth callback are passed straight through, untouched.

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
| Offline | Service worker (Cache Storage), IndexedDB snapshot and write queue |
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

**trips:** Top-level travel event with name, status (planned/ongoing/completed), start_date, end_date, notes, and cover_photo_id. `start_date` and `end_date` are maintained from the trip's destinations whenever any of them carry a date (earliest arrival to latest departure); they are only a user-entered value on a trip whose stops are undated. They stay stored rather than derived on read because the SQL stats views read them directly.

**destinations:** A stop within a trip. Stores a PostGIS `geom geography(Point,4326)` column; `latitude` and `longitude` are generated columns derived from geom and must never be inserted or updated directly. Also holds country_code, admin_region, arrival_date, departure_date, order_index, cover_photo_id, and notes. `order_index` is the route sequence every other feature reads, and it is renumbered to match arrival-date order on every destination write, so dating a stop reorders the route rather than leaving two competing notions of "next".

**experiences:** An activity at a destination. Has category_id, `rating` (smallint 1-10; each unit is half a star, so 10 = five full stars), visited_date, notes, and an optional `geom geography(Point,4326)` set from POI search.

**categories:** Static reference data: slug, label, icon, color, sort_order.

**countries:** Static reference data: code (ISO 3166-1 alpha-2), name. Used for the bucket list country dropdown and country name display.

**bucket_list:** Country or place items with type ("country" or "place"), country_code, place_name, optional geom (for place type), priority, target_date, fulfilled_trip_id, and fulfilled_at.

**photos:** Owner_type (trip/destination/experience), owner_id, source (upload/wikimedia/url), storage_path (for uploads), external_url (for wikimedia and url sources), attribution, and order_index.

**geocode_cache:** Cached API responses keyed by provider (photon, photon_poi, nominatim, wikimedia, the discover_* family, weather_visit) and query_norm. TTL: 30 days for geocoding responses, 90 days for Wikimedia and discovery responses, 365 days for observed weather (past observations are immutable).

**journal_entries:** One freeform entry per (user_id, trip_id, entry_date). Body text plus timestamps, with a unique constraint on the three-column key. Deliberately carries no destination_id: which stop a day belongs to is already determined by the destination arrival/departure ranges, so it is derived on read rather than stored where it could drift.

**transport_legs:** How one stop was reached from the one before it. Belongs to the ARRIVING destination, one row per stop (unique on `destination_id`), which is why it stores no origin: the order is already `destinations.order_index`, and a stored copy of it would drift the first time a stop moved. The leg on a trip's first stop is the journey out from home. Fields: mode (flight/train/bus/car/ferry/bike/walk/other, the only required one), carrier, duration_minutes, an optional distance_km override, and notes. `trip_id` is denormalized so a trip's or a user's legs read in one query.

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

The one metric derived outside this layer is the distance-by-mode breakdown, which folds recorded transport legs against the same consecutive-stop great-circle distances the globe draws (`getTransportBreakdown` in `lib/transport-data.ts`). It has no view because it is a join of two small tables the page already needs, and it never changes the totals above.

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

# Bring existing trips' stored start_date/end_date and destinations.order_index
# in line with their stops. The app syncs these on every destination write and
# derives the same answer on read, so the UI is already correct; this is for the
# SQL stats views, which read the stored columns directly. Run once after
# deploying derived trip dates. Idempotent.
npm run resync-trip-schedules -- --dry-run
npm run resync-trip-schedules

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
    offline/page.tsx             Offline shell (public, renders from the IndexedDB snapshot)
    api/offline/snapshot/route.ts  The whole account in one document, for offline reads
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
      use-detail-basemap.ts      Detailed-basemap loan for the street-level modes
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
      transport-leg.tsx          Leg row between stops, plus the mode entry sheet
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
      transport-breakdown.tsx    Distance by transport mode, with the CO2e estimate
      bucket-progress.tsx        Bucket list completion bar and counts
      chart-card.tsx             Shared chart wrapper card
      stat-card.tsx              Individual stat number card
    bucket-list/
      bucket-list-board.tsx      Full bucket list page with add/edit/fulfill
      bucket-item-card.tsx       Individual bucket item card
      bucket-item-dialog.tsx     Create/edit dialog with country or place selection
      country-combobox.tsx       Country picker for bucket items
      fulfill-dialog.tsx         Mark item fulfilled with trip selection
    poster/
      poster-export.tsx          Poster dialog: live preview, options, PNG/PDF download
    share/
      trip-share-card.tsx        Per-trip share card dialog and its launcher
      shared-profile-view.tsx    Shared layout: globe, stats, trip list (used by /demo and /share/[slug])
      share-globe.tsx            Globe instance for public share (read-only, no drilldown links)
      shared-trip-card.tsx       Read-only trip card for share view
    settings/
      share-settings-form.tsx    Public share toggle and slug form
    auth/
      landing-actions.tsx        Request access and sign-in buttons on the landing page
    ui/                          shadcn/ui primitives (button, card, dialog, input, popover, etc.)
      date-range-picker.tsx      Single-calendar start/end range picker over YYYY-MM-DD strings
    service-worker-register.tsx  Registers public/sw.js and keeps it fresh across deploys
    offline/
      offline-shell.tsx          Offline trip list and globe, read from IndexedDB
      offline-trip.tsx           Offline trip view with queued checkoff and journal writes
      offline-status.tsx         Offline chip and the pending write queue panel
      trip-offline-toggle.tsx    Per-trip photo thumbnail caching
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
    trip-dates.ts                Trip range derivation and chronological stop ordering (pure)
    trip-schedule.ts             Writes the derived range and order_index back after a stop changes
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
    transport.ts                 Transport modes, arc families, formatting, distance fold (pure)
    transport-data.ts            Transport server reads and the distance-by-mode breakdown
    geocode.ts                   Geocoding cache helpers: readCache, writeCache, parsePhoton, parseNominatim
    wikimedia.ts                 Wikimedia P18 lookup: getWikimediaPhoto() with 90-day cache
    access-token.ts              HMAC-SHA256 token generation and verification for invite links
    poster/
      projection.ts              Robinson and orthographic projections, path clipping (pure)
      countries.ts               Country outline loader, cached per page
      theme.ts                   Poster palettes (Midnight and Paper)
      draw-map.ts                Country fills, arcs, and pins painted into a fitted frame
      poster.ts                  The printable poster: layout, render, PNG/PDF
      poster-data.ts             Poster inputs assembled from map data and stats
      share-card.ts              Per-trip share card, derived from a StoryTrip
      canvas.ts                  Canvas plumbing: DPI probe, fonts, CORS images, download, share
      pdf.ts                     One-page PDF wrapper stating the physical page size
    landing-data.ts              Landing hero globe data: cached anon read of the demo account
    mock-travel-data.ts          GENERATED static fallback for the landing hero (see generate-mock-globe.ts)
    offline/
      types.ts                   Offline snapshot shape (client-safe)
      queue-types.ts             Queued write vocabulary, labelling, coalescing (pure)
      constants.ts               Cache names, staleness, per-trip photo bounds
      db.ts                      IndexedDB wrapper (meta and queue stores)
      queue.ts                   The write queue store and the FIFO replay loop
      snapshot.ts                Snapshot fetch, storage, and staleness
      trip-cache.ts              Per-trip photo cache warm and removal
      use-offline.ts             Online status, queue, and connection guard hooks
      forget.ts                  Wipes offline storage on sign-out
    actions/
      trips.ts                   Trip server actions
      destinations.ts            Destination server actions (triggers Wikimedia + bucket auto-fulfill)
      experiences.ts             Experience server actions
      photos.ts                  Photo record server actions (insert, setCover, retag, delete + Storage cleanup)
      bucket-list.ts             Bucket list server actions
      transport.ts               Transport leg server actions (upsert by stop, delete)
      share-settings.ts          Share settings server action
      offline.ts                 Replay of one queued offline write (idempotent)
  utils/supabase/
    client.ts                    Browser Supabase client (batchport schema)
    server.ts                    Server Supabase client (batchport schema, async cookies())
    public.ts                    Sessionless anon client (batchport schema, no cookies; usable inside a cache scope)
    admin.ts                     Service-role client (not schema-scoped; must call .schema("batchport") per query)
  proxy.ts                       Session refresh and route protection (Next.js 16 proxy convention)
public/
  sw.js                          Service worker: precache, offline fallback, runtime caches
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
  resync-trip-schedules.ts       One-off: aligns stored trip dates and order_index with each trip's stops
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

The travel journal needs the `journal_entries` table, its RLS policies (which
include an `is_shared()` SELECT so the story renders on /demo and /share), and
its updated_at trigger. Run `scripts/sql/2026-08-02-journal.sql` in the
Supabase SQL editor. Until it runs the app degrades: the journal section
renders read-only with a one-line note, saving reports "Journaling is not set
up on this database yet" rather than pretending to have saved, and the story
view simply has no journal text to interleave. The trip story and On This Day
need no migration of their own.

Transport legs need the `transport_legs` table, its RLS policies (including an
`is_shared()` SELECT so legs render on /demo and /share), and its updated_at
trigger. Run `scripts/sql/2026-08-03-transport-legs.sql` in the Supabase SQL
editor. Until it runs the app degrades cleanly: the trip page leaves the leg
rows out entirely rather than offering a control that cannot save, arcs on the
globe keep their original styling, the stats page shows no distance breakdown,
and `npm run seed-demo` still seeds a complete demo account without legs.

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

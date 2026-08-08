// Shared domain types mirroring the batchport Postgres schema. Snake_case
// matches the columns returned by PostgREST so query results map directly.

export type TripStatus = "completed" | "ongoing" | "planned";

// Focal-point position stored with a cover photo. Values are percentages (0-100)
// matching CSS object-position semantics. scale is an optional zoom factor
// (1 = no zoom); rows written before zoom existed omit it and read as 1.
export interface CoverPosition {
  x: number;
  y: number;
  scale?: number;
}

export interface Trip {
  id: string;
  user_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: TripStatus;
  cover_photo_id: string | null;
  cover_position: CoverPosition | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Destination {
  id: string;
  trip_id: string;
  user_id: string;
  name: string;
  country_code: string | null;
  admin_region: string | null;
  // Generated columns derived from the geom geography point.
  latitude: number | null;
  longitude: number | null;
  arrival_date: string | null;
  departure_date: string | null;
  order_index: number;
  cover_photo_id: string | null;
  cover_position: CoverPosition | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// A planned experience is an idea saved while planning a trip; done is a
// logged activity. Rows written before the status column existed read as
// undefined and are normalized to "done" in the data layer.
export type ExperienceStatus = "planned" | "done";

export interface Experience {
  id: string;
  destination_id: string;
  user_id: string;
  name: string;
  category_id: string | null;
  // smallint 1 to 10, where each step is half a star (10 = five full stars).
  rating: number | null;
  visited_date: string | null;
  notes: string | null;
  status: ExperienceStatus;
  // Day-planning slot: day 1 = the destination's arrival date, null =
  // unassigned. Rows predating the column read as null in the data layer.
  planned_day: number | null;
  // Curation order for the story, the recap, and the share cards: null = not
  // featured, 1 = first, scoped to the owning trip. See lib/curation.ts. Rows
  // predating the column read as null.
  featured_rank: number | null;
  // PostGIS point as EWKB hex when POI coordinates were saved; select * reads
  // carry it along and the day planner decodes it for proximity hints.
  geom?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  slug: string;
  label: string;
  icon: string | null;
  color: string | null;
  sort_order: number;
}

// Photos attach to a trip, a destination, or an experience. A photo is one of
// three sources: a user upload in Supabase Storage, an auto-fetched Wikimedia
// Commons image referenced by external_url, or an arbitrary external url.
export type PhotoOwnerType = "trip" | "destination" | "experience";
export type PhotoSource = "upload" | "wikimedia" | "url";

export interface Photo {
  id: string;
  user_id: string;
  owner_type: PhotoOwnerType;
  owner_id: string;
  source: PhotoSource;
  storage_path: string | null;
  external_url: string | null;
  attribution: string | null;
  order_index: number;
  date_taken: string | null;
  // Storage path of the small gallery thumbnail ("{storage_path}_thumb"), or
  // null for photos uploaded before thumbnails existed (they fall back to the
  // full image).
  thumb_path: string | null;
  // Curation order for the story and the recap: null = not featured, 1 =
  // first, scoped to the owning trip. See lib/curation.ts. Optional because
  // the narrow reads that only need a display url do not select it, and
  // because a database without the migration does not carry it at all.
  featured_rank?: number | null;
  created_at: string;
}

export interface DestinationWithExperiences extends Destination {
  experiences: Experience[];
}

export interface TripWithDestinations extends Trip {
  destinations: DestinationWithExperiences[];
}

// The canonical location shape produced by the geocoding endpoints and consumed
// by the location search component and destination forms.
export interface GeoLocation {
  name: string;
  country: string | null;
  country_code: string | null;
  admin_region: string | null;
  lat: number;
  lng: number;
  // Set when the result is a whole country rather than a place within one.
  // Optional: cached responses parsed before this field existed omit it.
  kind?: "country" | "place";
}

// A point of interest from the POI geocoder, used to prefill an experience.
// category_slug maps an OSM tag to one of the app's category slugs (or "other").
export interface PoiResult {
  name: string;
  type: string;
  category_slug: string;
  lat: number;
  lng: number;
  country_code: string | null;
  address: string | null;
}
